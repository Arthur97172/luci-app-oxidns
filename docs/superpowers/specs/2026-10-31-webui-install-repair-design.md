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

## WebUI-Only Install

New RPC `core_webui_upload`, input `{"path":"/tmp/oxidns-core-upload-..."}`:

1. Validate the upload path and require an installed core
   (`core_not_installed` otherwise).
2. Require a readable `.tar.gz`; reject other files with
   `uploaded_webui_invalid`.
3. Apply the existing archive safety checks (`uploaded_archive_unsafe`) and
   unpack into a temporary directory.
4. Require `webui/` with at least one file (`uploaded_webui_missing`),
   otherwise pass the archive-safety error.
5. Stage the files, then replace `/usr/share/oxidns/webui` with rollback.
6. Leave the binary, config, working directory, and service state unchanged.

Success:

```json
{
  "ok": true,
  "action": "webui_install",
  "installed": true,
  "file_count": 92,
  "webui_path": "/usr/share/oxidns/webui"
}
```

Failures use the existing detailed error shape; the previous WebUI is kept.
The method is registered in `list` and the ACL write list, and holds the core
operation lock.

## Status And Overview

`status.webui.installed` remains the source of truth. The Overview WebUI hint
now distinguishes:

- No installed core: ask the user to install the core first.
- Minimal bundle with no WebUI: explain that the minimal bundle does not include
  WebUI by design and point to the Core page's Install WebUI action, or a full /
  standard bundle.
- Other missing WebUI: point to the Core page's Install WebUI action.

The Core page adds a `WebUI` status row and shows an `Install WebUI` action when
a core is installed and the WebUI is missing:
`Repair Reinstall | Update Core | Install WebUI | Upload Core | Remove Core`.
The action uploads an archive and runs through the existing progress modal.

## Copy And Version

New i18n strings cover the action, progress label, validation stage, updated
descriptions, and Overview hints. The old "Upload an official full or standard
archive to install the WebUI" warning is replaced with a pointer to Install
WebUI. `PKG_VERSION` moves from 0.1.8 to 0.1.9.

## Testing

`scripts/integration-check.sh` asserts:

- `list` contains `core_webui_upload`; ACL write contains it and read does not.
- Invalid upload paths return `invalid_upload_path`.
- A valid upload path with no installed core returns `core_not_installed` and
  removes the uploaded file.
- `core_webui_upload` while the lock is held returns `core_operation_busy`.
- Extracted helpers: `bundle_includes_webui` accepts `full`/`standard` and
  rejects `minimal`/empty/custom; `dir_has_files` and `stage_webui_files` handle
  populated and empty directories; `install_staged_webui` replaces a directory
  and restores it on failure; `install_core_files` replaces binary and WebUI and
  restores both when the WebUI stage is missing.

`scripts/service-check.sh` includes `webui/index.html` in its release fixture so
the real release install path exercises staging. Then run `scripts/check.sh`,
`scripts/integration-check.sh`, and
`scripts/release-check.sh 0.1.9 /tmp/luci-app-oxidns-release-check`.
