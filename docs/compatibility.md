# Platform compatibility

These are implementation targets and known limits, not a claim of completed native testing on every platform. Electron's supported operating systems and architecture determine the runtime baseline.

| Environment | Packaging and integration | Required native checks |
| --- | --- | --- |
| macOS Apple Silicon | arm64 app, DMG and ZIP; menu bar, optional Dock hiding and packaged login integration | Displays and Spaces, sleep/lock, shortcuts, installed login item, signed/notarized launch |
| macOS Intel | Separate x64 artifacts; use an x64 runtime for packaging | All macOS checks on Intel hardware; an arm64 local build does not validate this target |
| Windows x64 | Installer and portable executable; tray and packaged login integration | Scaling, multiple displays, lock/unlock, installer paths, login entry, Windows protection prompts |
| Linux X11 | Local source or AppImage build; tray depends on desktop support | Idle time, display coordinates, transparent glow, tray extensions and global shortcuts |
| Linux Wayland | Partial compatibility; compositor controls placement and stacking | Always-on-top and global positioning are restricted; overlay coverage, mouse display selection, idle detection and shortcuts must not be assumed reliable |

## Platform behavior

- Login integration is offered only for packaged macOS and Windows builds. Source checkouts and Linux disable that preference and show an explanation. Linux autostart is not implemented.
- macOS menu bar icons are monochrome templates with Retina representations. Windows and Linux use colored status images. Settings and overlays share an eye/pause mark. Regenerate source images with `npm run icons`; macOS packaging creates its ICNS locally.
- Settings follow system light/dark appearance and reduced-motion preferences. Focus outlines and labels remain available for keyboard navigation. Reminder durations and local data do not depend on color mode.
- Display changes rebuild visible overlays without restarting the active phase. Every covered display has exit buttons and native Escape handling. Closing any overlay or losing its renderer cancels the session and hides other screens. Pending page loads cannot redisplay a cancelled overlay. Glow dismissal uses the desktop cursor position to make only its close button interactive; cursor positioning may be restricted under Wayland, where tray dismissal is also available.
- Clicking the macOS Dock icon opens settings; the app otherwise starts in the menu bar or tray. Closing settings keeps reminders running.
- Browser-based calls and unsupported meeting apps may not be detected. Turning off meeting reduction stops periodic process scans.

Use a runtime whose version and architecture match the packaging target when passing `electronDist`. Copy the complete `.app` or Windows distribution, not its inner executable. Do not treat a build completing on one machine as proof of another platform's behavior.

See [Development](development.md) for validation commands and [Release](release.md) for installation checks on clean machines.
