'use strict';
'require view';
'require rpc';
'require ui';
'require oxidns.i18n as i18n';
'require poll';

var callStatus = rpc.declare({
	object: 'luci.oxidns',
	method: 'status',
	expect: {}
});

var serviceCalls = {
	start: rpc.declare({ object: 'luci.oxidns', method: 'service_start', expect: {} }),
	stop: rpc.declare({ object: 'luci.oxidns', method: 'service_stop', expect: {} }),
	restart: rpc.declare({ object: 'luci.oxidns', method: 'service_restart', expect: {} })
};

var statusState = {};
var serviceActionsKey = null;

function valueOrDash(value) {
	if (value === null || value === undefined || value === '')
		return '-';
	return value;
}

function boolText(value) {
	return value ? _('Yes') : _('No');
}

function serviceRunning(status) {
	return !!(status && status.service_status && status.service_status.running);
}

function coreInstalled(status) {
	return !!(status && status.core && status.core.installed);
}

function statusBadge(text, good) {
	return E('span', {
		'class': good ? 'label label-success' : 'label label-warning'
	}, text);
}

function backendStatusBadge(status) {
	return status && status.ok ? statusBadge(_('Available'), true) : statusBadge(_('Unavailable'), false);
}

function serviceStatusBadge(status) {
	return serviceRunning(status) ? statusBadge(_('Running'), true) : statusBadge(_('Stopped'), false);
}

function localServiceHost(host) {
	return host === 'localhost' ||
		host === '127.0.0.1' ||
		host === '0.0.0.0' ||
		host === '::' ||
		host === '::1' ||
		host === '[::]' ||
		host === '[::1]';
}

function browserWebuiUrl(status) {
	var raw = status && status.webui && status.webui.url;
	if (!raw)
		return '';

	try {
		var url = new URL(raw, window.location.href);
		if (!(status && status.webui && status.webui.local_only) && localServiceHost(url.hostname) && window.location.hostname)
			url.hostname = window.location.hostname;
		url.pathname = url.pathname || '/';
		url.search = '';
		url.hash = '';
		return url.toString();
	} catch (e) {
		return raw;
	}
}

function webuiReady(status) {
	return !!(status && status.webui && status.webui.installed && serviceRunning(status) && browserWebuiUrl(status));
}

function webuiHint(status) {
	if (!status || !status.webui || !status.webui.installed) {
		if (!coreInstalled(status))
			return _('Install the OxiDNS core before using WebUI.');
		if (status.core && status.core.bundle === 'minimal')
			return _('The installed minimal core bundle does not include WebUI files. Install WebUI on the Settings page to replace it with a bundle that includes WebUI.');
		return _('WebUI files are not installed. Install them from the Settings page using Install WebUI.');
	}
	if (!serviceRunning(status))
		return _('Start the OxiDNS service before opening WebUI.');
	if (status.webui.local_only)
		return _('WebUI listens on loopback only. Configure the HTTP listen address to a LAN-reachable address, or use an SSH tunnel.');
	return '';
}

function webuiButton(status) {
	var url = browserWebuiUrl(status);
	var ready = webuiReady(status);
	var hint = webuiHint(status);

	if (!ready) {
		return E('button', {
			'id': 'oxidns-webui-link',
			'class': 'btn cbi-button cbi-button-neutral',
			'type': 'button',
			'disabled': 'disabled',
			'title': hint
		}, _('Open WebUI'));
	}

	return E('a', {
		'id': 'oxidns-webui-link',
		'class': 'btn cbi-button cbi-button-action',
		'href': url,
		'target': '_blank',
		'rel': 'noopener'
	}, _('Open WebUI'));
}

function webuiEntry(status) {
	var hint = webuiHint(status);

	return E('div', {
		'style': 'display: flex; flex-wrap: wrap; gap: .75em; align-items: center;'
	}, [
		webuiButton(status),
		hint ? E('span', { 'class': 'cbi-value-description' }, hint) : ''
	]);
}

function renderRow(label, value, id) {
	var attrs = { 'class': 'td left' };
	if (id)
		attrs.id = id;

	return E('div', { 'class': 'tr' }, [
		E('div', { 'class': 'td left', 'style': 'width: 240px' }, label),
		E('div', attrs, valueOrDash(value))
	]);
}

function coreSummary(status) {
	var core = status.core || {};
	var parts = [];

	parts.push(core.installed ? _('Installed') : _('Not installed'));
	if (core.version)
		parts.push(core.version);
	if (core.bundle)
		parts.push(core.bundle);
	if (core.target)
		parts.push(core.target);

	return parts.join(' · ');
}

function buildSummary(status) {
	var build = status.build || {};
	if (!build.version)
		return '-';
	return '%s · %s'.format(build.version, build.bundle || 'unknown');
}

function setNodeContent(node, value) {
	while (node.firstChild)
		node.removeChild(node.firstChild);

	if (value && value.nodeType)
		node.appendChild(value);
	else
		node.textContent = valueOrDash(value);
}

function blockedServiceActionMessage(action, status) {
	if (!coreInstalled(status))
		return _('Install the OxiDNS core before using service controls.');
	if (action === 'start' && serviceRunning(status))
		return _('OxiDNS is already running.');
	if (action === 'stop' && !serviceRunning(status))
		return _('OxiDNS is already stopped.');
	return null;
}

