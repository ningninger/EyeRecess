# Changelog

Version numbers follow [Semantic Versioning](https://semver.org/). Unreleased entries describe source changes, not an available download.

## Unreleased

### Changed

- Simplified settings with independent reminder switches, expandable content controls, custom hints, and a recommended-plan reset.
- Added source-launch dependency checks and clarified bundled runtime requirements for release builds.
- Clarified break schedules, settings labels, and product limitations.
- Standardized contributor documentation, file ownership, and automated repository checks.

### Fixed

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
