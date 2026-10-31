'use strict';
'require view';
'require rpc';
'require ui';
'require oxidns.yaml as yaml';
'require view.oxidns.config-guided as guided';
'require oxidns.i18n as i18n';

var callConfigRead = rpc.declare({
	object: 'luci.oxidns',
	method: 'config_read',
	expect: {}
});

var callStatus = rpc.declare({
	object: 'luci.oxidns',
	method: 'status',
	expect: {}
});

var callConfigSchema = rpc.declare({
	object: 'luci.oxidns',
	method: 'config_schema',
	expect: {}
});

var callConfigValidate = rpc.declare({
	object: 'luci.oxidns',
	method: 'config_validate',
	params: [ 'content' ],
	expect: {}
});

var callConfigSave = rpc.declare({
	object: 'luci.oxidns',
	method: 'config_save',
	params: [ 'content', 'base_mtime', 'restart' ],
	expect: {}
});

var DIFF_MAX_LINES = 800;
var DIFF_CONTEXT = 3;

var state = {
	raw: '',
	doc: null,
	parseError: null,
	serializeError: null,
	mtime: '',
	mode: 'guided',
	preview: true,
	bindings: [],
	advancedDraft: '',
	schema: null
};

var previewTimer = null;

function loadErrorMessage(err) {
	if (err && (err.message || err.error))
		return err.message || err.error;
	return _('Unable to load configuration.');
}

function coreInstalled(status) {
	return !!(status && status.core && status.core.installed);
}

function textareaValue() {
	var textarea = document.getElementById('oxidns-config-content');
	return textarea ? textarea.value : state.advancedDraft;
}

function setStatus(message, danger) {
	var node = document.getElementById('oxidns-config-status');
	if (!node)
		return;
	node.textContent = message || '';
	node.className = danger ? 'alert-message error' : 'alert-message info';
}

function parseContent(content) {
	state.doc = null;
	state.parseError = null;

	try {
		var doc = yaml.parseDocument(content || '');

		if (doc.errors && doc.errors.length) {
			state.parseError = doc.errors[0].message || String(doc.errors[0]);
		}
		else if (!doc.contents) {
			state.parseError = _('The configuration file is empty.');
		}
		else {
			state.doc = doc;
		}
	}
	catch (err) {
		state.parseError = err && err.message ? err.message : String(err);
	}

	return !state.parseError;
}

function guidedContent() {
	state.serializeError = null;

	if (!state.doc)
		return state.raw;

	guided.apply(state.doc, state.bindings);

	try {
		return state.doc.toString({ lineWidth: 0 });
	}
	catch (err) {
		state.serializeError = err && err.message ? err.message : String(err);
		return state.raw;
	}
}

function currentContent() {
	if (state.mode === 'advanced')
		return textareaValue();

	return guidedContent();
}

function guidedProblems() {
	if (state.mode !== 'guided' || !state.doc)
		return [];

	guided.apply(state.doc, state.bindings);

	var problems = typeof guided.validate === 'function' ? guided.validate(state.doc) : [];

	if (problems.length)
		setStatus(problems.join(' '), true);

	return problems;
}

function runConfigCall(label, call, args, onSuccess) {
	ui.showModal(_('OxiDNS'), [
		E('p', {}, label)
	]);

	return L.resolveDefault(call.apply(null, args || []), null).then(function(result) {
		ui.hideModal();
		if (!result || result.ok === false) {
			setStatus(i18n.message(result) || _('Operation failed'), true);
			return;
		}
		if (onSuccess)
			onSuccess(result);
		setStatus(i18n.message(result) || _('Operation completed.'), false);
	}).catch(function(err) {
		ui.hideModal();
		setStatus(err.message || String(err), true);
	});
}

function validateYaml() {
	var content = currentContent();

	if (state.serializeError) {
		setStatus(state.serializeError, true);
		return Promise.resolve();
	}

	if (guidedProblems().length)
		return Promise.resolve();

	return runConfigCall(_('Validating configuration...'), callConfigValidate, [
		content
	]);
}

