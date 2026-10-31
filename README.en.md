# luci-app-oxidns

Language: [中文](./README.md) | English

`luci-app-oxidns` is the LuCI management app for OxiDNS on OpenWrt. After installation, LuCI adds `Services -> OxiDNS` pages for installing the OxiDNS core binary, managing the OpenWrt service, editing configuration, and viewing logs.

This repository provides only a simple implementation for installing and managing OxiDNS. Other developers are welcome to extend it or build alternative LuCI plugins that cover the existing functionality and offer more features.

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
3. After installation succeeds, use `Basic Settings` to start and enable the service.

LuCI selects the OxiDNS Linux musl release archive for the current CPU architecture, such as `oxidns-x86_64-unknown-linux-musl.tar.gz`. The GitHub release asset SHA256 digest is verified before installation.

Note: the `full` and `standard` archives include the WebUI files, while the `minimal` archive does not; uploading a single `oxidns` binary does not install the WebUI either. When no WebUI is installed, LuCI rejects an uploaded `full` or `standard` core that lacks `webui/`, so a new binary cannot be left without its WebUI.

When the core is already installed, the `Core Actions` section at the top of the `Settings` page offers `Update Core`, `Repair Reinstall`, `Install WebUI`, and `Upload Core`. `Update Core` checks the latest official release and only downloads and installs when a newer version exists, keeping the currently installed bundle. `Repair Reinstall` and `Upload Core` repair the binary or WebUI files by downloading the current installed version again or using an uploaded file. When the WebUI is missing, `Install WebUI` downloads the latest official release from GitHub and replaces both the core binary and `/usr/share/oxidns/webui`. It keeps the installed bundle when that is `full` or `standard`; otherwise it uses the bundle configured in `Settings`, falling back to `standard` when neither includes WebUI. The device must be able to reach GitHub, and existing configuration is preserved.

## Make OxiDNS The System DNS

OxiDNS's `udp_server` / `tcp_server` plugins listen on `:5335` by default, while port 53 on OpenWrt belongs to dnsmasq, which also serves DHCP. The recommended setup keeps dnsmasq and lets it forward queries to OxiDNS, so LAN DHCP, `xxx.lan` hostnames and lease names keep working and clients need no changes.

1. Open `Services -> OxiDNS -> DNS Configuration`, make the two DNS servers listen on the loopback address only, save, and restart OxiDNS:

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

## Main Pages

- `Basic Settings`: core, service, WebUI entry, config path, and working directory, with service controls.
- `DNS Configuration`: edit common settings with the normal mode or the full YAML editor, validate and save the config, and download it or upload a `config.yaml` to replace it.
- `Settings`: install, update, upload install, repair reinstall, install WebUI only, or remove the OxiDNS core binary at the top of the page; below that, configure core repository, bundle, config path, log path, working directory, and download credentials.
- `Logs`: view runtime logs with refresh and pause controls.

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

To remove the OxiDNS core, click `Remove Core` at the top of the LuCI `Settings` page. This stops and disables the service, removes `/usr/bin/oxidns` and `/usr/share/oxidns/webui`, and preserves `/etc/oxidns/config.yaml` and `/var/lib/oxidns`.

## Private Repositories And Downloads

The router must be able to reach GitHub Releases and release archives directly. For private repositories or restricted networks, configure a GitHub token or download proxy in `Settings`. Token and proxy values are never shown again after saving; use the matching clear option to remove them. A configured download proxy requires `curl`; otherwise LuCI returns a clear error. You can also use `Upload Core` at the top of the `Settings` page to install an archive or binary offline.

## Known Limitations

- Only published OxiDNS Linux musl release targets are supported.
- `Update Core` only installs strictly newer stable releases. It never downgrades a newer or custom installed build; versions that cannot be parsed are treated as needing no update.
- Before replacing the core or WebUI, LuCI stages and verifies the new files. If a copy fails, the previous core binary and WebUI are restored, so a new binary is not left running without its WebUI.
- The `Basic Settings` WebUI entry is generated from the HTTP listen address in the config file. If it listens on `127.0.0.1`, LuCI keeps the link and shows a hint that local access or an SSH tunnel is required.
- The log page reads the log file configured as `log.file`, which defaults to `/tmp/oxidns/oxidns.log`, and falls back to OpenWrt `logread` when the file does not exist or is not readable. The "Log path" field on the `Settings` page sets the log directory and writes `log.file` into the config file when settings are saved; when OxiDNS is running it is restarted so the setting takes effect. Core installation writes `/tmp/oxidns/oxidns.log` by default, which is cleared on reboot.
- The Configuration page opens in normal mode, which covers log, API/WebUI, listen addresses, forward upstreams, and a plugin overview. Edit other options in Advanced mode. Saving from normal mode re-serializes the file: comments, field order, and fields the form does not manage are preserved, but whitespace formatting may be adjusted slightly. Saving from Advanced mode writes the text exactly as written.
- `Settings` includes a "Write to system log" switch, enabled by default. OxiDNS must be restarted after saving a change. LuCI stops the service, waits up to 10 seconds for the old procd instance to be removed, and then starts a new instance so the stdout/stderr settings are applied. A failed state query or stop timeout aborts the restart. The same stop wait is used before replacing a running core.
- Service actions on `Basic Settings` (Start / Stop / Restart / Enable / Disable) always write a `luci-app-oxidns` tagged audit record to the system log, including the action and whether it succeeded. It is written even when the core is not installed, the init script is missing, or the action fails. These records are visible in raw `logread` output and in the LuCI system log page; they do not appear on the OxiDNS log page, which only renders `oxidns[PID]:` output from the core.

## License

This project is licensed under the GNU General Public License v3.0 or later (`GPL-3.0-or-later`). See [LICENSE](LICENSE) for the full license text.

## Acknowledgements

This repository is cloned from [svenshi/luci-app-oxidns](https://github.com/svenshi/luci-app-oxidns) and optimized on top of it.
