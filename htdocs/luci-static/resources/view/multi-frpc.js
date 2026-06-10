'use strict';
'require view';
'require form';
'require rpc';
'require fs';
'require ui';
'require uci';

var CONFIG = 'multi-frpc';
var SERVICE = 'multi-frpc';
var RUNDIR = '/var/etc/multi-frpc';

var callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: [ 'name' ],
	expect: { '': {} }
});

var callRcInit = rpc.declare({
	object: 'rc',
	method: 'init',
	params: [ 'name', 'action' ]
});

function addValues(option, values) {
	for (var i = 0; i < values.length; i++)
		option.value(values[i][0], values[i][1]);
}

function addDepends(option, depends) {
	for (var i = 0; i < depends.length; i++)
		option.depends(depends[i]);
}

function readLog(path) {
	return L.resolveDefault(fs.read_direct(path, 'text'), '');
}

function serverLabel(section) {
	var label = uci.get(CONFIG, section['.name'], 'name') || section['.name'];
	var addr = uci.get(CONFIG, section['.name'], 'server_addr');

	return addr ? '%s (%s)'.format(label, addr) : label;
}

function serverKey(section_id) {
	return uci.get(CONFIG, section_id, 'server_key') || section_id;
}

function generateServerKey(section_id) {
	var seed = '%s-%s-%s'.format(
		section_id,
		Date.now().toString(36),
		Math.random().toString(36).slice(2, 8)
	);

	return seed.replace(/[^a-z0-9_-]/ig, '').slice(0, 16);
}

function listValue(value) {
	if (Array.isArray(value))
		return value.filter(function(entry) { return entry != null && entry !== ''; });

	if (value == null || value === '')
		return [];

	return [ value ];
}

function uniqueValues(values) {
	var result = [];

	for (var i = 0; i < values.length; i++)
		if (result.indexOf(values[i]) === -1)
			result.push(values[i]);

	return result;
}

function normalizeConfigState() {
	var changed = false;
	var keyBySection = {};
	var servers = uci.sections(CONFIG, 'server');
	var proxies = uci.sections(CONFIG, 'proxy');

	for (var i = 0; i < servers.length; i++) {
		var section_id = servers[i]['.name'];
		var key = uci.get(CONFIG, section_id, 'server_key');

		if (!key) {
			key = generateServerKey(section_id);
			uci.set(CONFIG, section_id, 'server_key', key);
			changed = true;
		}

		keyBySection[section_id] = key;
	}

	for (var j = 0; j < proxies.length; j++) {
		var proxy_id = proxies[j]['.name'];
		var excludes = listValue(uci.get(CONFIG, proxy_id, 'exclude_server'));
		var mapped = [];

		for (var k = 0; k < excludes.length; k++)
			mapped.push(keyBySection[excludes[k]] || excludes[k]);

		mapped = uniqueValues(mapped);

		if (JSON.stringify(excludes) !== JSON.stringify(mapped)) {
			uci.set(CONFIG, proxy_id, 'exclude_server', mapped);
			changed = true;
		}
	}

	return changed;
}

function getInheritedServerValue(section_id, option, defaultValue) {
	var value = uci.get(CONFIG, section_id, option);

	if (value != null && value !== '')
		return value;

	value = uci.get(CONFIG, 'common', option);

	if (value != null && value !== '')
		return value;

	return defaultValue;
}

function applyInheritedServerOption(option, optionName, defaultValue) {
	option.cfgvalue = function(section_id) {
		return getInheritedServerValue(section_id, optionName, defaultValue);
	};
}

function buildServerNameMap() {
	var map = {};
	var servers = uci.sections(CONFIG, 'server');

	for (var i = 0; i < servers.length; i++) {
		var section_id = servers[i]['.name'];
		map[serverKey(section_id)] = serverLabel(servers[i]);
	}

	return map;
}

function getServiceInstances(data) {
	var service = data && data[SERVICE];
	return (service && service.instances) ? service.instances : {};
}

