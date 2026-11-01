'use strict';
'require baseclass';
'require ui';

var LOG_LEVELS = [ 'off', 'trace', 'debug', 'info', 'warn', 'error' ];
var LOG_ROTATIONS = [ 'never', 'minutely', 'hourly', 'daily', 'weekly' ];
var LISTEN_SERVER_TYPES = { udp_server: true, tcp_server: true, quic_server: true };

var UPSTREAM_CHOICES = null;

/*
 * LuCI's closeDropdown() resets the inline width/height of the dropdown node
 * after a selection, which would otherwise shrink the control to its content.
 * Pin the sizing through a stylesheet rule so the width stays stable.
 */
var UPSTREAM_SELECT_CLASS = 'oxidns-upstream-select';
var UPSTREAM_SELECT_STYLE = '.' + UPSTREAM_SELECT_CLASS + ' { width: 100% !important; margin: 0; text-align: left; }';

function upstreamChoices() {
	if (!UPSTREAM_CHOICES) {
		UPSTREAM_CHOICES = {
			'223.5.5.5': _('Aliyun Public DNS (223.5.5.5)'),
			'223.6.6.6': _('Aliyun Public DNS (223.6.6.6)'),
			'119.29.29.29': _('Tencent Public DNS (119.29.29.29)'),
			'119.28.28.28': _('Tencent Public DNS (119.28.28.28)'),
			'114.114.114.114': _('Xinfeng Public DNS (114.114.114.114)'),
			'180.76.76.76': _('Baidu Public DNS (180.76.76.76)'),
			'https://dns.alidns.com/dns-query': _('Aliyun Public DNS (DNS over HTTPS)'),
			'quic://dns.alidns.com': _('Aliyun Public DNS (DNS over QUIC)'),
			'https://doh.pub/dns-query': _('Tencent Public DNS (DNS over HTTPS)'),
			'https://doh.360.cn/dns-query': _('360 Public DNS (DNS over HTTPS)'),
			'tls://1.1.1.1': _('Cloudflare Public DNS (1.1.1.1)'),
			'tls://1.0.0.1': _('Cloudflare Public DNS (1.0.0.1)'),
			'tls://8.8.8.8': _('Google Public DNS (8.8.8.8)'),
			'tls://8.8.4.4': _('Google Public DNS (8.8.4.4)'),
			'tls://9.9.9.9': _('Quad9 Public DNS (9.9.9.9)'),
			'tls://149.112.112.112': _('Quad9 Public DNS (149.112.112.112)'),
			'tls://208.67.222.222': _('Cisco Public DNS (208.67.222.222)'),
			'tls://208.67.220.220': _('Cisco Public DNS (208.67.220.220)'),
			'https://cloudflare-dns.com/dns-query': _('Cloudflare Public DNS (DNS over HTTPS)'),
			'https://dns.google/dns-query': _('Google Public DNS (DNS over HTTPS)'),
			'https://dns.quad9.net/dns-query': _('Quad9 Public DNS (DNS over HTTPS)')
		};
	}

	return UPSTREAM_CHOICES;
}

function text(value) {
	if (value === null || value === undefined)
		return '';
	if (typeof value === 'object')
		return '';
	return String(value);
}

function hasNodePath(doc, path) {
	try {
		return doc.hasIn(path);
	}
	catch (err) {
		return false;
	}
}

function pluginItems(doc) {
	var seq = doc.getIn([ 'plugins' ], true);
	return seq && seq.items ? seq.items : [];
}

function pluginType(item) {
	if (!item || typeof item.get !== 'function')
		return '';
	return text(item.get('type'));
}

function pluginTag(item, index) {
	if (item && typeof item.get === 'function') {
		var tag = text(item.get('tag'));
		if (tag)
			return tag;
	}
	return '#' + (index + 1);
}

function row(label, control, description) {
	return E('div', { 'class': 'tr' }, [
		E('div', { 'class': 'td left', 'style': 'width: 240px' }, label),
		E('div', { 'class': 'td left' }, [
			control,
			description ? E('div', { 'class': 'cbi-value-description', 'style': 'margin-top: .35em;' }, description) : ''
		])
	]);
}

