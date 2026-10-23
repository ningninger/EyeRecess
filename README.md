# EyeRecess

A tray and menu bar app that helps you take regular screen breaks. It estimates active computer use and offers gentle reminders, guided short breaks, and longer time away from the screen.

[Chinese introduction](README.zh-CN.md)

## Install

Download a build from [Releases](https://github.com/ningninger/eyerecess/releases):

- **macOS:** choose the DMG for Apple Silicon (`arm64`) or Intel (`x64`).
- **Windows:** choose the installer or portable executable.
- **Linux:** run from source or build an AppImage locally.

Current builds are unsigned and may trigger an operating system warning. After launch, open Settings from the tray or menu bar icon. Closing Settings leaves the app running; use Quit to exit.

Installers and portable builds bundle the Electron runtime. End users do not need to install Node.js, npm, or Electron. GitHub source archives are developer checkouts and are not ready-to-run applications.

## Features

- Micro, short, and long breaks with configurable schedules.
- Simple reminder controls, optional custom guidance, and a recommended-plan reset.
- Guided eye closure, blinking, and movement breaks.
- Quiet hours, pause controls, and meeting-aware reminders.
- Local settings and daily usage summaries, with no account or cloud sync.

Activity and meeting detection are approximate. Passive reading may be treated as idle time, and a running meeting app may reduce reminders even outside a call. This app supports healthy habits; it does not diagnose or treat medical conditions.

## Development

Requires Node.js 22.12.0 or later and npm.

Run `npm ci` before starting a source checkout. It installs the locked development dependencies and downloads the Electron runtime, so initial setup requires internet access. If the download is interrupted, rerun `npm ci`; do not skip install scripts. Once setup is complete, the app can run offline.

If you already installed npm packages but startup still reports a missing runtime, run `npm run setup:electron`, then `npm start`. Electron 45 defers its binary download by default; this project's postinstall step now downloads it during `npm ci`. Launch commands check installed files without initiating downloads.

If runtime setup reports a download failure, see [download recovery](docs/support.md#electron-download-failures) for proxy and optional mirror settings.

```bash
npm ci
npm start
npm test
npm run check
```

On Windows, `EyeRecess.vbs` starts without a console; `npm run win` shows launcher output. See [Contributing](CONTRIBUTING.md) for repository rules and required validation.

## Documentation

- [Product behavior](docs/product.md)
- [Architecture and directory ownership](docs/architecture.md)
- [Development workflow](docs/development.md)
- [Release procedure](docs/release.md)
- [Support](docs/support.md)
- [Platform compatibility](docs/compatibility.md)
- [Security boundaries](docs/security.md)
- [Changelog](CHANGELOG.md)

[MIT License](LICENSE)
