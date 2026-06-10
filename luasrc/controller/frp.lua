module("luci.controller.frp", package.seeall)
local uci=require"luci.model.uci".cursor()
local fs = require "nixio.fs"

function index()
	if not nixio.fs.access("/etc/config/multi-frpc") then
		return
	end

	entry({"admin", "services", "multi-frpc"}, alias("admin", "services", "multi-frpc", "base"), _("Multi Frpc"), 100).dependent = true
	entry({"admin", "services", "multi-frpc", "base"}, cbi("frp/basic"), _("Multi Frpc Setting"), 1).leaf = true
	entry({"admin", "services", "multi-frpc", "service_log"}, cbi("frp/log"), _("Plugin Log"), 2).leaf = true
	entry({"admin", "services", "multi-frpc", "client_log"}, cbi("frp/client_log"), _("Client Log"), 3).leaf = true
	entry({"admin", "services", "multi-frpc", "config"}, cbi("frp/config")).leaf = true
	entry({"admin", "services", "multi-frpc", "server"}, cbi("frp/server")).leaf = true
	entry({"admin", "services", "multi-frpc", "status"}, call("act_status")).leaf = true
	entry({"admin", "services", "multi-frpc", "server_list"}, call("get_server")).leaf = true
	entry({"admin", "services", "multi-frpc", "get_log"}, call("get_log")).leaf = true
end

function act_status()
	local e = {}
	e.running = luci.sys.call("pidof frpc > /dev/null") == 0
	luci.http.prepare_content("application/json")
	luci.http.write_json(e)
end

function get_server()
	local ret = {}
	uci:load("multi-frpc")
	uci:foreach("multi-frpc", "server", function (s)
		table.insert(ret, s["name"])
	end)
	luci.http.prepare_content("application/json")
	luci.http.write_json(ret) 
end

function get_log() 
	local name = luci.http.formvalue("name")
	local log = fs.readfile(string.format("/var/etc/multi-frpc/frpc-%s.log", name))or"NOT FOUND"
	luci.http.write(log)
end