function saveYaml(restart) {
	var content = currentContent();

	if (state.serializeError) {
		setStatus(state.serializeError, true);
		return Promise.resolve();
	}

	if (guidedProblems().length)
		return Promise.resolve();

	return runConfigCall(restart ? _('Saving and applying configuration...') : _('Saving configuration...'), callConfigSave, [
		content,
		state.mtime,
		!!restart
	], function(result) {
		state.mtime = result.mtime !== undefined ? result.mtime : state.mtime;
		applySavedContent(content);
	});
}

function resetYaml() {
	state.serializeError = null;
	state.advancedDraft = state.raw;

	if (!parseContent(state.raw))
		state.mode = 'advanced';

	updateModeButtons();
	renderBody();
	setStatus(_('Unsaved changes were discarded.'), false);
}

function applySavedContent(content) {
	state.raw = content;
	state.advancedDraft = content;

	if (state.mode === 'guided' && !parseContent(content))
		state.mode = 'advanced';

	updateModeButtons();
	renderBody();
}

function downloadYaml() {
	return L.resolveDefault(callConfigRead(), null).then(function(result) {
		if (!result || result.ok === false || typeof result.content !== 'string') {
			setStatus((result && (result.message || result.error)) || _('Unable to load configuration.'), true);
			return;
		}

		var blob = new Blob([ result.content ], { type: 'application/yaml' });
		var url = URL.createObjectURL(blob);
		var link = E('a', { 'href': url, 'download': 'config.yaml' });

		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		window.setTimeout(function() {
			URL.revokeObjectURL(url);
		}, 1000);
		setStatus(_('Configuration downloaded.'), false);
	}).catch(function(err) {
		setStatus(err.message || String(err), true);
	});
}

function readTextFile(file) {
	return new Promise(function(resolve, reject) {
		var reader = new FileReader();
		reader.onload = function() {
			resolve(String(reader.result || ''));
		};
		reader.onerror = function() {
			reject(reader.error || new Error(_('Unable to read the selected file.')));
		};
		reader.readAsText(file);
	});
}

function uploadYaml(file) {
	if (!file)
		return Promise.resolve();
	if (file.name !== 'config.yaml') {
		setStatus(_('The file must be named config.yaml.'), true);
		return Promise.resolve();
	}

	return readTextFile(file).then(function(content) {
		return runConfigCall(_('Uploading configuration...'), callConfigSave, [
			content,
			state.mtime,
			false
		], function(result) {
			state.mtime = result.mtime !== undefined ? result.mtime : state.mtime;
			applySavedContent(content);
		});
	}).catch(function(err) {
		setStatus(err.message || String(err), true);
	});
}

function uploadInput() {
	var input = E('input', {
		'type': 'file',
		'accept': '.yaml,text/yaml,application/yaml',
		'style': 'display: none',
		'change': function(ev) {
			var file = ev.target.files && ev.target.files[0];
			ev.target.value = '';
			return uploadYaml(file);
		}
	});

	return E('span', { 'style': 'display: inline-flex' }, [
		input,
		E('button', {
			'class': 'btn cbi-button cbi-button-action',
			'click': function(ev) {
				ev.preventDefault();
				input.click();
			}
		}, _('Upload Config'))
	]);
}

function diffText(value) {
	/* The YAML serializer always ends with a newline; ignore that difference. */
	return String(value || '').replace(/\r\n/g, '\n').replace(/\s+$/, '');
}