function isAnyInstanceRunning(instances) {
	for (var name in instances)
		if (instances[name] && instances[name].running)
			return true;

	return false;
}

function renderStatus(instances, serverNames) {
	var rows = [];
	var running = isAnyInstanceRunning(instances);

	for (var name in instances) {
		var inst = instances[name] || {};
		var command = inst.command;

		if (Array.isArray(command))
			command = command.join(' ');

		rows.push([
			serverNames[name] || name,
			inst.running ? _('RUNNING') : _('NOT RUNNING'),
			command || ''
		]);
	}

	var table = E('table', { 'class': 'table' }, [
		E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th' }, _('Instance')),
			E('th', { 'class': 'th' }, _('Status')),
			E('th', { 'class': 'th' }, _('Command'))
		])
	]);

	cbi_update_table(table, rows, E('em', _('No frpc instance is running.')));

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', _('Runtime Status')),
		E('p', {}, E('em', {}, [
			E('span', {
				'style': 'color:%s;font-weight:bold'.format(running ? 'green' : 'red')
			}, running ? _('Multi Frpc is running') : _('Multi Frpc is not running'))
		])),
		table
	]);
}

function renderActions(view) {
	return E('div', { 'class': 'cbi-page-actions' }, [
		E('button', {
			'class': 'btn cbi-button-action',
			'click': ui.createHandlerFn(view, 'handleServiceAction', 'start')
		}, _('Start')),
		' ',
		E('button', {
			'class': 'btn cbi-button-action',
			'click': ui.createHandlerFn(view, 'handleServiceAction', 'restart')
		}, _('Restart')),
		' ',
		E('button', {
			'class': 'btn cbi-button-action',
			'click': ui.createHandlerFn(view, 'handleServiceAction', 'reload')
		}, _('Reload')),
		' ',
		E('button', {
			'class': 'btn cbi-button-negative',
			'click': ui.createHandlerFn(view, 'handleServiceAction', 'stop')
		}, _('Stop'))
	]);
}

function renderLog(title, content) {
	return E('div', { 'class': 'cbi-section' }, [
		E('h3', title),
		E('textarea', {
			'readonly': 'readonly',
			'wrap': 'off',
			'style': 'width:100%; min-height:18em; font-family:monospace'
		}, [ content || '' ])
	]);
}

function addCommonOptions(section) {
	var o;

	o = section.option(form.Flag, 'enabled', _('Enabled'));
	o.default = '0';
	o.rmempty = false;
	o.description = _('This only controls the multi-frpc service manager. Per-server transport, TLS, admin and log settings are configured in each server entry.');
}

