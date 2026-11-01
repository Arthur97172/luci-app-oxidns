# luci-app-oxidns

Language: [中文](./README.md) | English

`luci-app-oxidns` is the LuCI management app for OxiDNS on OpenWrt. After installation, LuCI adds `Services -> OxiDNS` pages for installing the OxiDNS core binary, managing the OpenWrt service, editing configuration, and viewing logs.

This repository provides only a simple implementation for installing and managing OxiDNS. Other developers are welcome to extend it or build alternative LuCI plugins that cover the existing functionality and offer more features.

**DNS configuration guide**: a complete walkthrough of configuring DNS from scratch, a field-by-field reference for Normal and Advanced modes, and full OxiDNS WebUI instructions are in [info/README.en.md](info/README.en.md).

## Install The LuCI App

The recommended path is to download the corresponding LuCI package from this repository's Releases and install it manually. Upload the package to the device (for example, `/tmp`), then install it:

OpenWrt 24.10:

```sh
opkg install /tmp/luci-app-oxidns_*.ipk

# Optional, install the Simplified Chinese language pack

opkg install /tmp/luci-i18n-oxidns-zh-cn_*.ipk
```

OpenWrt 25.12:

```sh
apk add --allow-untrusted /tmp/luci-app-oxidns-*.apk

# Optional, install the Simplified Chinese language pack

apk add --allow-untrusted /tmp/luci-i18n-oxidns-zh-cn-*.apk
```

### Build From Source

To include the package in firmware or customize it, place it in an OpenWrt build tree and compile it together with the other packages:

```sh
cd openwrt
./scripts/feeds update -a
./scripts/feeds install -a
git clone https://github.com/Arthur97172/luci-app-oxidns.git package/luci-app-oxidns
make menuconfig   # LuCI -> Applications -> luci-app-oxidns
make package/luci-app-oxidns/compile V=s
```

The artifacts appear under `bin/packages/<arch>/`. The same sources produce an `.ipk` in a 24.10 build tree and an `.apk` in a 25.12 build tree; `VERSION` and `PKG_RELEASE` determine the version in the package name.

---

If the menu does not appear after installation, restart `rpcd`:

```sh
/etc/init.d/rpcd restart
```

Then open LuCI: `Services -> OxiDNS`.

## Install OxiDNS Core

If you are migrating from the old OpenWrt `oxidns` package model, stop the service and remove the old runtime package first so it no longer owns `/usr/bin/oxidns` or `/etc/init.d/oxidns`:

```sh
/etc/init.d/oxidns stop
opkg remove oxidns
```

On systems using `apk`, run:

```sh
/etc/init.d/oxidns stop
apk del oxidns
```

1. Open `Services -> OxiDNS -> Settings` and confirm `Core repository` is `svenshi/oxidns` and `Core bundle` is `full`.
2. In the `Core Actions` section at the top of the same page, click `Install Core`. For offline installs, click `Upload Core` to upload an official `.tar.gz` archive or a single `oxidns` binary.
3. After installation succeeds, click `Start` on `Basic Settings`, then click `Enable on boot` under `Autostart` on the `Settings` page.

LuCI selects the OxiDNS Linux musl release archive for the current CPU architecture, such as `oxidns-x86_64-unknown-linux-musl.tar.gz`. The GitHub release asset SHA256 digest is verified before installation.

Note: the `full` and `standard` archives include the WebUI files, while the `minimal` archive does not; uploading a single `oxidns` binary does not install the WebUI either. When no WebUI is installed, LuCI rejects an uploaded `full` or `standard` core that lacks `webui/`, so a new binary cannot be left without its WebUI.

When the core is already installed, the `Core Actions` section at the top of the `Settings` page offers `Update Core`, `Repair Reinstall`, `Install WebUI`, `Upload Core`, and `Remove Core`. `Update Core` checks the latest official release and only downloads and installs when a newer version exists, keeping the currently installed bundle. `Repair Reinstall` and `Upload Core` repair the binary or WebUI files by downloading the current installed version again or using an uploaded file. When the WebUI is missing, `Install WebUI` downloads the latest official release from GitHub and replaces both the core binary and `/usr/share/oxidns/webui`. It keeps the installed bundle when that is `full` or `standard`; otherwise it uses the bundle configured in `Settings`, falling back to `standard` when neither includes WebUI. The device must be able to reach GitHub, and existing configuration is preserved.

During core installation, LuCI adapts the official `config.yaml` to OpenWrt defaults: logs go to `/tmp/oxidns/oxidns.log`, the management API listens on the current LAN address at port `9199` (falling back to `0.0.0.0:9199`), and the WebUI static root points to `/usr/share/oxidns/webui`. An existing configuration file is never overwritten.

## Make OxiDNS The System DNS

OxiDNS's `udp_server` / `tcp_server` plugins listen on `:5335` by default, while port 53 on OpenWrt belongs to dnsmasq, which also serves DHCP. The recommended setup keeps dnsmasq and lets it forward queries to OxiDNS, so LAN DHCP, `xxx.lan` hostnames and lease names keep working and clients need no changes.

