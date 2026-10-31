'use strict';
'require view';
'require rpc';
'require ui';
'require oxidns.i18n as i18n';

var callSettingsRead = rpc.declare({
	object: 'luci.oxidns',
	method: 'settings_read',
	expect: {}
});

var callSettingsSave = rpc.declare({
	object: 'luci.oxidns',
	method: 'settings_save',
	params: [
		'core_repository',
		'core_bundle',
		'config_path',
		'working_dir',
		'download_proxy',
		'github_token',
		'clear_download_proxy',
		'clear_github_token',
		'log_syslog'
	],
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

var callStatus = rpc.declare({
	object: 'luci.oxidns',
	method: 'status',
	expect: {}
});

var callCoreInstall = rpc.declare({
	object: 'luci.oxidns',
	method: 'core_install',
	expect: {}
});

var callCoreReinstall = rpc.declare({
	object: 'luci.oxidns',
	method: 'core_reinstall',
	expect: {}
});

var callCoreUpdate = rpc.declare({
	object: 'luci.oxidns',
	method: 'core_update',
	expect: {}
});

var callCoreUploadInstall = rpc.declare({
	object: 'luci.oxidns',
	method: 'core_upload_install',
	params: [ 'path' ],
	expect: {}
});

var callCoreWebuiInstall = rpc.declare({
	object: 'luci.oxidns',
	method: 'core_webui_install',
	expect: {}
});

var callCoreProgress = rpc.declare({
	object: 'luci.oxidns',
	method: 'core_progress',
	expect: {}
});

var callCoreRemove = rpc.declare({
	object: 'luci.oxidns',
	method: 'core_remove',
	params: [ 'remove_config', 'remove_workdir' ],
	expect: {}
});

var coreState = {};

var state = {
	logDir: '',
	logDirKnown: false,
	defaultLogDir: '/tmp/oxidns'
};

function field(id) {
	var node = document.getElementById(id);
	return node ? node.value : '';
}

function checked(id) {
	var node = document.getElementById(id);
	return !!(node && node.checked);
}

function row(label, input) {
	return E('div', { 'class': 'tr' }, [
		E('div', { 'class': 'td left', 'style': 'width: 240px' }, label),
		E('div', { 'class': 'td left' }, input)
	]);
}

function textInput(id, value, password, placeholder) {
	return E('input', {
		'id': id,
		'class': 'cbi-input-text',
		'type': password ? 'password' : 'text',
		'value': value || '',
		'placeholder': placeholder || null
	});
}

function option(value, label, selected) {
	return E('option', {
		'value': value,
		'selected': selected ? 'selected' : null
	}, label || value);
}

function bundleSelect(id, value) {
	var selected = value || 'full';
	return E('select', { 'id': id, 'class': 'cbi-input-select' }, [
		option('full', 'full', selected === 'full'),
		option('standard', 'standard', selected === 'standard'),
		option('minimal', 'minimal', selected === 'minimal')
	]);
}

function setStatus(message, danger) {
	var node = document.getElementById('oxidns-settings-status');
	if (!node)
		return;
	node.textContent = message || '';
	node.className = danger ? 'alert-message error' : 'alert-message info';
}

function setDescription(id, message) {
	var node = document.getElementById(id);
	if (node)
		node.textContent = message || '';
}

function setClearOptionVisible(id, visible) {
	var row = document.getElementById('%s-row'.format(id));
	var input = document.getElementById(id);

	if (row)
		row.style.display = visible ? 'block' : 'none';
	if (input)
		input.checked = false;
}

function clearOption(id, label, enabled) {
	return E('label', {
		'id': '%s-row'.format(id),
		'style': 'display: %s; margin-top: .35em;'.format(enabled ? 'block' : 'none')
	}, [
		E('input', {
			'id': id,
			'type': 'checkbox',
			'style': 'margin-right: .5em;'
		}),
		label
	]);
}

function secretSettingInput(input, descriptionId, description, clearId, clearLabel, clearEnabled) {
	return E('div', {}, [
		input,
		E('div', {
			'id': descriptionId,
			'class': 'cbi-value-description'
		}, description),
		clearOption(clearId, clearLabel, clearEnabled)
	]);
}

function proxyDescription() {
	return _('Format: http://host:port, https://host:port, socks5://host:port, or socks5h://host:port. Use http://user:pass@host:port when authentication is required.');
}

function coreInstalled(status) {
	return !!(status && status.core && status.core.installed);
}

function webuiInstalled(status) {
	return !!(status && status.webui && status.webui.installed);
}

function callWithRpcTimeout(call, seconds) {
	if (!seconds)
		return call();

	var previousTimeout = L.env.rpctimeout;
	L.env.rpctimeout = seconds;

	return call().then(function(result) {
		if (previousTimeout === undefined)
			delete L.env.rpctimeout;
		else
			L.env.rpctimeout = previousTimeout;
		return result;
	}, function(err) {
		if (previousTimeout === undefined)
			delete L.env.rpctimeout;
		else
			L.env.rpctimeout = previousTimeout;
		throw err;
	});
}

function coreErrorStageLabel(stage) {
	var labels = {
		prepare_download: _('Prepare download'),
		download_metadata: _('Download release metadata'),
		select_release_asset: _('Select release archive'),
		verify_release_digest: _('Verify release digest'),
		download_archive: _('Download core archive'),
		verify_checksum: _('Verify checksum'),
		validate_archive: _('Validate core archive'),
		unpack_archive: _('Unpack core archive'),
		install_files: _('Install core files'),
		stop_service: _('Stop service'),
		restart_service: _('Restart service'),
		remove_config: _('Remove configuration'),
		remove_working_dir: _('Remove working directory'),
		validate_uploaded_core: _('Validate uploaded core')
	};

	return labels[stage] || stage || '-';
}

function errorDetailLine(label, value, extraClass) {
	if (value === null || value === undefined || value === '')
		return null;

	return E('div', { 'class': extraClass || '' }, [
		E('strong', {}, [ label + ': ' ]),
		value
	]);
}

function renderCoreError(result) {
	var message = i18n.message(result) || _('Core operation failed');
	var detail = result && (result.detail || result.details);
	detail = i18n.detail(detail);
	var children = [
		E('p', {}, E('strong', {}, _('Core operation failed')))
	];

	if (result && result.stage)
		children.push(errorDetailLine(_('Stage'), coreErrorStageLabel(result.stage)));
	children.push(errorDetailLine(_('Reason'), message));
	if (detail)
		children.push(errorDetailLine(_('Details'), detail, 'small'));
	if (result && result.code)
		children.push(errorDetailLine(_('Error code'), result.code, 'small'));

	return E('div', {}, children);
}

function replaceContent(node, content) {
	if (!node)
		return;

	while (node.firstChild)
		node.removeChild(node.firstChild);

	if (content === null || content === undefined)
		return;

	if (Array.isArray(content)) {
		for (var i = 0; i < content.length; i++)
			node.appendChild(content[i]);
	} else if (content.nodeType) {
		node.appendChild(content);
	} else {
		node.textContent = String(content);
	}
}

function scrollProgressLog(logNode) {
	if (logNode)
		logNode.scrollTop = logNode.scrollHeight;
}

function showCoreProgressModal(label) {
	var statusNode = E('p', { 'id': 'oxidns-core-progress-status' }, label);
	var logNode = E('pre', {
		'id': 'oxidns-core-progress-log',
		'style': [
			'box-sizing: border-box',
			'width: 100%',
			'min-height: 18em',
			'max-height: 44vh',
			'overflow: auto',
			'padding: 1em',
			'border: 1px solid var(--border-color-medium, var(--border-color, #ccc))',
			'border-radius: var(--radius-control, .375rem)',
			'background: var(--background-color-low, var(--background-color-medium, transparent))',
			'color: var(--text-color-high, var(--text-color, inherit))',
			'white-space: pre-wrap',
			'font-family: monospace',
			'font-size: 12px',
			'line-height: 1.45'
		].join(';')
	}, _('Waiting for command output...'));
	var resultNode = E('div', { 'id': 'oxidns-core-progress-result' });
	var closeButton = E('button', {
		'class': 'btn cbi-button cbi-button-neutral',
		'disabled': 'disabled',
		'click': function(ev) {
			ev.preventDefault();
			ui.hideModal();
		}
	}, _('Close'));

	ui.showModal(_('OxiDNS'), [
		statusNode,
		E('div', { 'class': 'cbi-value-title', 'style': 'margin-bottom: .35em;' }, _('Command output')),
		logNode,
		resultNode,
		E('div', { 'class': 'right', 'style': 'margin-top: 1em;' }, closeButton)
	]);

	return {
		status: statusNode,
		log: logNode,
		result: resultNode,
		closeButton: closeButton
	};
}

function setCoreProgressFinished(nodes, statusText, resultContent) {
	if (nodes && nodes.status)
		nodes.status.textContent = statusText;
	if (nodes && nodes.result)
		replaceContent(nodes.result, resultContent);
	if (nodes && nodes.closeButton) {
		nodes.closeButton.disabled = false;
		nodes.closeButton.removeAttribute('disabled');
	}
}

function refreshCoreProgressLog(logNode) {
	return L.resolveDefault(callCoreProgress(), null).then(function(result) {
		if (!result || result.ok === false)
			return;

		logNode.textContent = result.text || _('Waiting for command output...');
		scrollProgressLog(logNode);
	});
}

function startCoreProgressPolling(logNode) {
	var timer = null;
	var stopped = false;

	var tick = function() {
		if (stopped)
			return Promise.resolve();
		return refreshCoreProgressLog(logNode);
	};

	timer = window.setInterval(tick, 1000);
	window.setTimeout(tick, 500);

	return {
		stop: function() {
			stopped = true;
			if (timer !== null)
				window.clearInterval(timer);
		},
		refresh: function() {
			return refreshCoreProgressLog(logNode);
		}
	};
}

function refreshCoreStatus() {
	return L.resolveDefault(callStatus(), {}).then(function(status) {
		coreState = status || {};
		refreshActionButtons();
		return coreState;
	});
}

function runCoreAction(label, call, timeout, onSuccess) {
	var nodes = showCoreProgressModal(label);
	var progress = startCoreProgressPolling(nodes.log);

	return L.resolveDefault(callWithRpcTimeout(call, timeout), null).then(function(result) {
		progress.stop();
		if (!result || result.ok === false) {
			return progress.refresh().then(function() {
				setCoreProgressFinished(nodes, _('Core operation failed'), renderCoreError(result || {}));
			});
		}

		/* Success needs no acknowledgement: the refreshed page already shows
		 * the new state, so drop the progress dialog instead of leaving it
		 * open until the user finds its Close button. Failures below keep it
		 * open, where the log and error details are the point. */
		return L.resolveDefault(refreshCoreStatus(), null).then(function() {
			ui.hideModal();
			if (typeof onSuccess === 'function')
				onSuccess(result);
		});
	}).catch(function(err) {
		progress.stop();
		return progress.refresh().then(function() {
			var errorResult = {
				message: (err && err.message) || String(err)
			};
			ui.addNotification(null, renderCoreError(errorResult), 'danger');
			setCoreProgressFinished(nodes, _('Core operation failed'), renderCoreError(errorResult));
		});
	});
}

function handleInstall() {
	return runCoreAction(_('Installing OxiDNS core...'), callCoreInstall, 300);
}

function handleReinstall() {
	return runCoreAction(_('Repair reinstalling OxiDNS core...'), callCoreReinstall, 300);
}

function handleUpdate() {
	return runCoreAction(_('Checking for OxiDNS core updates...'), callCoreUpdate, 300, function(result) {
		if (result && result.updated === false)
			ui.addNotification(null, E('p', {}, _('OxiDNS core is already up to date.')), 'info');
	});
}

function handleUploadInstall() {
	var uploadPath = '/tmp/oxidns-core-upload-%d-%d'.format(Date.now(), Math.floor(Math.random() * 1000000));

	return ui.uploadFile(uploadPath).then(function() {
		return runCoreAction(_('Installing uploaded OxiDNS core...'), function() {
			return callCoreUploadInstall(uploadPath);
		}, 300, function(result) {
			if (result && result.webui_installed === false && !webuiInstalled(coreState))
				ui.addNotification(null, E('p', {}, _('Core installed, but the uploaded file contains no WebUI files. Use Install WebUI to download them from GitHub.')), 'warning');
		});
	}).catch(function(err) {
		if (err && err.message && err.message.indexOf(_('Upload has been cancelled')) >= 0)
			return;
		ui.addNotification(null, E('p', {}, (err && err.message) || String(err)), 'danger');
	});
}

function handleCoreWebuiInstall() {
	return runCoreAction(_('Downloading and installing OxiDNS core and WebUI files...'), callCoreWebuiInstall, 300, function(result) {
		if (result && result.version)
			ui.addNotification(null, E('p', {}, _('OxiDNS core and WebUI installed: %s (%s).').format(result.version, result.bundle || '-')), 'info');
	});
}

function handleRemove() {
	return new Promise(function(resolve) {
		var configPath = coreState.config_path || '-';
		var workingDir = coreState.working_dir || '-';

		ui.showModal(_('Remove OxiDNS Core'), [
			E('p', {}, _('Remove the OxiDNS core binary and Web UI files.')),
			E('p', { 'class': 'cbi-section-descr' },
				_('Configuration and working directory data are preserved unless selected below.')),
			E('div', { 'class': 'cbi-section' }, [
				E('label', { 'class': 'cbi-value' }, [
					E('input', {
						'id': 'oxidns-remove-config',
						'type': 'checkbox',
						'style': 'margin-right: .5em;'
					}),
					_('Delete configuration file'),
					E('div', { 'class': 'cbi-value-description' }, configPath)
				]),
				E('label', { 'class': 'cbi-value' }, [
					E('input', {
						'id': 'oxidns-remove-workdir',
						'type': 'checkbox',
						'style': 'margin-right: .5em;'
					}),
					_('Delete working directory'),
					E('div', { 'class': 'cbi-value-description' }, workingDir)
				])
			]),
			E('div', { 'class': 'right' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-neutral',
					'click': function(ev) {
						ev.preventDefault();
						ui.hideModal();
						resolve();
					}
				}, _('Cancel')),
				' ',
				E('button', {
					'class': 'btn cbi-button cbi-button-negative',
					'click': function(ev) {
						ev.preventDefault();
						var removeConfig = checked('oxidns-remove-config');
						var removeWorkdir = checked('oxidns-remove-workdir');
						ui.hideModal();
						resolve(runCoreAction(_('Removing OxiDNS core...'), function() {
							return callCoreRemove(removeConfig, removeWorkdir);
						}));
					}
				}, _('Confirm'))
			])
		]);
	});
}