function addServerOptions(section) {
	var o;

	o = section.option(form.DummyValue, 'name', _('Server Name'));
	o.modalonly = false;

	o = section.option(form.DummyValue, 'server_addr', _('Server Address'));
	o.modalonly = false;

	o = section.option(form.DummyValue, 'server_port', _('Server Port'));
	o.modalonly = false;

	o = section.option(form.DummyValue, 'enabled', _('Enabled'));
	o.cfgvalue = function(section_id) {
		return uci.get(CONFIG, section_id, 'enabled') == '1' ? _('Yes') : _('No');
	};
	o.modalonly = false;

	section.tab('base', _('Basic Settings'));

	o = section.taboption('base', form.Value, 'name', _('Server Name'));
	o.rmempty = false;
	o.write = function(section_id, value) {
		uci.set(CONFIG, section_id, 'name', value);
		if (!uci.get(CONFIG, section_id, 'server_key'))
			uci.set(CONFIG, section_id, 'server_key', generateServerKey(section_id));
	};
	o.modalonly = true;

	o = section.taboption('base', form.Flag, 'enabled', _('Enabled'));
	o.default = '1';
	o.rmempty = false;
	o.modalonly = true;

	o = section.taboption('base', form.Value, 'server_addr', _('Server'));
	o.rmempty = false;
	o.modalonly = true;

	o = section.taboption('base', form.Value, 'server_port', _('Port'));
	o.datatype = 'port';
	o.rmempty = false;
	o.modalonly = true;

	o = section.taboption('base', form.Value, 'token', _('Token'));
	o.password = true;
	o.rmempty = false;
	o.modalonly = true;

	o = section.taboption('base', form.Value, 'user', _('User'));
	o.modalonly = true;

	section.tab('transport', _('Transport'));
	section.tab('tls', _('TLS'));
	section.tab('admin', _('Admin'));
	section.tab('log', _('Log'));

	o = section.taboption('transport', form.ListValue, 'protocol', _('Protocol Type'));
	addValues(o, [
		[ 'tcp', _('TCP') ],
		[ 'kcp', _('KCP') ],
		[ 'quic', _('QUIC') ],
		[ 'websocket', _('WebSocket') ],
		[ 'wss', _('WebSocket over TLS') ]
	]);
	o.default = 'tcp';
	applyInheritedServerOption(o, 'protocol', 'tcp');
	o.modalonly = true;

	o = section.taboption('transport', form.Flag, 'login_fail_exit', _('Exit program when first login failed'));
	o.default = '0';
	o.rmempty = false;
	applyInheritedServerOption(o, 'login_fail_exit', '0');
	o.modalonly = true;

	o = section.taboption('transport', form.Flag, 'tcp_mux', _('TCP Stream Multiplexing'));
	o.default = '1';
	o.rmempty = false;
	applyInheritedServerOption(o, 'tcp_mux', '1');
	o.modalonly = true;

	o = section.taboption('transport', form.Value, 'tcp_mux_keepalive_interval', _('TCP Mux Keepalive Interval'));
	o.datatype = 'integer';
	o.placeholder = _('Optional, seconds');
	applyInheritedServerOption(o, 'tcp_mux_keepalive_interval', '');
	o.modalonly = true;

	o = section.taboption('transport', form.Value, 'heartbeat_interval', _('Heartbeat Interval'));
	o.datatype = 'integer';
	o.placeholder = _('Optional, seconds');
	applyInheritedServerOption(o, 'heartbeat_interval', '');
	o.modalonly = true;

	o = section.taboption('transport', form.Value, 'heartbeat_timeout', _('Heartbeat Timeout'));
	o.datatype = 'uinteger';
	o.placeholder = _('Optional, seconds');
	applyInheritedServerOption(o, 'heartbeat_timeout', '');
	o.modalonly = true;

	o = section.taboption('transport', form.Flag, 'enable_http_proxy', _('Connect frps by HTTP proxy'));
	o.default = '0';
	o.rmempty = false;
	o.depends('protocol', 'tcp');
	applyInheritedServerOption(o, 'enable_http_proxy', '0');
	o.modalonly = true;

	o = section.taboption('transport', form.Value, 'http_proxy', _('HTTP proxy'));
	o.placeholder = 'http://user:pwd@192.168.1.128:8080';
	o.depends('enable_http_proxy', '1');
	applyInheritedServerOption(o, 'http_proxy', '');
	o.modalonly = true;

	o = section.taboption('transport', form.Flag, 'enable_cpool', _('Enable Connection Pool'));
	o.default = '0';
	o.rmempty = false;
	applyInheritedServerOption(o, 'enable_cpool', '0');
	o.modalonly = true;

	o = section.taboption('transport', form.Value, 'pool_count', _('Connection Pool'));
	o.datatype = 'uinteger';
	o.placeholder = '1';
	o.depends('enable_cpool', '1');
	applyInheritedServerOption(o, 'pool_count', '1');
	o.modalonly = true;

	o = section.taboption('tls', form.Flag, 'tls_enable', _('Use TLS Connection'));
	o.default = '1';
	o.rmempty = false;
	applyInheritedServerOption(o, 'tls_enable', '1');
	o.modalonly = true;

	o = section.taboption('tls', form.Flag, 'enable_custom_certificate', _('Custom TLS Certificate'));
	o.default = '0';
	o.rmempty = false;
	o.depends('tls_enable', '1');
	applyInheritedServerOption(o, 'enable_custom_certificate', '0');
	o.modalonly = true;

	o = section.taboption('tls', form.Value, 'tls_cert_file', _('Client Certificate File'));
	o.placeholder = '/var/etc/multi-frpc/client.crt';
	o.depends('enable_custom_certificate', '1');
	applyInheritedServerOption(o, 'tls_cert_file', '');
	o.modalonly = true;

	o = section.taboption('tls', form.Value, 'tls_key_file', _('Client Key File'));
	o.placeholder = '/var/etc/multi-frpc/client.key';
	o.depends('enable_custom_certificate', '1');
	applyInheritedServerOption(o, 'tls_key_file', '');
	o.modalonly = true;

	o = section.taboption('tls', form.Value, 'tls_trusted_ca_file', _('CA Certificate File'));
	o.placeholder = '/var/etc/multi-frpc/ca.crt';
	o.depends('enable_custom_certificate', '1');
	applyInheritedServerOption(o, 'tls_trusted_ca_file', '');
	o.modalonly = true;

	o = section.taboption('admin', form.Flag, 'admin_enable', _('Enable Web API'));
	o.default = '0';
	o.rmempty = false;
	applyInheritedServerOption(o, 'admin_enable', '0');
	o.modalonly = true;

	o = section.taboption('admin', form.Value, 'admin_port', _('Admin Web Port'));
	o.datatype = 'port';
	o.placeholder = _('Unique per server instance');
	o.depends('admin_enable', '1');
	applyInheritedServerOption(o, 'admin_port', '');
	o.modalonly = true;

	o = section.taboption('admin', form.Value, 'admin_user', _('Admin Web UserName'));
	o.depends('admin_enable', '1');
	applyInheritedServerOption(o, 'admin_user', '');
	o.modalonly = true;

	o = section.taboption('admin', form.Value, 'admin_pwd', _('Admin Web PassWord'));
	o.password = true;
	o.depends('admin_enable', '1');
	applyInheritedServerOption(o, 'admin_pwd', '');
	o.modalonly = true;

	o = section.taboption('log', form.ListValue, 'log_level', _('Log Level'));
	addValues(o, [
		[ 'trace', _('Trace') ],
		[ 'debug', _('Debug') ],
		[ 'info', _('Info') ],
		[ 'warn', _('Warning') ],
		[ 'error', _('Error') ]
	]);
	o.default = 'info';
	applyInheritedServerOption(o, 'log_level', 'info');
	o.modalonly = true;

	o = section.taboption('log', form.Value, 'log_max_days', _('Log Keep Max Days'));
	o.datatype = 'uinteger';
	o.default = '3';
	o.rmempty = false;
	applyInheritedServerOption(o, 'log_max_days', '3');
	o.modalonly = true;
}