function diffLines(oldText, newText) {
	oldText = diffText(oldText);
	newText = diffText(newText);

	if (oldText === newText)
		return [];

	var before = oldText.split('\n');
	var after = newText.split('\n');

	if (before.length > DIFF_MAX_LINES || after.length > DIFF_MAX_LINES)
		return [];

	var n = before.length;
	var m = after.length;
	var table = [];
	var i, j;

	for (i = 0; i <= n; i++)
		table.push(new Uint32Array(m + 1));

	for (i = n - 1; i >= 0; i--) {
		for (j = m - 1; j >= 0; j--) {
			table[i][j] = before[i] === after[j]
				? table[i + 1][j + 1] + 1
				: Math.max(table[i + 1][j], table[i][j + 1]);
		}
	}

	var lines = [];
	i = 0;
	j = 0;

	while (i < n && j < m) {
		if (before[i] === after[j]) {
			lines.push({ 'type': 'ctx', 'text': before[i] });
			i++;
			j++;
		}
		else if (table[i + 1][j] >= table[i][j + 1]) {
			lines.push({ 'type': 'del', 'text': before[i] });
			i++;
		}
		else {
			lines.push({ 'type': 'add', 'text': after[j] });
			j++;
		}
	}

	while (i < n)
		lines.push({ 'type': 'del', 'text': before[i++] });
	while (j < m)
		lines.push({ 'type': 'add', 'text': after[j++] });

	return compactDiff(lines, DIFF_CONTEXT);
}

function compactDiff(lines, context) {
	var keep = [];

	lines.forEach(function(line, index) {
		if (line.type === 'ctx')
			return;

		var from = Math.max(0, index - context);
		var to = Math.min(lines.length - 1, index + context);

		for (var i = from; i <= to; i++)
			keep[i] = true;
	});

	var result = [];

	for (var i = 0; i < lines.length; i++) {
		if (keep[i]) {
			result.push(lines[i]);
		}
		else if (result.length && result[result.length - 1].type !== 'gap') {
			result.push({ 'type': 'gap', 'text': '…' });
		}
	}

	return result;
}

function schedulePreview() {
	if (previewTimer)
		window.clearTimeout(previewTimer);

	previewTimer = window.setTimeout(function() {
		previewTimer = null;
		updatePreview();
	}, 250);
}

function updatePreview() {
	var node = document.getElementById('oxidns-config-preview-body');
	if (!node)
		return;

	while (node.firstChild)
		node.removeChild(node.firstChild);

	if (!state.preview)
		return;

	var lines = diffLines(state.raw, currentContent());

	if (!lines.length) {
		node.appendChild(E('div', { 'class': 'cbi-value-description' }, _('No changes.')));
		return;
	}

	node.appendChild(E('pre', {
		'style': 'margin: 0; padding: .5em; overflow: auto; max-height: 24em; font-size: .9em; font-family: monospace; border: 1px solid var(--border-color-medium, rgba(128,128,128,.35)); border-radius: var(--radius-control, 4px); background: var(--background-color-low, var(--background-color-medium, transparent)); color: var(--text-color-high, var(--text-color, inherit));'
	}, lines.map(function(line) {
		var prefix = line.type === 'add' ? '+ ' : line.type === 'del' ? '- ' : line.type === 'gap' ? '' : '  ';
		var style = line.type === 'add'
			? 'background: rgba(40,160,80,.18);'
			: line.type === 'del'
				? 'background: rgba(200,60,60,.18);'
				: line.type === 'gap'
					? 'opacity: .6;'
					: '';

		return E('div', { 'style': style }, prefix + line.text);
	})));
}

function previewSection() {
	return E('div', { 'class': 'cbi-section', 'style': 'margin-top: 1em;' }, [
		E('h3', {}, _('Change Preview')),
		E('label', { 'style': 'display: inline-flex; gap: .5em; align-items: center; padding-inline: var(--section-inset, 0);' }, [
			E('input', {
				'id': 'oxidns-config-preview-toggle',
				'type': 'checkbox',
				'style': 'position: static; top: auto; right: auto; margin: 0;',
				'checked': state.preview ? 'checked' : null,
				'change': function(ev) {
					state.preview = !!ev.target.checked;
					updatePreview();
				}
			}),
			_('Show change preview')
		]),
		E('div', { 'id': 'oxidns-config-preview-body', 'style': 'margin-top: .75em; padding-inline: var(--section-inset, 0);' })
	]);
}

