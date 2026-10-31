'use strict';
'require view';
'require rpc';
'require poll';

var callLogsRecent = rpc.declare({
	object: 'luci.oxidns',
	method: 'logs_recent',
	params: [ 'limit' ],
	expect: {}
});

var callLogsPathRead = rpc.declare({
	object: 'luci.oxidns',
	method: 'logs_path_read',
	expect: {}
});

var callLogsPathSave = rpc.declare({
	object: 'luci.oxidns',
	method: 'logs_path_save',
	params: [ 'path', 'base_mtime' ],
	expect: {}
});

var DEFAULT_LOG_DIR = '/tmp/oxidns';

var state = {
	lines: [],
	pending: [],
	rawLines: [],
	paused: false,
	followTail: true,
	limit: 100,
	clearBaseline: null,
	logDir: DEFAULT_LOG_DIR,
	pathMtime: ''
};

function byId(id) {
	return document.getElementById(id);
}

function normalizeLines(result) {
	var lines = result && result.lines;
	return Array.isArray(lines) ? lines : [];
}

function trimClearedLines(lines) {
	var baseline = state.clearBaseline;
	var remove = 0;

	if (!baseline || !baseline.length)
		return lines;

	for (var i = Math.min(baseline.length, lines.length); i > 0; i--) {
		var match = true;

		for (var j = 0; j < i; j++) {
			if (baseline[baseline.length - i + j] !== lines[j]) {
				match = false;
				break;
			}
		}

		if (match) {
			remove = i;
			break;
		}
	}

	if (remove > 0)
		return lines.slice(remove);

	return lines;
}

function afterPaint(fn) {
	if (window.requestAnimationFrame)
		window.requestAnimationFrame(fn);
	else
		window.setTimeout(fn, 0);
}

function isNearBottom(node) {
	return node.scrollHeight - node.scrollTop - node.clientHeight < 24;
}

function scrollLogToBottom() {
	var log = byId('oxidns-log-lines');
	if (log)
		log.scrollTop = log.scrollHeight;
}

function renderLines() {
	var log = byId('oxidns-log-lines');
	if (!log)
		return;

	var shouldFollow = state.followTail || isNearBottom(log);
	log.textContent = state.lines.join('\n');

	if (shouldFollow) {
		state.followTail = true;
		afterPaint(scrollLogToBottom);
	}
}

function updatePauseButton() {
	var button = byId('oxidns-log-pause-toggle');
	if (!button)
		return;

	button.textContent = state.paused ? _('Resume') : _('Pause');
	button.className = 'btn cbi-button cbi-button-%s'.format(state.paused ? 'positive' : 'neutral');
}

function refreshLogs() {
	return L.resolveDefault(callLogsRecent(state.limit), null).then(function(result) {
		if (!result || result.ok === false)
			return;

		state.rawLines = normalizeLines(result);

		var lines = trimClearedLines(state.rawLines);

		if (state.paused)
			state.pending = lines;
		else
			state.lines = lines;

		renderLines();
	});
}

function setPaused(paused) {
	state.paused = paused;
	if (!paused && state.pending.length) {
		state.lines = state.pending;
		state.pending = [];
	}
	updatePauseButton();
	renderLines();
}

function togglePaused() {
	return setPaused(!state.paused);
}

function clearLogs() {
	var currentLines = state.paused && state.pending.length
		? state.pending.slice()
		: state.lines.slice();
	var baseline = state.rawLines.length
		? state.rawLines.slice()
		: currentLines;

	if (baseline.length)
		state.clearBaseline = baseline;

	state.lines = [];
	state.pending = [];
	state.followTail = true;
	renderLines();
}

function controlButton(label, handler, style) {
	return E('button', {
		'class': 'btn cbi-button cbi-button-%s'.format(style || 'neutral'),
		'click': function(ev) {
			ev.preventDefault();
			return handler();
		}
	}, label);
}

function setPathStatus(message, isError) {
	var node = byId('oxidns-log-path-status');
	if (!node)
		return;

	node.textContent = message || '';
	node.style.color = isError ? 'var(--error-color, #d33)' : '';
}

function applyPathInfo(info) {
	if (!info || info.ok === false)
		return;

	state.logDir = info.log_dir || info.default_dir || DEFAULT_LOG_DIR;
	state.pathMtime = info.mtime || '';

	var input = byId('oxidns-log-dir');
	if (input) {
		input.value = state.logDir;
		input.placeholder = info.default_dir || DEFAULT_LOG_DIR;
	}
}

function loadLogPath() {
	return L.resolveDefault(callLogsPathRead(), null).then(function(info) {
		if (!info || info.ok === false) {
			setPathStatus(_('Unable to load the log path.'), true);
			return;
		}

		applyPathInfo(info);
	});
}