function addProxyOverview(section) {
	var o;

	o = section.option(form.DummyValue, 'remark', _('Service Name'));
	o.cfgvalue = function(section_id) {
		return uci.get(CONFIG, section_id, 'remark') || section_id;
	};
	o.modalonly = false;

	o = section.option(form.DummyValue, 'type', _('Type'));
	o.modalonly = false;

	o = section.option(form.DummyValue, 'routing', _('Route'));
	o.cfgvalue = function(section_id) {
		var type = uci.get(CONFIG, section_id, 'type');
		var custom_domains = uci.get(CONFIG, section_id, 'custom_domains') || '';
		var subdomain = uci.get(CONFIG, section_id, 'subdomain') || '';

		if (type == 'http' || type == 'https')
			return custom_domains || subdomain || _('VHost');

		return uci.get(CONFIG, section_id, 'remote_port') || '';
	};
	o.modalonly = false;

	o = section.option(form.DummyValue, 'local_addr', _('Local Address'));
	o.cfgvalue = function(section_id) {
		var ip = uci.get(CONFIG, section_id, 'local_ip') || '';
		var port = uci.get(CONFIG, section_id, 'local_port') || '';
		return port ? '%s:%s'.format(ip || '127.0.0.1', port) : ip;
	};
	o.modalonly = false;

	o = section.option(form.DummyValue, 'enable', _('Enabled'));
	o.cfgvalue = function(section_id) {
		return uci.get(CONFIG, section_id, 'enable') == '0' ? _('No') : _('Yes');
	};
	o.modalonly = false;
}