function actionButton(label, handler, style) {
	return E('button', {
		'class': 'btn cbi-button cbi-button-%s'.format(style || 'neutral'),
		'click': function(ev) {
			ev.preventDefault();
			return handler();
		}
	}, label);
}

function actionButtons(status) {
	if (coreInstalled(status)) {
		var buttons = [
			actionButton(_('Repair Reinstall'), handleReinstall, 'action'),
			actionButton(_('Update Core'), handleUpdate, 'positive')
		];

		if (!webuiInstalled(status))
			buttons.push(actionButton(_('Install WebUI'), handleCoreWebuiInstall, 'action'));

		buttons.push(actionButton(_('Upload Core'), handleUploadInstall, 'action'));
		buttons.push(actionButton(_('Remove Core'), handleRemove, 'negative'));
		return buttons;
	}

	return [
		actionButton(_('Install Core'), handleInstall, 'positive'),
		actionButton(_('Upload Core'), handleUploadInstall, 'action')
	];
}

function refreshActionButtons() {
	var node = document.getElementById('oxidns-core-actions');
	if (node)
		replaceContent(node, actionButtons(coreState));
}

function saveLogPath(path) {
	if (path === state.logDir)
		return Promise.resolve({ skipped: true });

	return L.resolveDefault(callLogsPathRead(), null).then(function(info) {
		var mtime = info && info.ok !== false ? (info.mtime || '') : '';

		if (info && info.ok !== false && (info.log_dir || '') === path)
			return { skipped: true };

		return L.resolveDefault(callLogsPathSave(path, mtime), null);
	});
}