function saveLogPath() {
	var input = byId('oxidns-log-dir');
	var path = input ? (input.value || '').trim() : '';
	var saveButton = byId('oxidns-log-path-save');

	if (!path) {
		setPathStatus(_('Log path is required.'), true);
		if (input)
			input.focus();
		return;
	}

	if (saveButton)
		saveButton.disabled = true;
	setPathStatus(_('Saving log path...'));

	return L.resolveDefault(callLogsPathSave(path, state.pathMtime || ''), null).then(function(result) {
		if (saveButton)
			saveButton.disabled = false;

		if (!result || result.ok === false) {
			setPathStatus((result && result.message) || _('Failed to save the log path.'), true);
			return;
		}

		applyPathInfo(result);
		setPathStatus(result.restart === 'restarted'
			? _('Log path saved. OxiDNS service restarted.')
			: _('Log path saved.'));

		return refreshLogs();
	});
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callLogsRecent(state.limit), null),
			L.resolveDefault(callLogsPathRead(), null)
		]).then(function(results) {
			return {
				logs: results[0] || { ok: true, source: 'logread', lines: [] },
				path: results[1] || null
			};
		});
	},

	render: function(initial) {
		var logs = initial && initial.logs ? initial.logs : initial;

		state.lines = normalizeLines(logs);
		state.pending = [];
		state.rawLines = state.lines.slice();
		state.paused = false;
		state.followTail = true;
		state.clearBaseline = null;
		state.logDir = DEFAULT_LOG_DIR;
		state.pathMtime = '';

		if (initial && initial.path && initial.path.ok !== false)
			applyPathInfo(initial.path);
		else
			window.setTimeout(loadLogPath, 0);

		window.setTimeout(refreshLogs, 0);
		poll.add(refreshLogs, 1);

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('OxiDNS Logs')),
			E('div', { 'class': 'cbi-map-descr' },
				_('View recent OxiDNS log entries.')),
			E('div', { 'class': 'cbi-section' }, [
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title', 'for': 'oxidns-log-dir' }, _('Log path')),
					E('div', { 'class': 'cbi-value-field' }, [
						E('div', { 'style': 'display: flex; flex-wrap: wrap; gap: .5em; align-items: center;' }, [
							E('input', {
								'id': 'oxidns-log-dir',
								'type': 'text',
								'class': 'cbi-input-text',
								'value': state.logDir,
								'placeholder': DEFAULT_LOG_DIR,
								'spellcheck': 'false',
								'style': 'flex: 1 1 22em; min-width: 12em;',
								'keydown': function(ev) {
									if (ev.key === 'Enter') {
										ev.preventDefault();
										return saveLogPath();
									}
								}
							}),
							E('button', {
								'id': 'oxidns-log-path-save',
								'class': 'btn cbi-button cbi-button-action',
								'click': function(ev) {
									ev.preventDefault();
									return saveLogPath();
								}
							}, _('Save'))
						]),
						E('div', {
							'id': 'oxidns-log-path-status',
							'class': 'cbi-value-description',
							'style': 'min-height: 1.2em;'
						}, ''),
						E('div', { 'class': 'cbi-value-description' },
							_('OxiDNS writes oxidns.log in this directory. Default: /tmp/oxidns. Saving restarts OxiDNS when it is running.'))
					])
				]),
				E('div', {
					'class': 'cbi-button-row',
					'style': 'display: flex; flex-wrap: wrap; gap: .5em; margin-bottom: 1.5em; padding-inline: var(--section-inset, .75em);'
				}, [
					E('button', {
						'id': 'oxidns-log-pause-toggle',
						'class': 'btn cbi-button cbi-button-neutral',
						'click': function(ev) {
							ev.preventDefault();
							return togglePaused();
						}
					}, _('Pause')),
					controlButton(_('Refresh'), refreshLogs, 'action'),
					controlButton(_('Clear'), clearLogs, 'negative')
				]),
				E('pre', {
					'id': 'oxidns-log-lines',
					'scroll': function(ev) {
						state.followTail = isNearBottom(ev.target);
					},
					'style': 'min-height: 560px; max-height: 72vh; overflow: auto; margin-top: .25em; padding: 1em; border: 1px solid var(--border-color, var(--border-color-medium, #ccc)); border-radius: var(--radius-control, .375rem); background: var(--command-bg, var(--background-color-low, #111)); color: var(--log-text, var(--text-color-high, #ddd)); white-space: pre-wrap; overflow-wrap: anywhere;'
				}, state.lines.join('\n'))
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