function addProxyOptions(section) {
	var o, servers, dependsLocalAddr, dependsHealthCheck;

	section.tab('base', _('Basic Settings'));
	section.tab('routing', _('Routing'));
	section.tab('plugin', _('Plugin'));
	section.tab('health', _('Health Check'));
	section.tab('transport', _('Transport'));

	o = section.taboption('base', form.Value, 'remark', _('Service Remark Name'));
	o.description = _('Please ensure the remark name is unique.');
	o.rmempty = false;
	o.modalonly = true;

	o = section.taboption('base', form.Flag, 'enable', _('Enabled'));
	o.default = '1';
	o.rmempty = false;
	o.modalonly = true;

	o = section.taboption('base', form.ListValue, 'type', _('Frp Protocol Type'));
	o.default = 'tcp';
	addValues(o, [
		[ 'http', _('HTTP') ],
		[ 'https', _('HTTPS') ],
		[ 'tcp', _('TCP') ],
		[ 'udp', _('UDP') ],
		[ 'stcp', _('STCP') ],
		[ 'xtcp', _('XTCP') ]
	]);
	o.modalonly = true;

	o = section.taboption('base', form.MultiValue, 'exclude_server', _('Exclude Servers'));
	o.widget = 'checkbox';
	o.description = _('By default, every enabled service is assigned to every enabled frpc server instance. Select any server here to skip it for this service.');
	servers = uci.sections(CONFIG, 'server');
	for (var i = 0; i < servers.length; i++)
		o.value(servers[i]['.name'], serverLabel(servers[i]));
	o.modalonly = true;

	o = section.taboption('base', form.ListValue, 'stcp_role', _('STCP Role'));
	o.default = 'server';
	o.value('server', _('STCP Server'));
	o.value('visitor', _('STCP Visitor'));
	o.depends('type', 'stcp');
	o.modalonly = true;

	o = section.taboption('base', form.ListValue, 'xtcp_role', _('XTCP Role'));
	o.default = 'server';
	o.value('server', _('XTCP Server'));
	o.value('visitor', _('XTCP Visitor'));
	o.depends('type', 'xtcp');
	o.modalonly = true;

	o = section.taboption('base', form.Value, 'remote_port', _('Remote Port'));
	o.datatype = 'port';
	o.depends('type', 'tcp');
	o.depends('type', 'udp');
	o.modalonly = true;

	dependsLocalAddr = [
		{ type: 'tcp', enable_plugin: '0' },
		{ type: 'udp' },
		{ type: 'http' },
		{ type: 'https', enable_https_plugin: '0' },
		{ type: 'stcp' },
		{ type: 'xtcp' }
	];

	o = section.taboption('base', form.Value, 'local_ip', _('Local Host Address'));
	o.default = '127.0.0.1';
	addDepends(o, dependsLocalAddr);
	o.modalonly = true;

	o = section.taboption('base', form.Value, 'local_port', _('Local Host Port'));
	o.datatype = 'port';
	addDepends(o, dependsLocalAddr);
	o.modalonly = true;

	o = section.taboption('base', form.Value, 'stcp_secretkey', _('STCP Secret Key'));
	o.depends('type', 'stcp');
	o.password = true;
	o.modalonly = true;

	o = section.taboption('base', form.Value, 'stcp_servername', _('STCP Server Name'));
	o.description = _('STCP server name is the service remark name of the STCP server.');
	o.depends('stcp_role', 'visitor');
	o.modalonly = true;

	o = section.taboption('base', form.Value, 'xtcp_secretkey', _('XTCP Secret Key'));
	o.depends('type', 'xtcp');
	o.password = true;
	o.modalonly = true;

	o = section.taboption('base', form.Value, 'xtcp_servername', _('XTCP Server Name'));
	o.description = _('XTCP server name is the service remark name of the XTCP server.');
	o.depends('xtcp_role', 'visitor');
	o.modalonly = true;

	o = section.taboption('routing', form.ListValue, 'domain_type', _('Domain Type'));
	o.default = 'custom_domains';
	o.value('custom_domains', _('Custom Domains'));
	o.value('subdomain', _('SubDomain'));
	o.value('both_dtype', _('Custom Domains and SubDomain'));
	o.depends('type', 'http');
	o.depends('type', 'https');
	o.modalonly = true;

	o = section.taboption('routing', form.Value, 'custom_domains', _('Custom Domains'));
	o.description = _('Use commas to separate multiple domains.');
	o.depends('domain_type', 'custom_domains');
	o.depends('domain_type', 'both_dtype');
	o.modalonly = true;

	o = section.taboption('routing', form.Value, 'subdomain', _('SubDomain'));
	o.depends('domain_type', 'subdomain');
	o.depends('domain_type', 'both_dtype');
	o.modalonly = true;

	o = section.taboption('routing', form.Flag, 'enable_locations', _('Enable URL routing'));
	o.default = '0';
	o.rmempty = false;
	o.depends('type', 'http');
	o.modalonly = true;

	o = section.taboption('routing', form.Value, 'locations', _('URL routing'));
	o.description = _('Use commas to separate multiple URL prefixes.');
	o.placeholder = '/';
	o.depends('enable_locations', '1');
	o.modalonly = true;

	o = section.taboption('routing', form.Flag, 'enable_http_auth', _('Password protecting your web service'));
	o.default = '0';
	o.rmempty = false;
	o.depends('type', 'http');
	o.modalonly = true;

	o = section.taboption('routing', form.Value, 'http_user', _('HTTP UserName'));
	o.depends('enable_http_auth', '1');
	o.modalonly = true;

	o = section.taboption('routing', form.Value, 'http_pwd', _('HTTP PassWord'));
	o.password = true;
	o.depends('enable_http_auth', '1');
	o.modalonly = true;

	o = section.taboption('routing', form.Flag, 'enable_host_header_rewrite', _('Rewriting the Host Header'));
	o.default = '0';
	o.rmempty = false;
	o.depends('type', 'http');
	o.modalonly = true;

	o = section.taboption('routing', form.Value, 'host_header_rewrite', _('Host Header'));
	o.depends('enable_host_header_rewrite', '1');
	o.modalonly = true;

	o = section.taboption('plugin', form.Flag, 'enable_plugin', _('Use Plugin'));
	o.default = '0';
	o.rmempty = false;
	o.depends('type', 'tcp');
	o.modalonly = true;

	o = section.taboption('plugin', form.ListValue, 'plugin', _('Choose Plugin'));
	o.value('http_proxy', _('http_proxy'));
	o.value('socks5', _('socks5'));
	o.value('unix_domain_socket', _('unix_domain_socket'));
	o.depends({ enable_plugin: '1', type: 'tcp' });
	o.modalonly = true;

	o = section.taboption('plugin', form.Flag, 'enable_plugin_httpuserpw', _('Proxy Authentication'));
	o.default = '0';
	o.rmempty = false;
	o.depends({ enable_plugin: '1', plugin: 'http_proxy', type: 'tcp' });
	o.modalonly = true;

	o = section.taboption('plugin', form.Value, 'plugin_http_user', _('HTTP Proxy UserName'));
	o.depends({ enable_plugin_httpuserpw: '1', plugin: 'http_proxy', type: 'tcp' });
	o.modalonly = true;

	o = section.taboption('plugin', form.Value, 'plugin_http_passwd', _('HTTP Proxy Password'));
	o.password = true;
	o.depends({ enable_plugin_httpuserpw: '1', plugin: 'http_proxy', type: 'tcp' });
	o.modalonly = true;

	o = section.taboption('plugin', form.Value, 'plugin_unix_path', _('Plugin Unix Sock Path'));
	o.default = '/var/run/docker.sock';
	o.depends({ enable_plugin: '1', plugin: 'unix_domain_socket', type: 'tcp' });
	o.modalonly = true;

	o = section.taboption('plugin', form.Flag, 'enable_https_plugin', _('Use HTTPS Plugin'));
	o.default = '0';
	o.rmempty = false;
	o.depends('type', 'https');
	o.modalonly = true;

	o = section.taboption('plugin', form.ListValue, 'https_plugin', _('Choose HTTPS Plugin'));
	o.value('https2http', _('https2http'));
	o.depends({ enable_https_plugin: '1', type: 'https' });
	o.modalonly = true;

	o = section.taboption('plugin', form.Value, 'plugin_local_addr', _('Plugin Local Addr'));
	o.default = '127.0.0.1:80';
	o.depends({ enable_https_plugin: '1', https_plugin: 'https2http', type: 'https' });
	o.modalonly = true;

	o = section.taboption('plugin', form.Value, 'plugin_crt_path', _('Plugin Certificate Path'));
	o.placeholder = './server.crt';
	o.depends({ enable_https_plugin: '1', https_plugin: 'https2http', type: 'https' });
	o.modalonly = true;

	o = section.taboption('plugin', form.Value, 'plugin_key_path', _('Plugin Key Path'));
	o.placeholder = './server.key';
	o.depends({ enable_https_plugin: '1', https_plugin: 'https2http', type: 'https' });
	o.modalonly = true;

	o = section.taboption('plugin', form.Value, 'plugin_host_header_rewrite', _('Plugin Host Header Rewrite'));
	o.depends({ enable_https_plugin: '1', https_plugin: 'https2http', type: 'https' });
	o.modalonly = true;

	o = section.taboption('plugin', form.Value, 'plugin_header_X_From_Where', _('Plugin Header X-From-Where'));
	o.depends({ enable_https_plugin: '1', https_plugin: 'https2http', type: 'https' });
	o.modalonly = true;

	dependsHealthCheck = [
		{ enable_health_check: '1', type: 'tcp' },
		{ enable_health_check: '1', type: 'http' },
		{ enable_health_check: '1', type: 'https' }
	];

	o = section.taboption('health', form.Flag, 'enable_health_check', _('Enable Health Check'));
	o.description = _('Use frp built-in health checks instead of periodic restarts.');
	o.default = '0';
	o.rmempty = false;
	o.depends('type', 'tcp');
	o.depends('type', 'http');
	o.depends('type', 'https');
	o.modalonly = true;

	o = section.taboption('health', form.ListValue, 'health_check_type', _('Health Check Type'));
	o.default = 'tcp';
	o.value('tcp', _('TCP'));
	o.value('http', _('HTTP'));
	addDepends(o, dependsHealthCheck);
	o.modalonly = true;

	o = section.taboption('health', form.Value, 'health_check_path', _('Health Check Path'));
	o.placeholder = '/';
	addDepends(o, [
		{ enable_health_check: '1', health_check_type: 'http', type: 'tcp' },
		{ enable_health_check: '1', health_check_type: 'http', type: 'http' },
		{ enable_health_check: '1', health_check_type: 'http', type: 'https' }
	]);
	o.modalonly = true;

	o = section.taboption('health', form.Value, 'health_check_interval', _('Health Check Interval'));
	o.datatype = 'uinteger';
	o.placeholder = '10';
	addDepends(o, dependsHealthCheck);
	o.modalonly = true;

	o = section.taboption('health', form.Value, 'health_check_timeout', _('Health Check Timeout'));
	o.datatype = 'uinteger';
	o.placeholder = '3';
	addDepends(o, dependsHealthCheck);
	o.modalonly = true;

	o = section.taboption('health', form.Value, 'health_check_max_failed', _('Health Check Max Failed'));
	o.datatype = 'uinteger';
	o.placeholder = '1';
	addDepends(o, dependsHealthCheck);
	o.modalonly = true;

	o = section.taboption('transport', form.ListValue, 'proxy_protocol_version', _('Proxy-Protocol Version'));
	o.default = 'disable';
	o.value('disable', _('Disable'));
	o.value('v1', _('V1'));
	o.value('v2', _('V2'));
	o.depends('type', 'tcp');
	o.depends('type', 'stcp');
	o.depends('type', 'xtcp');
	o.depends('type', 'http');
	o.depends('type', 'https');
	o.modalonly = true;

	o = section.taboption('transport', form.Flag, 'use_encryption', _('Use Encryption'));
	o.default = '0';
	o.rmempty = false;
	o.modalonly = true;

	o = section.taboption('transport', form.Flag, 'use_compression', _('Use Compression'));
	o.default = '0';
	o.rmempty = false;
	o.modalonly = true;
}