function noteRow(message) {
	return E('div', { 'class': 'tr' }, [
		E('div', { 'class': 'td left', 'style': 'padding: .5em 0; color: inherit; opacity: .8;' }, message)
	]);
}

function section(title, description, rows, tableStyle, footer) {
	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, title),
		description ? E('div', { 'class': 'cbi-section-descr' }, description) : '',
		E('div', { 'class': 'table cbi-section-table', 'style': tableStyle || null }, rows),
		footer || ''
	]);
}

function textInput(id, value, placeholder) {
	return E('input', {
		'id': id,
		'class': 'cbi-input-text',
		'type': 'text',
		'value': value || '',
		'placeholder': placeholder || null
	});
}

function upstreamSelect(id, value) {
	var combobox = new ui.Combobox(value || '', upstreamChoices(), {
		'id': id,
		'sort': false,
		'select_placeholder': _('Select an upstream DNS server'),
		'custom_placeholder': _('Enter a custom upstream address')
	});

	var node = combobox.render();
	node.classList.add(UPSTREAM_SELECT_CLASS);
	return node;
}

function levelSelect(id, value) {
	var levels = LOG_LEVELS.slice();
	if (value && levels.indexOf(value) === -1)
		levels.push(value);

	return E('select', { 'id': id, 'class': 'cbi-input-select' },
		levels.map(function(level) {
			return E('option', {
				'value': level,
				'selected': level === value ? 'selected' : null
			}, level);
		}));
}

function rotationSelect(id, value) {
	var rotations = LOG_ROTATIONS.slice();
	if (value && rotations.indexOf(value) === -1)
		rotations.push(value);

	return E('select', { 'id': id, 'class': 'cbi-input-select' },
		rotations.map(function(rotation) {
			return E('option', {
				'value': rotation,
				'selected': rotation === value ? 'selected' : null
			}, rotation);
		}));
}

function addBinding(bindings, id, path, empty, kind, defaultValue) {
	bindings.push({
		'id': id,
		'path': path,
		'empty': empty || 'set',
		'kind': kind || 'string',
		'default': defaultValue
	});
}

function bindingValue(doc, path) {
	var value = doc.getIn(path, true);

	if (value && typeof value.toJSON === 'function')
		value = value.toJSON();

	return value;
}

function editedLines(input) {
	return String(input.value || '').split('\n').map(function(line) {
		return line.trim();
	}).filter(function(line) {
		return line.length > 0;
	});
}

function sameLines(current, lines) {
	var currentLines = Array.isArray(current) ? current : (typeof current === 'string' ? [ current ] : null);

	if (!currentLines || currentLines.length !== lines.length)
		return false;

	for (var i = 0; i < lines.length; i++) {
		if (text(currentLines[i]) !== lines[i])
			return false;
	}

	return true;
}

function applyBindings(doc, bindings) {
	for (var i = 0; i < bindings.length; i++) {
		var binding = bindings[i];
		var input = document.getElementById(binding.id);

		if (!input)
			continue;

		var kind = binding.kind || 'string';

		try {
			var present = hasNodePath(doc, binding.path);
			var current = present ? bindingValue(doc, binding.path) : undefined;

			if (kind === 'boolean') {
				var unchanged = present
					? input.checked === (current === true)
					: input.checked === (binding['default'] === true);

				if (unchanged)
					continue;

				doc.setIn(binding.path, !!input.checked);
				continue;
			}

			var value = String(input.value || '').trim();
			var defaultValue = binding['default'] === undefined ? '' : String(binding['default']);

			if (kind === 'string-list') {
				var lines = editedLines(input);

				if (!present) {
					if (!lines.length || (Array.isArray(binding['default']) && sameLines(binding['default'], lines)))
						continue;
				}
				else if (sameLines(current, lines)) {
					continue;
				}

				if (!lines.length) {
					if (present)
						doc.deleteIn(binding.path);
				}
				else {
					doc.setIn(binding.path, doc.createNode(lines));
				}
				continue;
			}

			/*
			 * Do not turn an absent node into an explicit value when the form
			 * still shows the documented default, and do not rewrite a value
			 * that is already stored as the form shows it. Both would make the
			 * change preview report edits the user never made.
			 */
			if (!present ? value === defaultValue : String(current) === value)
				continue;

			if (!value) {
				if (binding.empty === 'delete') {
					if (present)
						doc.deleteIn(binding.path);
				}
				else {
					doc.setIn(binding.path, '');
				}
				continue;
			}

			if (kind === 'number') {
				var number = Number(value);

				if (!isFinite(number))
					continue;

				doc.setIn(binding.path, number);
				continue;
			}

			doc.setIn(binding.path, value);
		}
		catch (err) {
			/* Leave the node untouched; oxidns check reports the real problem. */
		}
	}
}