1. Open `Services -> OxiDNS -> DNS Configuration`, change both DNS servers under `Listen Addresses` in Normal mode to the loopback address, then click `Save and Apply`:

```yaml
  - tag: udp_server
    type: udp_server
    args:
      entry: main_sequence
      listen: "127.0.0.1:5335"

  - tag: tcp_server
    type: tcp_server
    args:
      entry: main_sequence
      listen: "127.0.0.1:5335"
```

Upstream servers are configured in the `forward` plugin's `upstreams`, which defaults to `223.5.5.5`.

2. Point dnsmasq at OxiDNS:

```sh
uci set dhcp.@dnsmasq[0].noresolv='1'
uci add_list dhcp.@dnsmasq[0].server='127.0.0.1#5335'
uci commit dhcp
/etc/init.d/dnsmasq restart
```

`noresolv=1` makes dnsmasq ignore `/tmp/resolv.conf.d/resolv.conf.auto`, so a WAN reconnect cannot silently bypass OxiDNS.

3. Verify:

```sh
nslookup -po=5335 www.baidu.com 127.0.0.1   # OxiDNS directly
nslookup www.baidu.com 127.0.0.1            # through dnsmasq
```

Queries through dnsmasq should time out while OxiDNS is stopped and recover when it starts again, which confirms the traffic really goes through OxiDNS.

Roll back with:

```sh
uci set dhcp.@dnsmasq[0].noresolv='0'
uci -q delete dhcp.@dnsmasq[0].server
uci commit dhcp
/etc/init.d/dnsmasq restart
```

If OxiDNS needs to apply per-client policies based on the source address, it can listen on port 53 instead: run `uci set dhcp.@dnsmasq[0].port='0'` to turn off dnsmasq's DNS function (DHCP keeps working), make sure DHCP still advertises the router as DNS, then change both `listen` values above to `":53"`. The trade-offs are that `xxx.lan` hostnames, DHCP lease names and dnsmasq's rebind protection no longer apply, and IPv6 clients require OxiDNS to listen on IPv6 as well, for example `"[::]:53"`.

Either way, never expose port 53 or 5335 to the WAN, or the router becomes an open resolver.

## Manage DNS With The OxiDNS WebUI

OxiDNS ships its own WebUI, and it edits the same configuration file as the LuCI `DNS Configuration` page. After installing a core bundle that includes WebUI files, click `Open WebUI` on `Basic Settings`. When the button is unavailable, the page explains whether WebUI files are missing, the service is stopped, or the listen address only allows local access. The WebUI provides a dashboard, plugin center, runtime logs, system settings, a configuration editor, and software upgrade, which makes it convenient to manage plugins, compose sequences, and inspect query and cache data.