function advancedSection() {
	var textarea = E('textarea', {
		'id': 'oxidns-config-content',
		'class': 'cbi-input-textarea',
		'style': 'width: 100%; min-height: 420px; font-family: monospace;',
		'spellcheck': 'false',
		'input': function(ev) {
			state.advancedDraft = ev.target.value;
		}
	});

	textarea.value = state.advancedDraft;
	textarea.defaultValue = state.advancedDraft;

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, _('YAML')),
		E('div', { 'class': 'cbi-section-descr' },
			_('Advanced mode saves the text exactly as written. Normal mode rewrites only the fields it manages.')),
		textarea
	]);
}

function modeButton(mode, label) {
	return E('button', {
		'id': 'oxidns-mode-' + mode,
		'class': 'btn cbi-button ' + (state.mode === mode ? 'cbi-button-action' : 'cbi-button-neutral'),
		'click': function(ev) {
			ev.preventDefault();
			switchMode(mode);
		}
	}, label);
}

function updateModeButtons() {
	var guidedButton = document.getElementById('oxidns-mode-guided');
	var advancedButton = document.getElementById('oxidns-mode-advanced');

	if (guidedButton)
		guidedButton.className = 'btn cbi-button ' + (state.mode === 'guided' ? 'cbi-button-action' : 'cbi-button-neutral');
	if (advancedButton)
		advancedButton.className = 'btn cbi-button ' + (state.mode === 'advanced' ? 'cbi-button-action' : 'cbi-button-neutral');
}

function switchMode(mode) {
	if (mode === state.mode)
		return;

	if (mode === 'guided') {
		var content = textareaValue();

		if (!parseContent(content)) {
			ui.addNotification(null, E('p', {},
				_('The YAML is invalid: %s').format(state.parseError)), 'danger');
			return;
		}
	}
	else {
		state.advancedDraft = guidedContent();
	}

	state.mode = mode;
	updateModeButtons();
	renderBody();
}

function fillBody(body) {
	while (body.firstChild)
		body.removeChild(body.firstChild);

	if (state.mode === 'advanced') {
		state.bindings = [];

		if (state.parseError) {
			body.appendChild(E('div', { 'class': 'alert-message warning', 'style': 'margin: 1em 0;' },
				_('Normal mode is unavailable: %s').format(state.parseError)));
		}

		body.appendChild(advancedSection());
	}
	else if (!state.doc) {
		body.appendChild(E('div', { 'class': 'alert-message warning', 'style': 'margin: 1em 0;' },
			_('Normal mode needs valid YAML. Fix the YAML in advanced mode first.')));
	}
	else {
		var rendered = guided.render(state.doc, {
			'beforeChange': function() {
				guided.apply(state.doc, state.bindings);
			},
			'rerender': renderBody,
			'onInput': schedulePreview,
			'schema': state.schema
		});

		state.bindings = rendered.bindings;
		body.appendChild(rendered.node);
		body.appendChild(previewSection());
	}
}

function renderBody() {
	var body = document.getElementById('oxidns-config-body');
	if (!body)
		return;

	fillBody(body);
	updatePreview();
}