function logSection(doc, bindings) {
	var level = text(doc.getIn([ 'log', 'level' ])) || 'info';
	var file = text(doc.getIn([ 'log', 'file' ]));
	var rotation = text(doc.getIn([ 'log', 'rotation', 'type' ])) || 'never';
	var maxFiles = text(doc.getIn([ 'log', 'rotation', 'max_files' ]));

	addBinding(bindings, 'oxidns-cfg-log-level', [ 'log', 'level' ], 'delete', 'string', 'info');
	addBinding(bindings, 'oxidns-cfg-log-file', [ 'log', 'file' ], 'delete');
	addBinding(bindings, 'oxidns-cfg-log-rotation', [ 'log', 'rotation', 'type' ], 'delete', 'string', 'never');
	addBinding(bindings, 'oxidns-cfg-log-rotation-max-files', [ 'log', 'rotation', 'max_files' ], 'delete', 'number');

	return section(_('Log'), null, [
		row(_('Log level'), levelSelect('oxidns-cfg-log-level', level)),
		row(_('Log file'), textInput('oxidns-cfg-log-file', file, '/tmp/oxidns/oxidns.log'),
			_('Leave empty to stop writing to a log file.')),
		row(_('Rotation'), rotationSelect('oxidns-cfg-log-rotation', rotation)),
		row(_('Maximum rotation files'), E('input', {
			'id': 'oxidns-cfg-log-rotation-max-files',
			'class': 'cbi-input-text',
			'type': 'number',
			'step': '1',
			'min': '0',
			'value': maxFiles
		}), _('Set to 0 to keep all historical rotation files.'))
	]);
}

function apiSection(doc, bindings) {
	var http = plainValue(doc, [ 'api', 'http' ]);
	var shorthand = typeof http === 'string';
	var listen = shorthand ? http : text(doc.getIn([ 'api', 'http', 'listen' ]));

	addBinding(bindings, 'oxidns-cfg-api-listen',
		shorthand ? [ 'api', 'http' ] : [ 'api', 'http', 'listen' ], 'delete');

	var rows = [
		row(_('HTTP listen'), textInput('oxidns-cfg-api-listen', listen, '0.0.0.0:9199'))
	];

	if (shorthand) {
		rows.push(noteRow(_('The API uses the shorthand form (api.http: "ip:port"). This form only sets the listen address and cannot serve WebUI files. Use Advanced Mode to switch to the expanded form before configuring WebUI.')));
	}
	else {
		addBinding(bindings, 'oxidns-cfg-api-root', [ 'api', 'http', 'webui', 'root' ], 'delete');
		addBinding(bindings, 'oxidns-cfg-api-index', [ 'api', 'http', 'webui', 'index' ], 'delete', 'string', 'index.html');

		rows.push(row(_('WebUI root'),
			textInput('oxidns-cfg-api-root', text(doc.getIn([ 'api', 'http', 'webui', 'root' ])),
				'/usr/share/oxidns/webui')));
		rows.push(row(_('WebUI index'),
			textInput('oxidns-cfg-api-index',
				text(doc.getIn([ 'api', 'http', 'webui', 'index' ])) || 'index.html')));
	}

	return section(_('API'), null, rows);
}