function handleServiceAction(action) {
	var call = serviceCalls[action];
	if (!call)
		return Promise.resolve();

	var blocked = blockedServiceActionMessage(action, statusState);
	if (blocked) {
		ui.addNotification(null, E('p', {}, blocked), 'info');
		return refreshStatus();
	}

	ui.showModal(_('OxiDNS'), [
		E('p', {}, _('Applying service action...'))
	]);

	return L.resolveDefault(call(), null).then(function(result) {
		ui.hideModal();
		if (!result || result.ok === false) {
			ui.addNotification(null, E('p', {}, i18n.message(result) || _('Service action failed')), 'danger');
			return;
		}
		return refreshStatus();
	}).catch(function(err) {
		ui.hideModal();
		ui.addNotification(null, E('p', {}, (err && err.message) || String(err)), 'danger');
	});
}

function actionButton(label, action, style, id) {
	return E('button', {
		'id': id,
		'class': 'btn cbi-button cbi-button-%s'.format(style || 'neutral'),
		'click': function(ev) {
			ev.preventDefault();
			return handleServiceAction(action);
		}
	}, label);
}

function disabledActionButton(label, hint, id) {
	return E('button', {
		'id': id,
		'class': 'btn cbi-button cbi-button-neutral',
		'type': 'button',
		'disabled': 'disabled',
		'title': hint
	}, label);
}

function serviceActionButtons(status) {
	var actions = [];

	if (!coreInstalled(status)) {
		actions.push(disabledActionButton(_('Start'), _('Install the OxiDNS core before using service controls.'), 'oxidns-service-start'));
		return actions;
	}

	if (serviceRunning(status)) {
		actions.push(actionButton(_('Stop'), 'stop', 'negative', 'oxidns-service-stop'));
		actions.push(actionButton(_('Restart'), 'restart', 'action', 'oxidns-service-restart'));
	} else {
		actions.push(actionButton(_('Start'), 'start', 'positive', 'oxidns-service-start'));
	}

	return actions;
}

function serviceActionStateKey(status) {
	return '%s:%s'.format(
		coreInstalled(status) ? 'core' : 'missing-core',
		serviceRunning(status) ? 'running' : 'stopped');
}

function replaceContent(node, content) {
	while (node.firstChild)
		node.removeChild(node.firstChild);

	if (Array.isArray(content)) {
		content.forEach(function(child) {
			if (child)
				node.appendChild(child);
		});
	} else if (content && content.nodeType) {
		node.appendChild(content);
	} else {
		node.textContent = valueOrDash(content);
	}
}

function updateServiceActions(status) {
	var node = document.getElementById('oxidns-service-actions');
	if (!node)
		return;

	var nextKey = serviceActionStateKey(status);
	if (nextKey === serviceActionsKey)
		return;

	serviceActionsKey = nextKey;
	replaceContent(node, serviceActionButtons(status));
}

function refreshStatus() {
	return L.resolveDefault(callStatus(), {}).then(function(status) {
		statusState = status || {};

		var fields = {
			'oxidns-backend-status': backendStatusBadge(statusState),
			'oxidns-core': coreSummary(statusState),
			'oxidns-build': buildSummary(statusState),
			'oxidns-service-running': serviceStatusBadge(statusState),
			'oxidns-service-enabled': boolText(statusState.service_status && statusState.service_status.enabled),
			'oxidns-webui': webuiEntry(statusState),
			'oxidns-config-path': statusState.config_path,
			'oxidns-working-dir': statusState.working_dir
		};

		Object.keys(fields).forEach(function(id) {
			var node = document.getElementById(id);
			if (node)
				setNodeContent(node, fields[id]);
		});

		updateServiceActions(statusState);
	});
}

return view.extend({
	load: function() {
		return L.resolveDefault(callStatus(), {
			ok: false,
			error: _('Unable to query OxiDNS status')
		});
	},

	render: function(status) {
		statusState = status || {};

		var rows = [
			renderRow(_('LuCI backend'), backendStatusBadge(status), 'oxidns-backend-status'),
			renderRow(_('Core'), coreSummary(status), 'oxidns-core'),
			renderRow(_('Build'), buildSummary(status), 'oxidns-build'),
			renderRow(_('Service status'), serviceStatusBadge(status), 'oxidns-service-running'),
			renderRow(_('Start on boot'), boolText(status.service_status && status.service_status.enabled), 'oxidns-service-enabled'),
			renderRow(_('WebUI'), webuiEntry(status), 'oxidns-webui'),
			renderRow(_('Config path'), status.config_path || '/etc/oxidns/config.yaml', 'oxidns-config-path'),
			renderRow(_('Working directory'), status.working_dir || '/var/lib/oxidns', 'oxidns-working-dir')
		];

		if (status.error)
			rows.push(renderRow(_('Error'), i18n.translate(status.error)));

		serviceActionsKey = serviceActionStateKey(statusState);
		poll.add(refreshStatus, 5);

		return E('div', { 'class': 'cbi-map' }, [
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Basic Settings')),
				E('div', { 'class': 'table cbi-section-table' }, rows)
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Service control')),
				E('div', { 'class': 'cbi-section-descr' },
					_('Start, stop, and restart control the running process.')),
				E('div', {
					'id': 'oxidns-service-actions',
					'class': 'cbi-button-row',
					'style': 'display: flex; flex-wrap: wrap; justify-content: flex-start; gap: .5em; padding-inline: var(--section-inset, 0); padding-bottom: var(--field-gap, 1em);'
				}, serviceActionButtons(statusState))
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