function actionButtons() {
	return E('div', {
		'class': 'cbi-button-row',
		'style': 'display: flex; flex-wrap: wrap; gap: .5em; margin-top: 1em; padding-inline: var(--section-inset, 0);'
	}, [
		E('button', {
			'class': 'btn cbi-button cbi-button-action',
			'click': function(ev) {
				ev.preventDefault();
				return validateYaml();
			}
		}, _('Validate')),
		E('button', {
			'class': 'btn cbi-button cbi-button-positive',
			'click': function(ev) {
				ev.preventDefault();
				return saveYaml(true);
			}
		}, _('Save and Apply')),
		E('button', {
			'class': 'btn cbi-button cbi-button-positive',
			'click': function(ev) {
				ev.preventDefault();
				return saveYaml(false);
			}
		}, _('Save')),
		E('button', {
			'class': 'btn cbi-button cbi-button-negative',
			'click': function(ev) {
				ev.preventDefault();
				resetYaml();
			}
		}, _('Reset')),
		E('button', {
			'class': 'btn cbi-button cbi-button-action',
			'click': function(ev) {
				ev.preventDefault();
				return downloadYaml();
			}
		}, _('Download Config')),
		uploadInput()
	]);
}

return view.extend({
	load: function() {
		var configPromise = L.resolveDefault(callConfigRead(), null).then(function(config) {
			return config || {
				ok: false,
				message: _('Unable to load configuration.')
			};
		}).catch(function(err) {
			return {
				ok: false,
				message: loadErrorMessage(err)
			};
		});

		var schemaPromise = L.resolveDefault(callConfigSchema(), null).then(function(result) {
			return result && result.ok !== false && result.schema ? result.schema : null;
		}).catch(function() {
			return null;
		});

		return Promise.all([
			configPromise,
			L.resolveDefault(callStatus(), {}),
			schemaPromise
		]).then(function(results) {
			return {
				config: results[0],
				status: results[1] || {},
				schema: results[2] || null
			};
		});
	},

	render: function(data) {
		var config = data && data.config ? data.config : {};
		var statusState = data && data.status ? data.status : {};
		var readFailed = config.ok === false;
		var configContent = config.content || '';
		var configMessage = readFailed
			? (i18n.message(config) || _('Unable to load configuration.'))
			: '';

		state.mtime = config.mtime || '';
		state.raw = configContent;
		state.advancedDraft = configContent;
		state.preview = true;
		state.schema = data && data.schema ? data.schema : null;
		state.mode = parseContent(configContent) ? 'guided' : 'advanced';

		if (readFailed && !coreInstalled(statusState)) {
			return E('div', { 'class': 'cbi-map' }, [
				E('div', { 'class': 'cbi-section' }, [
					E('div', { 'class': 'alert-message warning', 'style': 'margin: 1em 0;' },
						_('Install the OxiDNS core before editing the configuration.')),
					E('p', { 'class': 'cbi-section-descr' },
						_('Install it from Services → OxiDNS → Settings, then return to this page.'))
				])
			]);
		}

		var body = E('div', { 'id': 'oxidns-config-body', 'style': 'margin-top: 1em;' });
		fillBody(body);

		var node = E('div', { 'class': 'cbi-map' }, [
			E('div', { 'class': 'cbi-section-descr' },
				_('Edit the OxiDNS configuration with form-based editing, or use the full YAML editor.') + ' ' +
				_('Normal mode edits common settings and keeps the remaining YAML, including comments, unchanged.')),
			E('div', { 'class': 'cbi-section' }, [
				readFailed ? E('div', {
					'class': 'alert-message warning',
					'style': 'margin: 1em 0;'
				}, configMessage) : '',
				E('div', {
					'class': 'cbi-section-descr',
					'style': 'margin-top: .5em;'
				}, _('The saved configuration takes effect after restarting the OxiDNS service from the Basic Settings page.')),
				E('div', {
					'id': 'oxidns-config-modes',
					'class': 'cbi-button-row',
					'style': 'display: flex; flex-wrap: wrap; gap: .5em; margin-top: 1em; padding-inline: var(--section-inset, 0);'
				}, [
					modeButton('guided', _('Normal Mode')),
					modeButton('advanced', _('Advanced Mode'))
				]),
				body,
				actionButtons(),
				E('div', { 'id': 'oxidns-config-status', 'style': 'margin-top: 1em;' })
			])
		]);

		window.setTimeout(updatePreview, 0);

		return node;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
