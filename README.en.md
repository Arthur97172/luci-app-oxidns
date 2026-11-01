# luci-app-oxidns

Language: [中文](./README.md) | English

`luci-app-oxidns` is the LuCI management app for OxiDNS on OpenWrt. After installation, LuCI adds `Services -> OxiDNS` pages for installing the OxiDNS core, managing the OpenWrt service, editing configuration, and viewing logs.

This repository contains only the LuCI management UI and the rpcd backend; the OxiDNS core, WebUI, and general releases come from [svenshi/oxidns](https://github.com/svenshi/oxidns).

**Full guide**: configuring DNS from scratch, the Normal/Advanced mode field reference, plugin fields, common tasks, troubleshooting, and OxiDNS WebUI instructions are in [info/README.en.md](info/README.en.md).

## Features

- `Basic Settings`: backend, core, build, service status, boot autostart, and WebUI entry, with start, stop, and restart.
- `DNS Configuration`: Normal mode forms and Advanced mode full YAML; both support validation, config download/upload, save, save and apply, and a change preview.
- `Settings`: install, update, upload, repair, or remove the core and WebUI; configure core repository, bundle, paths, system log output, and download credentials.
- `Logs`: view OxiDNS runtime logs.

## Install The LuCI App

Download the package from this repository's Releases, upload it to the device (for example `/tmp`), then install it.

OpenWrt 24.10 (`opkg`):

```sh
opkg install /tmp/luci-app-oxidns_*.ipk

# Optional: install the Simplified Chinese language pack
opkg install /tmp/luci-i18n-oxidns-zh-cn_*.ipk
```

OpenWrt 25.12 (`apk`):

```sh
apk add --allow-untrusted /tmp/luci-app-oxidns-*.apk

# Optional: install the Simplified Chinese language pack
apk add --allow-untrusted /tmp/luci-i18n-oxidns-zh-cn-*.apk
```

If the menu does not appear after installation, restart `rpcd`, then open `Services -> OxiDNS`:

```sh
/etc/init.d/rpcd restart
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

The artifacts appear under `bin/packages/<arch>/`: a 24.10 build tree produces `.ipk`, and a 25.12 build tree produces `.apk`.

## Install And Upgrade The OxiDNS Core

When migrating from the old OpenWrt `oxidns` package, stop the service and remove the old package first so it no longer owns `/usr/bin/oxidns` or `/etc/init.d/oxidns`:

```sh
/etc/init.d/oxidns stop
opkg remove oxidns    # on apk systems: apk del oxidns
```

Open `Services -> OxiDNS -> Settings`, confirm `Core repository` is `svenshi/oxidns` and `Core bundle` is `full`, then click `Install Core`. For offline installs, `Upload Core` accepts an official `.tar.gz` archive or a single `oxidns` binary. LuCI selects the matching Linux musl release for the device architecture and verifies the release asset SHA256 digest. An existing configuration file is never overwritten.

The `full` / `standard` archives include the WebUI; the `minimal` archive and a single binary do not. After installing the core, click `Start` on `Basic Settings` and enable boot autostart under `Autostart` on `Settings`. When a core is already installed, `Core Actions` also offers `Update Core`, `Repair Reinstall`, `Install WebUI`, `Upload Core`, and `Remove Core`; `Remove Core` keeps `/etc/oxidns/config.yaml` and `/var/lib/oxidns` by default.

For making OxiDNS the system DNS, forwarding through dnsmasq, and rolling back, see [info/README.en.md](info/README.en.md#49-forward-through-dnsmasq-recommended).

## Default Paths

| Item | Path |
| --- | --- |
| Core binary | `/usr/bin/oxidns` |
| WebUI | `/usr/share/oxidns/webui` |
| Configuration | `/etc/oxidns/config.yaml` |
| Working directory | `/var/lib/oxidns` |
| Log file | `/tmp/oxidns/oxidns.log` |
| Init script | `/etc/init.d/oxidns` |

## Known Limitations

- Only published OxiDNS Linux musl release targets are supported.
- `Update Core` installs only strictly newer stable releases and never downgrades a newer or custom build.
- Before replacing the core or WebUI, LuCI stages and verifies the new files; if a copy fails, the old files are restored so the core and WebUI cannot be left mismatched.
- Normal mode only edits plugin instances that already exist. Adding or removing plugins and changing sequence rules require Advanced mode or the OxiDNS WebUI; with YAML anchors, aliases, or merge keys, Normal mode becomes read-only.
- Saving from Normal mode re-serializes the YAML: comments, field order, and fields the form does not manage are preserved, and only edited fields are written. Normal mode, Advanced mode, and the OxiDNS WebUI edit the same file, so use only one entry point at a time.
- The WebUI entry on `Basic Settings` requires installed WebUI files, a running service, and a reachable HTTP listen address; with `127.0.0.1` / `::1`, use local access or an SSH tunnel.

## Private Repositories And Downloads

The router must be able to reach GitHub Releases and release archives. For private repositories or restricted networks, configure a GitHub token or download proxy in `Settings`; saved values are never shown again in LuCI. A download proxy requires `curl`; alternatively use `Upload Core` for offline installs.

## License

This project is licensed under the GNU General Public License v3.0 or later (`GPL-3.0-or-later`). See [LICENSE](LICENSE) for the full license text.

## Acknowledgements

- [https://oxidns.org/](https://oxidns.org/): the official OxiDNS homepage, with documentation, configuration references, and project news.
- [https://github.com/svenshi/oxidns](https://github.com/svenshi/oxidns): the source repository for the OxiDNS core and its WebUI; the core and WebUI files installed by this plugin come from that project's releases.
- This repository is cloned from [svenshi/luci-app-oxidns](https://github.com/svenshi/luci-app-oxidns) and optimized on top of it.