function saveSettings() {
	var logDir = (field('oxidns-setting-log-dir') || '').trim();
	var payload = {
		core_repository: field('oxidns-setting-core-repository') || 'svenshi/oxidns',
		core_bundle: field('oxidns-setting-core-bundle') || 'full',
		config_path: field('oxidns-setting-config-path') || '/etc/oxidns/config.yaml',
		working_dir: field('oxidns-setting-working-dir') || '/var/lib/oxidns',
		download_proxy: field('oxidns-setting-download-proxy'),
		github_token: field('oxidns-setting-github-token'),
		clear_download_proxy: checked('oxidns-setting-clear-download-proxy'),
		clear_github_token: checked('oxidns-setting-clear-github-token'),
		log_syslog: checked('oxidns-setting-log-syslog') ? '1' : '0'
	};

	if (!logDir) {
		if (state.logDirKnown) {
			setStatus(_('Log path is required.'), true);
			var logInput = document.getElementById('oxidns-setting-log-dir');
			if (logInput)
				logInput.focus();
			return Promise.resolve();
		}
	}

	ui.showModal(_('OxiDNS'), [
		E('p', {}, _('Saving settings...'))
	]);

	return L.resolveDefault(callSettingsSave(
		payload.core_repository,
		payload.core_bundle,
		payload.config_path,
		payload.working_dir,
		payload.download_proxy,
		payload.github_token,
		payload.clear_download_proxy,
		payload.clear_github_token,
		payload.log_syslog
	), null).then(function(result) {
		if (!result || result.ok === false) {
			ui.hideModal();
			setStatus(i18n.message(result) || _('Failed to save settings'), true);
			return;
		}

		var logSave = logDir ? saveLogPath(logDir) : Promise.resolve({ skipped: true });

		return logSave.then(function(logResult) {
			ui.hideModal();

			if (!logResult) {
				setStatus(_('Settings saved, but the log path could not be checked.'), true);
				return;
			}
			if (logResult.ok === false) {
				setStatus(i18n.message(logResult) || _('Failed to save the log path.'), true);
				return;
			}

			state.logDirKnown = true;
			state.logDir = logDir;
			setStatus(logResult.restart === 'restarted'
				? _('Settings saved. OxiDNS was restarted to apply the log path.')
				: _('Settings saved.'), false);
			refreshSecretFields(result);
		});
	}).catch(function(err) {
		ui.hideModal();
		setStatus(err.message || String(err), true);
	});
}