return view.extend({
	load: function() {
		return uci.load(CONFIG).then(function() {
			normalizeConfigState();

			var tasks = [
				L.resolveDefault(callServiceList(SERVICE), {}),
				readLog('%s/multi-frpc.log'.format(RUNDIR))
			];
			var servers = uci.sections(CONFIG, 'server');

			for (var i = 0; i < servers.length; i++) {
				var name = uci.get(CONFIG, servers[i]['.name'], 'name') || servers[i]['.name'];
				tasks.push(readLog('%s/frpc-%s.log'.format(RUNDIR, serverKey(servers[i]['.name']))));
			}

			return Promise.all(tasks);
		});
	},

	handleServiceAction: function(action) {
		return callRcInit(SERVICE, action).then(function(ret) {
			if (ret)
				throw _('Command failed');

			ui.addNotification(null, E('p', _('Service action completed: %s').format(action)), 'info');
			window.setTimeout(function() {
				window.location.reload();
			}, 1000);
		}).catch(function(e) {
			ui.addNotification(null, E('p', _('Failed to execute service action: %s').format(e.message || e)));
		});
	},

	render: function(data) {
		var m, s, servers, logNodes, statusData, mainLog, serverNames;
		var logIndex = 2;

		statusData = data[0] || {};
		mainLog = data[1] || '';
		serverNames = buildServerNameMap();

		m = new form.Map(CONFIG, _('Multi Frpc Setting'),
			_('Manage multiple frpc client instances with frp TOML configuration.'));

		s = m.section(form.NamedSection, 'common', 'multi-frpc', _('Global Settings'));
		s.anonymous = true;
		s.addremove = false;
		addCommonOptions(s);

		s = m.section(form.GridSection, 'server', _('Server List'));
		s.anonymous = true;
		s.addremove = true;
		s.sortable = true;
		s.tabbed = true;
		s.nodescriptions = true;
		s.addbtntitle = _('Add server');
		s.modaltitle = _('Server Settings');
		addServerOptions(s);

		s = m.section(form.GridSection, 'proxy', _('Services List'));
		s.anonymous = true;
		s.addremove = true;
		s.sortable = true;
		s.tabbed = true;
		s.nodescriptions = true;
		s.addbtntitle = _('Add service');
		s.modaltitle = _('Service Settings');
		addProxyOverview(s);
		addProxyOptions(s);

		servers = uci.sections(CONFIG, 'server');
		logNodes = [
			renderLog(_('Plugin Log'), mainLog)
		];

		for (var i = 0; i < servers.length; i++) {
			var name = uci.get(CONFIG, servers[i]['.name'], 'name') || servers[i]['.name'];
			logNodes.push(renderLog(_('Client Log: %s').format(name), data[logIndex++] || ''));
		}

		return m.render().then(L.bind(function(nodes) {
			return E('div', {}, [
				renderStatus(getServiceInstances(statusData), serverNames),
				renderActions(this),
				nodes,
				E('div', { 'class': 'cbi-section' }, [
					E('h2', _('Logs')),
					E('p', {}, _('Logs are read from /var/etc/multi-frpc. Restart the service after saving configuration changes to regenerate TOML files.'))
				]),
				E('div', {}, logNodes)
			]);
		}, this));
	}
});
