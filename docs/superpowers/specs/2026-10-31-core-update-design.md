# Core Update Button Design

## Goal

Add an `Update Core` action to the Core page. A single click checks the configured
OxiDNS repository for a newer release. If one exists, LuCI downloads, verifies,
installs, and (when the service is running) restarts it. If no newer release
exists, the action exits after telling the user the core is already up to date.

## Interaction

- The button is shown only when a core is installed, between `Repair Reinstall`
  and `Upload Core`:
  `Repair Reinstall | Update Core | Upload Core | Remove Core`.
- Clicking it opens the existing progress modal, labelled
  `Checking for OxiDNS core updates...`. There is no extra confirmation dialog,
  matching the existing install and reinstall actions.
- Newer release: the backend proceeds through download, digest/checksum
  verification, archive validation, install, and service restart. On success the
  modal closes and the status table refreshes.
- No newer release: the modal closes and an info notification reports
  `OxiDNS core is already up to date.`
- Failures keep the existing error modal with stage, reason, detail, and code.

## Backend

New `core_update` RPC and `emit_core_update_locked`:

1. `load_settings`; read `version` and `bundle` from `oxidns build-info`.
2. Missing binary or missing version -> `core_not_installed`.
3. Empty bundle -> fall back to the configured `core_bundle` setting.
4. Call `install_core_from_release update latest <bundle> <current-version>`.

The whole check-and-install run holds the existing core operation lock, so it
cannot race with install, reinstall, upload, or remove.

`install_core_from_release` gains an optional fourth argument,
`PREVIOUS_VERSION`. Once release metadata is resolved and `SELECT_TAG` is known,
the function compares `SELECT_TAG` with `PREVIOUS_VERSION` before downloading:

- Not strictly newer: log the comparison, remove the temporary directory, and
  return an `updated:false` response without downloading.
- Strictly newer: continue through the existing install pipeline. The success
  response gains `"updated":true` and `"previous_version"`.

## Version Comparison

`version_is_newer(candidate, current)` is a self-contained shell/awk helper:

- Strip a leading `v`/`V`, build metadata (`+...`), and prerelease suffixes for
  the numeric core comparison.
- Split the numeric core on `.` and compare fields numerically; missing fields
  count as zero.
- Equal numeric cores: a final release is newer than a prerelease; two
  prereleases compare by string.
- Only a strictly newer candidate installs. Equal or older candidates are
  reported as up to date, so a user-supplied newer or custom build is never
  downgraded.
- Versions that do not match a numeric dotted core are treated as not newer and
  the decision is written to the progress log.

## RPC Contract

Up to date:

```json
{
  "ok": true,
  "action": "update",
  "updated": false,
  "current_version": "1.6.1",
  "latest_version": "v1.6.1",
  "bundle": "full",
  "target": "x86_64-unknown-linux-musl"
}
```

Updated: the existing install success object plus
`"action":"update"`, `"updated":true`, `"previous_version":"1.6.1"`.

Not installed: `{"ok":false,"code":"core_not_installed",...}`.

`core_update` is registered in the rpcd method list and in the ACL write list.
It is not added to the ACL read list.

## Frontend

- Declare `core_update` with `rpc.declare`.
- `handleUpdate` runs through `runCoreAction`; the success callback shows the
  up-to-date notification when `result.updated === false`.
- Add the button to the installed action list; the not-installed action list is
  unchanged.

## Copy, Documentation, Version

- New i18n strings: `Update Core`, `Checking for OxiDNS core updates...`,
  `OxiDNS core is already up to date.`
- Replace the Core page descriptions that say runtime upgrades are handled only
  by OxiDNS.
- Update `README.md`, `README.en.md`, and `AGENTS.md` to describe the update
  action and remove the statement that LuCI has no upgrade entry point.
- Bump `PKG_VERSION` from 0.1.7 to 0.1.8.

## Testing

Extend `scripts/integration-check.sh` to assert:

- `list` contains `core_update`; ACL write contains it and read does not.
- `core_update` without an installed core returns `core_not_installed`.
- `core_update` while the lock is held returns `core_operation_busy`.
- The extracted `version_is_newer` implementation handles:
  `v1.7.0 > 1.6.1`, `v1.6.1 = 1.6.1`, `v1.6.1 < 1.7.0`,
  `v1.7.0 > v1.7.0-rc1`, and unparsable versions report no update.

Run `scripts/check.sh`, `scripts/integration-check.sh`, and
`scripts/release-check.sh 0.1.8 /tmp/luci-app-oxidns-release-check`.