function listenSection(doc, bindings) {
	var rows = [];

	pluginItems(doc).forEach(function(item, index) {
		if (!LISTEN_SERVER_TYPES[pluginType(item)])
			return;

		var tag = pluginTag(item, index);
		var entryId = 'oxidns-cfg-entry-%d'.format(index);
		var listenId = 'oxidns-cfg-listen-%d'.format(index);

		addBinding(bindings, entryId, [ 'plugins', index, 'args', 'entry' ], 'delete');
		addBinding(bindings, listenId, [ 'plugins', index, 'args', 'listen' ], 'delete');

		rows.push(row(_('Entry') + ' (' + tag + ')',
			textInput(entryId, text(doc.getIn([ 'plugins', index, 'args', 'entry' ])))));
		rows.push(row(_('Listen') + ' (' + tag + ')',
			textInput(listenId, text(doc.getIn([ 'plugins', index, 'args', 'listen' ])), ':5335')));
	});

	if (!rows.length)
		rows.push(noteRow(_('No UDP, TCP, or QUIC server plugins were found.')));

	return section(_('Listen Addresses'),
		_('Define which address and entry the UDP, TCP, and QUIC server plugins listen on.'), rows);
}

function upstreamButton(label, onClick, options) {
	return E('button', {
		'class': 'btn cbi-button cbi-button-neutral',
		'click': function(ev) {
			ev.preventDefault();
			options.beforeChange();
			onClick();
			options.rerender();
		}
	}, label);
}

var UPSTREAM_FIELDS = [
	{ 'key': 'tag', 'type': 'text', 'label': _('Tag') },
	{ 'key': 'outbound', 'type': 'text', 'label': _('Outbound profile') },
	{ 'key': 'dial_addr', 'type': 'text', 'label': _('Dial address'), 'placeholder': '203.0.113.1' },
	{ 'key': 'port', 'type': 'number', 'label': _('Port override'), 'min': 1, 'max': 65535 },
	{ 'key': 'bootstrap', 'type': 'text', 'label': _('Bootstrap server'), 'placeholder': '8.8.8.8:53' },
	{ 'key': 'bootstrap_version', 'type': 'select', 'label': _('Bootstrap IP version'), 'values': [
		{ 'value': '4', 'label': _('IPv4') },
		{ 'value': '6', 'label': _('IPv6') }
	] },
	{ 'key': 'socks5', 'type': 'text', 'label': _('SOCKS5 proxy'), 'placeholder': '127.0.0.1:1080' },
	{ 'key': 'timeout', 'type': 'text', 'label': _('Query timeout'), 'placeholder': '5s' },
	{ 'key': 'idle_timeout', 'type': 'number', 'label': _('Idle timeout'), 'min': 0, 'placeholder': '10' },
	{ 'key': 'max_conns', 'type': 'number', 'label': _('Max connections'), 'min': 1, 'max': 4096, 'placeholder': '64' },
	{ 'key': 'min_conns', 'type': 'number', 'label': _('Min connections'), 'min': 0, 'max': 4096, 'placeholder': '0' },
	{ 'key': 'insecure_skip_verify', 'type': 'boolean', 'label': _('Skip TLS verification'),
		'help': _('Disables certificate verification for this upstream.') },
	{ 'key': 'enable_pipeline', 'type': 'boolean', 'label': _('Enable pipeline') },
	{ 'key': 'enable_http3', 'type': 'boolean', 'label': _('Enable HTTP/3') },
	{ 'key': 'so_mark', 'type': 'number', 'label': _('SO_MARK'), 'min': 0, 'max': 4294967295 },
	{ 'key': 'bind_to_device', 'type': 'text', 'label': _('Bind to device'), 'placeholder': 'eth0' }
];

function upstreamFieldPath(index, position, key) {
	return [ 'plugins', index, 'args', 'upstreams', position, key ];
}

function upstreamFieldId(index, position, key) {
	return 'oxidns-cfg-upstream-%d-%d-%s'.format(index, position, key);
}