The WebUI is served from the static directory configured by `api.http.webui.root`, and its management API is always same-origin under `/api/*`. The default OpenWrt installation points the WebUI root at `/usr/share/oxidns/webui` and makes the API listen on the current LAN address at port `9199`. The `api.http: "ip:port"` shorthand cannot mount the WebUI and does not support TLS, authentication, or CORS; click `Convert to expanded form` in Normal Mode (the listen address, comments, and quote style are preserved), or switch to the expanded form and set `webui.root` / `webui.index` in Advanced mode or the WebUI configuration editor. See [info/README.en.md](info/README.en.md#6-configure-dns-through-the-webui) for complete WebUI instructions.

## Main Pages

- `Basic Settings`: LuCI backend, core, build, service status, boot autostart, WebUI entry, config path, and working directory, with `Start`, `Stop`, and `Restart`.
- `DNS Configuration`: `Normal Mode` edits log, runtime worker threads, included files (`include`), API/WebUI (including TLS, Basic authentication, and CORS, with one-click conversion from the shorthand), listen addresses, upstream DNS, and common plugin fields (including the `http_server` DoH entries, the `download` list, and `ttl`, `reverse_lookup`, and `prefer_ipv4` / `prefer_ipv6`); `Advanced Mode` edits the full YAML. Both modes support `Validate`, `Download Config`, `Upload Config` (the file must be named `config.yaml`), `Save and Apply`, `Save`, and `Reset`, and show a change preview. `Save and Apply` always restarts the service, while `Save` only writes the file.
- `Settings`: the `Core Actions` section installs, updates, upload-installs, repairs, installs WebUI only, or removes the OxiDNS core; `Autostart` controls boot autostart; below that, configure core repository, bundle, config path, log path, working directory, system log output, and download credentials.
- `Logs`: view runtime logs with pause/resume, refresh, clear, and automatic scrolling; the log file path is configured on the `Settings` page.

## Default Paths

- Binary: `/usr/bin/oxidns`
- WebUI: `/usr/share/oxidns/webui`
- Config: `/etc/oxidns/config.yaml`
- Working directory: `/var/lib/oxidns`
- Log file: `/tmp/oxidns/oxidns.log`
- Init script: `/etc/init.d/oxidns`

## Upgrade And Remove

To upgrade the OxiDNS core, click `Update Core` at the top of the LuCI `Settings` page; it checks the latest official release and installs it when a newer version exists. You can also use the upgrade feature built into OxiDNS itself, such as the core WebUI / API / CLI upgrade flow.

To upgrade the LuCI app, download and install the newer `luci-app-oxidns` package. The LuCI UI does not provide self-upgrade.

To remove the OxiDNS core, click `Remove Core` at the top of the LuCI `Settings` page. This stops and disables the service and removes `/usr/bin/oxidns` and `/usr/share/oxidns/webui`. `/etc/oxidns/config.yaml` and `/var/lib/oxidns` are preserved by default; the confirmation dialog can also delete them.

## Private Repositories And Downloads

The router must be able to reach GitHub Releases and release archives directly. For private repositories or restricted networks, configure a GitHub token or download proxy in `Settings`. Token and proxy values are never shown again after saving; use the matching clear option to remove them. A configured download proxy requires `curl`; otherwise LuCI returns a clear error. You can also use `Upload Core` at the top of the `Settings` page to install an archive or binary offline.

## Known Limitations

- Only published OxiDNS Linux musl release targets are supported.
- `Update Core` only installs strictly newer stable releases. It never downgrades a newer or custom installed build; versions that cannot be parsed are treated as needing no update.
- Before replacing the core or WebUI, LuCI stages and verifies the new files. If a copy fails, the previous core binary and WebUI are restored, so a new binary is not left running without its WebUI.
- The `Basic Settings` WebUI entry is generated from the HTTP listen address in the config file and requires WebUI files, a running OxiDNS service, and a usable URL. If it listens on `127.0.0.1` or `::1`, LuCI keeps the link and shows a hint that local access or an SSH tunnel is required; `0.0.0.0` / `[::]` is replaced with the host used to reach the router in the browser. A `minimal` bundle or an uploaded single binary does not contain WebUI files.
- Normal mode only edits plugin instances that already exist in the configuration. Adding or removing plugins and changing sequence rules must be done in Advanced mode or the OxiDNS WebUI. When the file uses YAML anchors, aliases, or merge keys, Normal mode becomes read-only.
- Normal mode covers logging, `runtime.worker_threads`, the `include` list, the management API (listen, WebUI, TLS, Basic authentication, CORS), UDP/TCP/QUIC/HTTP server entry and listen settings, upstream DNS, and common plugin fields (including the `http_server` DoH entries, the `download` list, `ttl`, `reverse_lookup`, and `prefer_ipv4` / `prefer_ipv6`). Before saving it checks required fields, numeric ranges, enum values, paired certificate/key settings, and `include` entries against the built-in schema. `network.outbound`, sequence/rules, and unlisted plugin types still need Advanced mode or the WebUI.
- Saving from Normal mode re-serializes the file: comments, field order, and fields the form does not manage are preserved, but whitespace formatting may be adjusted slightly. Only fields that were actually edited are written; untouched defaults are not added to the file. Saving from Advanced mode writes the text exactly as written.
- Normal mode, Advanced mode, and the OxiDNS WebUI edit the same configuration file. After the WebUI saves, reload the LuCI page to see the new content. LuCI checks the file mtime before saving and refuses to overwrite a file changed elsewhere; the WebUI has no equivalent conflict check, so use only one editing entry point at a time.
- The log page reads the log file configured as `log.file`, which defaults to `/tmp/oxidns/oxidns.log`, and falls back to OpenWrt `logread` when the file does not exist or is not readable. The "Log path" field on the `Settings` page sets the log directory and writes `log.file` into the config file when settings are saved; when OxiDNS is running it is restarted so the setting takes effect. Core installation writes `/tmp/oxidns/oxidns.log` by default, which is cleared on reboot.
- `Settings` includes a "Write to system log" switch, enabled by default. OxiDNS must be restarted after saving a change. LuCI stops the service, waits up to 10 seconds for the old procd instance to be removed, and then starts a new instance so the stdout/stderr settings are applied. A failed state query or stop timeout aborts the restart. The same stop wait is used before replacing a running core.
- `Start` / `Stop` / `Restart` on `Basic Settings` and `Enable on boot` / `Disable on boot` under `Autostart` on `Settings` always write a `luci-app-oxidns` tagged audit record to the system log, including the action and whether it succeeded. It is written even when the core is not installed, the init script is missing, or the action fails. These records are visible in raw `logread` output and in the LuCI system log page; they do not appear on the OxiDNS log page, which only renders `oxidns[PID]:` output from the core.

## License

This project is licensed under the GNU General Public License v3.0 or later (`GPL-3.0-or-later`). See [LICENSE](LICENSE) for the full license text.

## Acknowledgements

- [https://oxidns.org/](https://oxidns.org/): the official OxiDNS homepage, with documentation, configuration references, and project news.
- [https://github.com/svenshi/oxidns](https://github.com/svenshi/oxidns): the source repository for the OxiDNS core and its WebUI; the core binary and WebUI files installed by this LuCI app come from that project's releases.
- This repository is cloned from [svenshi/luci-app-oxidns](https://github.com/svenshi/luci-app-oxidns) and optimized on top of it.
