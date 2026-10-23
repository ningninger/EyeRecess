# Support

EyeRecess normally starts without a window. Find its icon in the macOS menu bar or the Windows tray, including the tray overflow area. Closing Settings does not quit the application.

Current builds are unsigned. Follow the operating system's normal verification and approval flow for software from a trusted source. If a download appears damaged, verify its checksum or download it again before changing system protections.

For startup issues, first check that another EyeRecess instance is not already running. On Windows, use `run-windows.cmd` for visible launcher output. The tray menu can open the local log folder when the app is running.

Installers and portable builds include Electron and do not require Node.js or npm. If a packaged application cannot find its runtime files, reinstall or extract the complete distribution again; installing development dependencies is not the repair path for packaged builds. On Linux, AppImage support depends on the host environment.

Source checkouts require Node.js 22.12.0 or later and `npm ci` before launch. npm downloads Electron during installation; interrupted downloads or skipped install scripts can leave an incomplete runtime. Rerun `npm ci` with network access. `npm start`, `npm run demo`, and `npm run smoke` report missing source dependencies with setup steps. On Windows, the quiet source launcher also shows a dialog when Electron is absent.

For an existing checkout with npm packages already installed, use `npm run setup:electron` to download or repair the runtime without reinstalling all packages. Electron 45 itself defers binary download until first use; the project's postinstall step makes that download explicit during installation. Source startup checks remain offline and never trigger a download.

## Electron download failures

`fetch failed` means the runtime download did not complete; the application has not started. Access to the npm registry does not guarantee access to GitHub release downloads. The setup helper reports DNS, connection, TLS, HTTP, checksum, and file-write failures without printing credentials or raw error stacks.

If you use an HTTP(S) proxy, set `HTTPS_PROXY` to its actual HTTP(S) endpoint before running `npm run setup:electron`. The helper also recognizes `HTTP_PROXY`, lowercase equivalents, and `NO_PROXY`. Proxy support requires optional npm dependencies; if they were omitted, reinstall with `npm ci --include=optional`. A system proxy setting alone does not guarantee that Node.js downloads use it.

Alternatively, explicitly select the third-party npmmirror source for this command. On macOS or Linux:

```sh
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_CUSTOM_DIR='{{ version }}' \
npm run setup:electron
```

In PowerShell:

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_CUSTOM_DIR = '{{ version }}'
npm run setup:electron
Remove-Item Env:ELECTRON_MIRROR, Env:ELECTRON_CUSTOM_DIR
```

The mirror is opt-in; GitHub remains the default. Existing Electron npm configuration can override these environment settings. The downloader validates archives against checksums bundled in the installed Electron npm package for either source. Never disable TLS or checksum verification to fix a download. A mirror may not yet carry a newly published release; an HTTP 404 requires another source or a later retry.

After setup reports that the runtime is ready, run `npm start`. For test-only environments, `ELECTRON_SKIP_BINARY_DOWNLOAD=1` skips installation; unset it before desktop setup. `force_no_cache=true npm run setup:electron` forces a fresh download on macOS/Linux if a cached archive is damaged.

When requesting help, include the app version, operating system, reproduction steps, and a minimal reviewed error excerpt. Remove personal paths and identifying data. Do not publish complete logs, environment values, configuration files, or unrelated crash records.

Windows developers may explicitly run `diagnose.cmd` to create a local readiness report. This report is not uploaded automatically. Native desktop and packaging issues should be reproduced on the affected operating system.