function upstreamFieldControl(doc, index, position, field, bindings) {
	var path = upstreamFieldPath(index, position, field.key);
	var id = upstreamFieldId(index, position, field.key);
	var value = plainValue(doc, path);
	var absent = value === undefined || value === null;

	switch (field.type) {
	case 'boolean':
		addBinding(bindings, id, path, 'delete', 'boolean');
		return E('label', { 'style': 'display: inline-flex; gap: .5em; align-items: center;' }, [
			E('input', {
				'id': id,
				'type': 'checkbox',
				'style': 'position: static; top: auto; right: auto; margin: 0;',
				'checked': value === true ? 'checked' : null
			}),
			field.label
		]);

	case 'number':
		addBinding(bindings, id, path, 'delete', 'number');
		return E('input', {
			'id': id,
			'class': 'cbi-input-text',
			'type': 'number',
			'step': '1',
			'style': 'width: 210px; box-sizing: border-box;',
			'min': field.min !== undefined ? field.min : null,
			'max': field.max !== undefined ? field.max : null,
			'value': absent ? '' : String(value),
			'placeholder': field.placeholder || null
		});

	case 'select':
		addBinding(bindings, id, path, 'delete', 'number');
		return E('select', {
			'id': id,
			'class': 'cbi-input-select',
			'style': 'width: 210px; box-sizing: border-box;'
		},
			[
				E('option', { 'value': '', 'selected': absent ? 'selected' : null }, _('Default'))
			].concat(field.values.map(function(option) {
				return E('option', {
					'value': option.value,
					'selected': !absent && String(value) === option.value ? 'selected' : null
				}, option.label);
			})));

	default:
		addBinding(bindings, id, path, 'delete', 'string');
		return E('input', {
			'id': id,
			'class': 'cbi-input-text',
			'type': 'text',
			'style': 'width: 210px; box-sizing: border-box;',
			'value': text(value),
			'placeholder': field.placeholder || null
		});
	}
}

function upstreamAdvancedPresent(doc, index, position) {
	return UPSTREAM_FIELDS.some(function(field) {
		return hasNodePath(doc, upstreamFieldPath(index, position, field.key));
	});
}

function upstreamAdvancedRows(doc, index, position, bindings) {
	var rows = [
		E('div', { 'class': 'tr' }, [
			E('div', { 'class': 'td left', 'style': 'width: 240px' }, ''),
			E('div', { 'class': 'td left' }, E('div', { 'class': 'cbi-value-description' },
				_('Leave fields empty to use the protocol defaults.')))
		])
	];

	UPSTREAM_FIELDS.forEach(function(field) {
		rows.push(row(
			field.type === 'boolean' ? '' : field.label,
			upstreamFieldControl(doc, index, position, field, bindings),
			field.help || null
		));
	});

	return rows;
}

function upstreamSection(doc, bindings, options) {
	var rows = [];
	var footers = [];
	var found = false;

	pluginItems(doc).forEach(function(item, index) {
		if (pluginType(item) !== 'forward')
			return;

		found = true;

		var tag = pluginTag(item, index);
		var seq = doc.getIn([ 'plugins', index, 'args', 'upstreams' ], true);
		var upstreams = seq && seq.items ? seq.items : [];

		rows.push(E('div', { 'class': 'tr' }, [
			E('div', { 'class': 'td left', 'style': 'width: 240px' }, E('strong', {}, _('Plugin') + ': ' + tag)),
			E('div', { 'class': 'td left' }, '')
		]));

		upstreams.forEach(function(upstream, position) {
			var id = 'oxidns-cfg-upstream-%d-%d'.format(index, position);
			var address = text(doc.getIn([ 'plugins', index, 'args', 'upstreams', position, 'addr' ]));

			addBinding(bindings, id,
				[ 'plugins', index, 'args', 'upstreams', position, 'addr' ], 'delete');

			var advancedRows = upstreamAdvancedRows(doc, index, position, bindings);
			var expanded = upstreamAdvancedPresent(doc, index, position);

			advancedRows.forEach(function(advancedRow) {
				advancedRow.style.display = expanded ? '' : 'none';
			});

			var toggle = E('button', {
				'id': 'oxidns-cfg-upstream-options-toggle-%d-%d'.format(index, position),
				'class': 'btn cbi-button cbi-button-neutral',
				'click': function(ev) {
					ev.preventDefault();
					var show = advancedRows[0].style.display === 'none';
					advancedRows.forEach(function(advancedRow) {
						advancedRow.style.display = show ? '' : 'none';
					});
					toggle.textContent = show ? _('Hide options') : _('Options');
					toggle.setAttribute('aria-expanded', show ? 'true' : 'false');
				}
			}, expanded ? _('Hide options') : _('Options'));
			toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');

			rows.push(row(_('Upstream address') + ' ' + (position + 1),
				E('div', { 'style': 'display: flex; gap: .5em; align-items: center; justify-content: flex-start; width: 100%; flex-wrap: wrap;' }, [
					E('div', { 'style': 'flex: 0 0 210px; width: 210px; min-width: 0;' }, [
						upstreamSelect(id, address)
					]),
					toggle,
					upstreamButton(_('Remove'), function() {
						doc.deleteIn([ 'plugins', index, 'args', 'upstreams', position ]);
					}, options)
				])));

			advancedRows.forEach(function(advancedRow) {
				rows.push(advancedRow);
			});
		});

		if (!upstreams.length)
			rows.push(noteRow(_('No upstream servers configured.')));

		footers.push(E('div', {
			'style': 'display: flex; justify-content: flex-start; padding-inline: var(--section-inset, 0); margin-top: .75em;'
		}, [
			E('button', {
				'class': 'btn cbi-button cbi-button-action',
				'click': function(ev) {
					ev.preventDefault();
					options.beforeChange();
					var path = [ 'plugins', index, 'args', 'upstreams' ];
					if (!hasNodePath(doc, path))
						doc.setIn(path, doc.createNode([]));
					doc.addIn(path, doc.createNode({ 'addr': '' }));
					options.rerender();
				}
			}, _('Add upstream DNS'))
		]));
	});

	if (!found)
		rows.push(noteRow(_('No forward plugins were found.')));

	return section(_('Upstream DNS'),
		_('Queries are forwarded to these upstream servers.') + ' ' +
		_('Use Options to set per-upstream connection details.'),
		rows, 'table-layout: fixed;', footers.length ? E('div', {}, footers) : null);
}

