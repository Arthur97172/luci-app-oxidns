# WebUI Install And Repair Design

## Goal

Keep the installed core binary and WebUI files consistent. Uploading or
installing a core must never leave a new binary in place without the WebUI files
its bundle expects. When the WebUI is already missing, offer an offline repair
action that installs only `webui/` from an official archive without touching the
core binary or configuration.

## Problem

Both core install paths replaced the binary before copying `webui/` with
unguarded `cp`/`mv` commands. Under `set -eu`, a failed WebUI copy aborted the
RPC after the binary had already been replaced, producing "core installed, but
WebUI missing". A payload without `webui/` (minimal archive, single binary, or a
custom archive) also installed successfully and silently left the WebUI absent.

## Upload Preflight

`install_uploaded_core_from_unpack` reads `build-info` from the staged binary
and records its `bundle`. Before the service is stopped or any file is replaced:

- `full` and `standard` bundles expect WebUI files.
- `minimal` and unknown/empty bundles do not.
- The WebUI repair install picks a bundle with `webui_install_bundle`, so it
  never requests an archive that cannot contain the WebUI.
- If the payload has no `webui/` files, no WebUI is currently installed, and the
  uploaded bundle expects WebUI, reject with
  `uploaded_webui_missing` / stage `validate_uploaded_core`. The existing core
  and WebUI are untouched and the uploaded file is removed.
- If a WebUI is already installed, a binary-only upload may proceed and keeps
  the installed WebUI.
- A payload that contains `webui/` always installs it, regardless of bundle.

The release install path applies the same rule using the requested bundle: a
`full` or `standard` release archive without `webui/` is rejected before
replacement when no WebUI is installed, while `minimal` installs only the
binary.

## Staged Replacement And Rollback

New shell helpers:

- `dir_has_files(dir)` reports whether a directory contains any regular file.
- `bundle_includes_webui(bundle)` is true for `full` and `standard`.
- `stage_webui_files(source, stage)` copies `webui/` into the operation's
  temporary directory and requires at least one file.
- `install_staged_webui(stage)` moves the current `WEBUI_DIR` to a temporary
  backup, moves the staged directory into place, and restores the backup if the
  move fails.
- `install_core_files(binary, stage)` writes the new binary next to the target,
  backs up the old binary, installs the new one, and calls
  `install_staged_webui` when a stage is present. If the WebUI install fails, it
  removes the new binary and restores the old one.

Both install paths stage the WebUI before stopping the service. A staging
failure therefore aborts before any installed file changes. A replacement
failure leaves the previous binary and WebUI in place and returns
`core_files_install_failed` with a detail naming the failed step
(`binary_write_failed`, `binary_replace_failed`, `webui_replace_failed`, or
`install_directory_failed`).

Backups live next to the binary (`/usr/bin/.oxidns.previous.<pid>`) and the
WebUI directory (`/usr/share/oxidns/webui.previous.<pid>`), and are removed on
success.

## WebUI Repair Install

New RPC `core_webui_install`, no input:

1. Require an installed core that reports its version
   (`core_not_installed` otherwise), matching the Core page's button
   condition.
2. Select a bundle that includes WebUI with `webui_install_bundle`:
   keep the installed bundle when it is `full` or `standard`; otherwise use
   the `core_bundle` setting; otherwise fall back to `standard`.
3. Run the normal release install against the latest GitHub release, with
   the binary and WebUI staged and replaced together. The latest release is
   installed even when its version matches the installed one, because the
   point of the action is to restore the WebUI files.
4. The service is stopped and restarted as for any core replacement, and the
   existing config file is preserved.

Success:

```json
{
  "ok": true,
  "action": "webui_install",
  "version": "v1.6.1",
  "bundle": "standard",
  "target": "x86_64-unknown-linux-musl",
  "asset": "oxidns-standard-x86_64-unknown-linux-musl.tar.gz",
  "binary_path": "/usr/bin/oxidns",
  "webui_path": "/usr/share/oxidns/webui",
  "service_restart": "requested",
  "config_check": { "ok": true, "message": "Configuration is valid: ..." }
}
```

Failures use the existing release error shapes. The method is registered in
`list` and the ACL write list, and holds the core operation lock.

## Status And Overview

`status.webui.installed` remains the source of truth. The Overview WebUI hint
now distinguishes:

- No installed core: ask the user to install the core first.
- Minimal bundle with no WebUI: explain that the minimal bundle does not include
  WebUI by design and point to the Core page's Install WebUI action, which
  replaces it with a WebUI-capable bundle.
- Other missing WebUI: point to the Core page's Install WebUI action.

The Core page adds a `WebUI` status row and shows an `Install WebUI` action when
a core is installed and the WebUI is missing:
`Repair Reinstall | Update Core | Install WebUI | Upload Core | Remove Core`.
The action downloads the latest release and runs through the existing progress
modal, then reports the installed version and bundle.

## Copy And Version

New i18n strings cover the action, progress label, success notification,
updated descriptions, and Overview hints. The old "Upload an official full or
standard archive to install the WebUI" warning is replaced with a pointer to
Install WebUI. `PKG_VERSION` moves from 0.1.9 to 0.2.0.

## Testing

`scripts/integration-check.sh` asserts:

- `list` contains `core_webui_install`; ACL write contains it and read does not.
- `core_webui_install` with no installed core returns `core_not_installed`.
- `core_webui_install` while the lock is held returns `core_operation_busy`.
- Extracted helpers: `bundle_includes_webui` accepts `full`/`standard` and
  rejects `minimal`/empty/custom; `webui_install_bundle` prefers a WebUI-capable
  installed bundle, then the configured bundle, then `standard`; `dir_has_files`
  and `stage_webui_files` handle populated and empty directories;
  `install_staged_webui` replaces a directory and restores it on failure;
  `install_core_files` replaces binary and WebUI and restores both when the
  WebUI stage is missing.

`scripts/service-check.sh` includes `webui/index.html` in its release fixture so
the real release install path exercises staging, and runs a `webui` caller that
drives `emit_core_webui_install_locked` with a minimal installed bundle to check
the `standard` fallback and the shared stop/restart behavior. Then run
`scripts/check.sh`, `scripts/integration-check.sh`, and
`scripts/release-check.sh 0.2.0 /tmp/luci-app-oxidns-release-check`.
