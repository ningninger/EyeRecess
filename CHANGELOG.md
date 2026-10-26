# Changelog

Version numbers follow [Semantic Versioning](https://semver.org/). Release notes describe source changes and available builds.

## 0.1.2

### Added

- Reading mode keeps activity time and reminders advancing without keyboard or pointer input. Enable it in More settings → System; breaks, lock, and sleep still pause accumulation.
- Activity status explains idle pauses and the current counting mode. Reading mode is saved locally and preserved when changing break presets.

### Fixed

- Keep break windows on stable displays across phase changes, reconcile display changes without replacing unaffected covers, and wait for painted content before showing a hidden cover.
- Avoid redundant display refreshes and full-cover fade-in transitions that can cause flashing.
- Use monotonic elapsed activity instead of clipping delayed samples to one second; exclude locked and suspended intervals and flush statistics at those boundaries.
- Bound pending overlay-load callbacks and remove them on cancellation or destruction, including stalled page loads.
- Release hidden reminder windows after 60 idle seconds and discard failed glow renderers to reduce retained background resources.
- Add native memory-soak tooling and regression coverage for overlay resource lifetimes.

### Validation and limits

- Automated tests and repository checks pass. Native macOS checks covered two displays, reading-mode persistence, and a full two-minute short break with one saved completion.
- Native Windows and Linux behavior and clean-machine installation have not been manually verified for this version. Short tests do not rule out every graphics-driver issue or long-running resource leak.
- Builds remain unsigned. Update by quitting the old app and replacing it with the new download; there is no automatic updater.

## 0.1.1

### Changed

- Improved settings navigation, persistent save feedback, silent-mode status, focus cancellation, and synchronization with tray changes while preserving drafts.
- Used gentle blink guidance and described the dense preset by frequency rather than a medical claim.
- Reduced preset micro reminders to 20 seconds and shortened short-break plans, preserving custom settings.
- Simplified settings with independent reminder switches, expandable content controls, custom hints, and a recommended-plan reset.
- Added source-launch dependency checks and clarified bundled runtime requirements for release builds.
- Clarified break schedules, settings labels, and product limitations.
- Standardized contributor documentation, file ownership, and automated repository checks.

### Fixed

- Every guided phase and covered display offers exit buttons and Escape; cancelling hides all overlays without recording completion. Glows and the tray also provide dismissal.
- Electron 45 runtime setup now runs during installation; existing checkouts have a dedicated repair command and offline startup checks.
- Presets now apply the intended short-break duration.
- Meeting mode reduces automatic short and long breaks to gentle reminders.
- Rapid settings edits are queued instead of being discarded.
- New drafts survive late save responses, and failed settings writes are reported for retry.
- Break actions respect phase permissions and deferral limits.
- Interrupted sessions stop cleanly on lock, sleep, and exit.
- Completed forced micro breaks are included in the micro-break count.

## 0.1.0

- Tray and menu bar application with micro, short, and long breaks.
- Configurable schedules, guided breaks, quiet hours, pause, and focus controls.
- Meeting-aware reminders and local daily statistics.
- Global shortcuts and multiple-display support.
- macOS and Windows release builds; Linux source and local build support.