function schemaDefinitions(options) {
	var schema = options && options.schema;
	var plugins = schema && schema.plugins;

	return plugins && typeof plugins === 'object' ? plugins : null;
}

function plainValue(doc, path) {
	var value = doc.getIn(path, true);

	if (value && typeof value.toJSON === 'function')
		value = value.toJSON();

	return value;
}

function schemaFieldId(pluginIndex, fieldIndex) {
	return 'oxidns-cfg-p%d-f%d'.format(pluginIndex, fieldIndex);
}

function schemaEnumValues(field) {
	return (Array.isArray(field.values) ? field.values : []).map(function(entry) {
		if (entry && typeof entry === 'object') {
			var entryValue = entry.value === undefined ? '' : String(entry.value);
			return {
				'value': entryValue,
				'label': _(text(entry.label) || entryValue)
			};
		}

		return {
			'value': String(entry),
			'label': String(entry)
		};
	});
}

function schemaEnumSelect(field, id, value) {
	var options = [
		E('option', {
			'value': '',
			'selected': value ? null : 'selected'
		}, _(text(field.placeholder) || _('Default')))
	];
	var matched = !value;

	schemaEnumValues(field).forEach(function(entry) {
		if (entry.value === value)
			matched = true;

		options.push(E('option', {
			'value': entry.value,
			'selected': entry.value === value ? 'selected' : null
		}, entry.label));
	});

	if (!matched)
		options.push(E('option', { 'value': value, 'selected': 'selected' }, value));

	return E('select', { 'id': id, 'class': 'cbi-input-select' }, options);
}

function schemaListValue(value) {
	if (Array.isArray(value))
		return value.map(function(entry) {
			return text(entry);
		}).join('\n');

	return typeof value === 'string' ? value : '';
}