function refreshSecretFields(result) {
	var logSyslog = document.getElementById('oxidns-setting-log-syslog');
	if (logSyslog)
		logSyslog.checked = result.log_syslog !== false;
	var proxy = document.getElementById('oxidns-setting-download-proxy');
	if (proxy)
		proxy.value = result.download_proxy || '';
	var token = document.getElementById('oxidns-setting-github-token');
	if (token)
		token.value = '';
	var clearProxy = document.getElementById('oxidns-setting-clear-download-proxy');
	if (clearProxy)
		clearProxy.checked = false;
	var clearToken = document.getElementById('oxidns-setting-clear-github-token');
	if (clearToken)
		clearToken.checked = false;
	setClearOptionVisible('oxidns-setting-clear-download-proxy', result.download_proxy_set);
	setClearOptionVisible('oxidns-setting-clear-github-token', result.github_token_set);
	setDescription('oxidns-setting-download-proxy-description',
		proxyDescription());
	setDescription('oxidns-setting-github-token-description',
		result.github_token_set ? _('A token is currently configured. Enter a new value to replace it.') : _('Optional. The token is never shown after saving.'));
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callSettingsRead(), {}),
			L.resolveDefault(callLogsPathRead(), null),
			L.resolveDefault(callStatus(), {})
		]).then(function(results) {
			return {
				settings: results[0] || {},
				logPath: results[1] || null,
				status: results[2] || {}
			};
		});
	},

	render: function(initial) {
		var settings = initial && initial.settings ? initial.settings : (initial || {});
		var logPath = initial && initial.logPath ? initial.logPath : null;

		coreState = initial && initial.status ? initial.status : {};
		state.logDir = logPath && logPath.ok !== false ? (logPath.log_dir || '') : '';
		state.logDirKnown = !!(logPath && logPath.ok !== false);
		state.defaultLogDir = (logPath && logPath.default_dir) || '/tmp/oxidns';

		return E('div', { 'class': 'cbi-map' }, [
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Core Actions')),
				E('div', { 'class': 'cbi-section-descr' },
					_('LuCI can install the latest OxiDNS release, update the installed core, or install an uploaded .tar.gz archive or single oxidns binary. Install WebUI downloads the latest official release and replaces the core binary together with the WebUI files.')),
				E('div', {
					'id': 'oxidns-core-actions',
					'class': 'cbi-button-row',
					'style': 'display: flex; flex-wrap: wrap; gap: .5em; padding-inline: var(--section-inset, 0); padding-bottom: var(--field-gap, 1em);'
				}, actionButtons(coreState))
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('div', { 'class': 'table cbi-section-table' }, [
					row(_('Core repository'), textInput('oxidns-setting-core-repository', settings.core_repository || 'svenshi/oxidns')),
					row(_('Core bundle'), E('div', {}, [
						bundleSelect('oxidns-setting-core-bundle', settings.core_bundle || 'full'),
						E('div', { 'class': 'cbi-value-description' },
							_('The full and standard bundles include OxiDNS WebUI files; the minimal bundle does not.'))
					])),
					row(_('Config path'), textInput('oxidns-setting-config-path', settings.config_path || '/etc/oxidns/config.yaml')),
					row(_('Log path'), E('div', {}, [
						textInput('oxidns-setting-log-dir', state.logDir, false, state.defaultLogDir),
						E('div', { 'class': 'cbi-value-description' },
							_('OxiDNS writes oxidns.log in this directory. Default: /tmp/oxidns. Saving restarts OxiDNS when it is running.'))
					])),
					row(_('Working directory'), textInput('oxidns-setting-working-dir', settings.working_dir || '/var/lib/oxidns')),
					row(_('Write to system log'), E('div', {}, [
						E('input', {
							'id': 'oxidns-setting-log-syslog',
							'type': 'checkbox',
							'checked': settings.log_syslog !== false ? 'checked' : null
						}),
						E('div', { 'class': 'cbi-value-description' },
							_('When disabled, OxiDNS no longer writes runtime output to the system log. Restart OxiDNS after changing this setting.'))
					])),
					row(_('Download proxy'), secretSettingInput(
						textInput('oxidns-setting-download-proxy', settings.download_proxy || '', false, _('Example: http://127.0.0.1:7890')),
						'oxidns-setting-download-proxy-description',
						proxyDescription(),
						'oxidns-setting-clear-download-proxy',
						_('Clear configured download proxy'),
						settings.download_proxy_set)),
					row(_('GitHub token'), secretSettingInput(
						textInput('oxidns-setting-github-token', '', true),
						'oxidns-setting-github-token-description',
						settings.github_token_set ? _('A token is currently configured. Enter a new value to replace it.') : _('Optional. The token is never shown after saving.'),
						'oxidns-setting-clear-github-token',
						_('Clear configured GitHub token'),
						settings.github_token_set))
				]),
				E('div', {
					'class': 'cbi-button-row',
					'style': 'padding-inline: var(--section-inset, 0);'
				}, [
					E('button', {
						'class': 'btn cbi-button cbi-button-positive',
						'click': function(ev) {
							ev.preventDefault();
							return saveSettings();
						}
					}, _('Save Settings'))
				]),
				E('div', { 'id': 'oxidns-settings-status', 'style': 'margin-top: 1em;' })
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
