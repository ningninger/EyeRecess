<p align="center">
  <img src="assets/icon-512.png" width="112" height="112" alt="EyeRecess — an eye with a pause symbol" />
</p>

<h1 align="center">EyeRecess</h1>

<p align="center">
  <strong>A little recess for your eyes.</strong><br />
  Gentle screen breaks, right from your menu bar or tray.
</p>

<p align="center">
  <a href="https://github.com/ningninger/eyerecess/releases"><strong>Download</strong></a> ·
  <a href="#your-first-recess">Get started</a> ·
  <a href="README.zh-CN.md">Chinese</a> ·
  <a href="docs/support.md">Support</a>
</p>

<p align="center">
  No account. Local settings. A rhythm you can make your own.
</p>

<p align="center">
  <img src="docs/images/recess-rhythm.svg" width="960" alt="Work, pause, return: a small screen break makes room for the next thing." />
</p>

## Small breaks. Room for your day.

Start with the recommended plan, then adjust it to fit your routine. EyeRecess estimates active computer use and gives you three ways to step back.

| 🌱 A moment | 🌿 A reset | 🌳 A proper recess |
| :--- | :--- | :--- |
| **Micro break · every 10 min** | **Short break · every 50 min** | **Long break · every 2 hr** |
| A soft edge glow, with occasional guided eye closure. | Close your eyes, blink, and take a moment to move. | Leave the screen behind. Stretch, walk, or get some water. |

*These are the default intervals, based on estimated active time. Each reminder can be adjusted or switched off.*

### Make it yours

- **Start simple.** Choose a preset or keep the recommended plan.
- **Add your own nudge.** Customize timings, break steps, and reminder text.
- **Leave room for focus.** Pause reminders, set quiet hours, or use lighter reminders when meeting software is running.
- **Keep reading.** Turn on Reading mode in **More settings → System** to keep time and reminders moving while you read or watch a video without touching the keyboard or pointer.
- **Stay in control.** Exit any guided break with its exit button or Escape. Micro reminders last 20 seconds; the standard short break lasts two minutes.
- **Keep it local.** Settings and daily summaries stay on your computer, with no account or cloud sync.

### New in 0.1.2

Reading mode joins more stable break covers, corrected elapsed-time accounting, and better release of background reminder resources. Idle pauses now explain themselves next to your activity summary. See the [changelog](CHANGELOG.md) for changes and validation limits.

## Your first recess

**[Download EyeRecess →](https://github.com/ningninger/eyerecess/releases)**

| Platform | Choose your build |
| :--- | :--- |
| **macOS** | Apple Silicon: `arm64` DMG · Intel: `x64` DMG |
| **Windows** | Installer or portable executable |
| **Linux** | Run from source or build an AppImage locally |

1. Open the app, then find the eye icon in your menu bar or system tray.
2. Open **Settings** and keep the recommended plan or choose your own rhythm.
3. Get back to your day. Start a break manually whenever you need one.

Closing Settings leaves EyeRecess running. Choose **Quit** from the menu to exit.

**Updating an existing installation?** Quit EyeRecess first, download the new build, and replace the old app (on macOS, replace EyeRecess in **Applications**). Settings and daily summaries are retained. Open Settings and check the version beside the app name. EyeRecess does not update itself; pulling the repository or running `npm start` does not replace an installed app.

> **Ready-to-run builds include the runtime.** You do not need Node.js, npm, or Electron to use an installer or portable build. GitHub's “Source code” archives are for development.

### Before you install

#### macOS: allow the first launch

EyeRecess is free and open source. The maintainer is currently unable to cover the annual Apple Developer Program membership fee needed for Mac App Store distribution and Developer ID signing. The app is distributed through GitHub Releases instead; current macOS builds have no Developer ID signature or Apple notarization, so macOS may block the first launch with an unidentified-developer or verification warning. Users do not need to pay this membership fee.

If you downloaded EyeRecess from this repository's [Releases](https://github.com/ningninger/eyerecess/releases) page and trust that copy:

1. Open the DMG, drag **EyeRecess** into **Applications**, then try opening it once.
2. If macOS blocks it, open **System Settings → Privacy & Security**, scroll down to the **Security** section, and click **Open Anyway** next to the EyeRecess notice.
3. Authenticate if prompted, then click **Open** in the confirmation dialog. Labels and availability can vary by macOS version or device policy; see [Apple's instructions](https://support.apple.com/en-us/102445).

The source code is public for community inspection, review, and issue reporting. This transparency supports community oversight; it is not a guarantee that every release has been independently audited. The steps above apply to developer-verification warnings. If macOS reports malware or that the app will damage your computer, stop and report it rather than overriding that warning.

#### Other platform notes

Current Windows builds are also unsigned and may trigger an operating system warning. Login startup is available only in packaged macOS and Windows apps. Linux Wayland can limit overlays, window positioning, and global shortcuts; see [platform compatibility](docs/compatibility.md).

Activity and meeting detection are approximate: passive reading may count as idle, and a running meeting app can reduce reminders outside a call. Enable **Reading mode** under **More settings → System** to keep time and reminders advancing without keyboard or pointer input. Breaks, lock, and sleep still pause counting; lock your computer when leaving it. EyeRecess supports break habits; it does not diagnose or treat medical conditions.

## For the curious

<details>
<summary><strong>Run from source</strong> — Node.js 22.12.0+ and npm required</summary>

From the repository root:

```bash
npm ci
npm start
```

Initial setup requires internet access to install dependencies and download the Electron runtime. Let install scripts finish; once setup is complete, the app can run offline. Running from source does not install the app into your system's Applications folder.

Already installed packages, but the runtime is missing? Run `npm run setup:electron`, then `npm start`. For failed downloads, see [download recovery](docs/support.md#electron-download-failures).

On Windows, `EyeRecess.vbs` starts without a console; `npm run win` shows launcher output.

Before contributing, run `npm test` and `npm run check`, and read [Contributing](CONTRIBUTING.md).

</details>

<details>
<summary><strong>Explore the project</strong> — behavior, development, and boundaries</summary>

- [Product behavior](docs/product.md)
- [Architecture and directory ownership](docs/architecture.md)
- [Development workflow](docs/development.md)
- [Release procedure](docs/release.md)
- [Platform compatibility](docs/compatibility.md)
- [Security boundaries](docs/security.md)
- [Changelog](CHANGELOG.md)

</details>

## Support a little recess

EyeRecess is free and open source. If it helps your day, you can make a voluntary contribution toward project maintenance and Apple Developer Program membership fees. All features remain available whether or not you contribute. Thank you for your support.

| WeChat appreciation | Alipay |
| :---: | :---: |
| <a href="docs/images/support-wechat.png"><img src="docs/images/support-wechat.png" width="200" height="200" alt="WeChat appreciation code for voluntary project support" /></a> | <a href="docs/images/support-alipay.png"><img src="docs/images/support-alipay.png" width="200" height="200" alt="Alipay QR code for voluntary project support" /></a> |

Scan with the matching app, or click an image to view the full-size code.

---

<p align="center">
  <img src="assets/mark.svg" width="28" height="28" alt="" /><br />
  <sub>A pause belongs in the plan. · <a href="LICENSE">MIT License</a></sub>
</p>