function schemaControl(doc, index, fieldIndex, field, bindings) {
	var path = [ 'plugins', index, 'args' ].concat(field.path);
	var id = schemaFieldId(index, fieldIndex);
	var value = plainValue(doc, path);
	var empty = field.empty === 'set' ? 'set' : 'delete';
	var absent = value === undefined || value === null;
	var defaultValue = field['default'];
	var display = absent && defaultValue !== undefined ? defaultValue : value;
	var displayText = display === undefined || display === null ? '' : String(display);

	switch (field.type) {
	case 'boolean':
		addBinding(bindings, id, path, empty, 'boolean', defaultValue);
		return E('label', { 'style': 'display: inline-flex; gap: .5em; align-items: center;' }, [
			E('input', {
				'id': id,
				'type': 'checkbox',
				'style': 'position: static; top: auto; right: auto; margin: 0;',
				'checked': (absent ? defaultValue === true : value === true) ? 'checked' : null
			}),
			_(text(field.label))
		]);

	case 'integer':
	case 'number':
		addBinding(bindings, id, path, empty, 'number', defaultValue);
		return E('input', {
			'id': id,
			'class': 'cbi-input-text',
			'type': 'number',
			'step': field.type === 'integer' ? '1' : 'any',
			'min': field.min !== undefined ? field.min : null,
			'max': field.max !== undefined ? field.max : null,
			'value': displayText,
			'placeholder': text(field.placeholder) || null
		});

	case 'enum':
		addBinding(bindings, id, path, empty, 'string', defaultValue);
		return schemaEnumSelect(field, id, displayText);

	case 'string-list':
		addBinding(bindings, id, path, empty, 'string-list', defaultValue);
		return E('textarea', {
			'id': id,
			'class': 'cbi-input-textarea',
			'rows': field.rows || 4,
			'style': 'width: 100%; font-family: monospace;',
			'placeholder': text(field.placeholder) || null
		}, schemaListValue(display));

	default:
		addBinding(bindings, id, path, empty, 'string', defaultValue);
		return textInput(id, displayText, text(field.placeholder));
	}
}

function schemaSections(doc, bindings, options) {
	var definitions = schemaDefinitions(options);
	var sections = [];

	if (!definitions)
		return sections;

	pluginItems(doc).forEach(function(item, index) {
		var type = pluginType(item);
		var definition = definitions[type];

		if (!definition || !Array.isArray(definition.fields))
			return;

		var rows = [];

		definition.fields.forEach(function(field, fieldIndex) {
			if (!field || !Array.isArray(field.path) || !field.path.length)
				return;

			rows.push(row(
				field.type === 'boolean' ? '' : _(text(field.label) || field.path.join('.')),
				schemaControl(doc, index, fieldIndex, field, bindings),
				field.help ? _(field.help) : null
			));
		});

		if (!rows.length)
			return;

		sections.push(section(
			_(text(definition.title) || type) + ' (' + pluginTag(item, index) + ')',
			definition.description ? _(definition.description) : null,
			rows
		));
	});

	return sections;
}

function argsSummary(item) {
	if (!item || typeof item.get !== 'function')
		return '-';

	var args = item.get('args');

	if (args && typeof args.toJSON === 'function')
		args = args.toJSON();

	if (Array.isArray(args))
		return '%d step(s)'.format(args.length);

	if (args && typeof args === 'object') {
		var keys = Object.keys(args);
		return keys.length ? keys.join(', ') : '-';
	}

	return '-';
}

var PLUGIN_TYPE_CATEGORIES = [ 'servers', 'executors', 'matchers', 'providers' ];

function pluginTypeSupport(pluginTypes) {
	var plugins = pluginTypes && pluginTypes.plugins;

	if (!plugins || typeof plugins !== 'object')
		return null;

	var supported = {};

	PLUGIN_TYPE_CATEGORIES.forEach(function(category) {
		var list = plugins[category];

		if (!Array.isArray(list))
			return;

		list.forEach(function(type) {
			supported[text(type)] = true;
		});
	});

	return {
		'supported': supported,
		'core': text(pluginTypes.source) === 'core'
	};
}

function pluginTypeStatus(type, support) {
	if (!type)
		return '-';

	if (support.supported[type])
		return E('span', { 'style': 'color: var(--success-color-high, #2e7d32);' }, _('Supported'));

	return E('span', { 'style': 'color: var(--danger-color-high, #b71c1c);' },
		support.core ? _('Not supported by this core') : _('Unknown plugin type'));
}

function pluginSection(doc, options) {
	var support = pluginTypeSupport(options && options.pluginTypes);
	var rows = [
		E('div', { 'class': 'tr' }, [
			E('div', { 'class': 'td left', 'style': 'width: 240px' }, E('strong', {}, _('Tag'))),
			E('div', { 'class': 'td left', 'style': 'width: 160px' }, E('strong', {}, _('Type'))),
			E('div', { 'class': 'td left' }, E('strong', {}, _('Arguments'))),
			support ? E('div', { 'class': 'td left', 'style': 'width: 200px' }, E('strong', {}, _('Status'))) : ''
		])
	];

	var items = pluginItems(doc);

	items.forEach(function(item, index) {
		var type = pluginType(item);

		rows.push(E('div', { 'class': 'tr' }, [
			E('div', { 'class': 'td left' }, pluginTag(item, index)),
			E('div', { 'class': 'td left' }, type || '-'),
			E('div', { 'class': 'td left' }, argsSummary(item)),
			support ? E('div', { 'class': 'td left' }, pluginTypeStatus(type, support)) : ''
		]));
	});

	if (!items.length)
		rows.push(noteRow(_('No plugins are configured.')));

	var description = _('Normal mode covers common settings only. Use Advanced Mode to edit plugins and options not listed here.');

	if (support)
		description += ' ' + (support.core
			? _('Plugin types are read from the installed OxiDNS core.')
			: _('The OxiDNS core is not installed, so plugin types come from the built-in catalog.'));

	return section(_('Plugins'), description, rows);
}

function validateConfig(doc) {
	var problems = [];

	pluginItems(doc).forEach(function(item, index) {
		if (pluginType(item) !== 'forward')
			return;

		var tag = pluginTag(item, index);
		var seq = doc.getIn([ 'plugins', index, 'args', 'upstreams' ], true);
		var upstreams = seq && seq.items ? seq.items : [];

		if (!upstreams.length) {
			problems.push(_('The forward plugin %s needs at least one upstream server.').format(tag));
			return;
		}

		upstreams.forEach(function(upstream, position) {
			var addr = text(doc.getIn([ 'plugins', index, 'args', 'upstreams', position, 'addr' ]));
			var maxPath = [ 'plugins', index, 'args', 'upstreams', position, 'max_conns' ];
			var minPath = [ 'plugins', index, 'args', 'upstreams', position, 'min_conns' ];
			var maxConns = hasNodePath(doc, maxPath) ? Number(plainValue(doc, maxPath)) : 64;
			var minConns = hasNodePath(doc, minPath) ? Number(plainValue(doc, minPath)) : 0;

			if (!addr)
				problems.push(_('Upstream address %d of the forward plugin %s cannot be empty.').format(position + 1, tag));

			if (isFinite(minConns) && isFinite(maxConns) && minConns > maxConns)
				problems.push(_('Upstream %d of the forward plugin %s keeps more minimum connections than its maximum.').format(position + 1, tag));
		});
	});

	return problems;
}

function isAliasNode(node) {
	return !!(node && typeof node === 'object' && typeof node.resolve === 'function' &&
		typeof node.source === 'string');
}

function hasAnchorsOrAliases(node) {
	var found = false;

	function visit(current) {
		if (found || !current || typeof current !== 'object')
			return;

		if (isAliasNode(current) || current.anchor) {
			found = true;
			return;
		}

		if (Array.isArray(current.items))
			current.items.forEach(visit);

		if (current.key) {
			if (current.key.value === '<<')
				found = true;

			visit(current.key);
		}

		visit(current.value);
	}

	visit(node);

	return found;
}

return baseclass.extend({
	render: function(doc, options) {
		var bindings = [];
		var handlers = options || {};

		var sections = [
			E('style', {}, UPSTREAM_SELECT_STYLE),
			logSection(doc, bindings),
			apiSection(doc, bindings),
			listenSection(doc, bindings),
			upstreamSection(doc, bindings, handlers)
		].concat(schemaSections(doc, bindings, handlers));

		sections.push(pluginSection(doc, handlers));

		var node = E('div', {}, sections);

		if (typeof handlers.onInput === 'function') {
			node.addEventListener('input', handlers.onInput);
			node.addEventListener('change', handlers.onInput);
			node.addEventListener('cbi-dropdown-change', handlers.onInput);
		}

		return {
			'node': node,
			'bindings': bindings
		};
	},

	apply: applyBindings,
	validate: validateConfig,
	isReadOnly: function(doc) {
		return !!(doc && hasAnchorsOrAliases(doc.contents));
	}
});
