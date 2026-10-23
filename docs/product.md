# Product behavior

This document records the current behavior contract. Numeric defaults live in `src/main/config.js`; detailed schemas and diagnostic transcripts do not belong here.

## Activity and reminders

- Activity is estimated from recent keyboard or pointer input, not actual gaze.
- Short idle periods pause accumulation and reset the micro-break counter. Longer idle periods reset all break counters.
- Sleeping or locking ends the active break and resets work counters. Restarting preserves settings and daily summaries, but starts new work counters.
- When multiple reminders are due, long breaks take priority over short breaks, followed by micro breaks.
- Completing a break resets counters for that level and shorter levels.

## Breaks

Micro reminders normally use an unobtrusive edge glow. At a configurable frequency they become a short eye-closure overlay. Short breaks combine eye closure, blinking, and movement. Long breaks begin with eye closure and continue with time away from the screen.

The default schedule is a micro reminder after 10 active minutes, a short break after 50 active minutes, and a long break after two active hours. Presets and individual timings are configurable. The classic and gentle presets still include short and long breaks.

## Personalization

The settings page starts with presets and three reminder cards. Each reminder can be enabled independently. Disabled reminders stop automatic scheduling; manual breaks remain available. Advanced timing and content controls, system preferences, and statistics are collapsed by default.

Users can omit individual short-break steps by setting their duration to zero, while keeping at least one step. A zero-length initial eye-closure phase starts a long break directly with time away. Long breaks reserve at least one minute for time away.

Optional plain-text hints replace micro-reminder guidance, the short-break movement hint, or the long-break time-away hint. Empty hints retain the built-in copy. Hints are limited to 120 characters and stored locally with settings. They do not change the blink cadence, phase names, or permissions.

Changes save after an edit is committed (leaving a field or changing a switch). The page reports invalid drafts and failed writes, retains newer edits while saving, and offers a retry. Restoring the recommended plan resets all three reminder schedules and their hints; quiet hours, presentation, system preferences, and statistics are preserved. Selecting another preset changes its schedule values and enables reminders while retaining custom hints and other advanced choices.

Short and long eye-closure phases permit one deferral. Eye closure cannot be ended early; later phases can end the session. The main process validates phase permissions and session identity.

## Quiet modes

Pause, focus, and quiet hours suppress automatic reminders while activity still accumulates. Returning to normal mode leaves a grace period instead of replaying overdue reminders.

When meeting software is detected, automatic reminders use a glow rather than an overlay. This detection is approximate. Users can still start a break manually.

## Data and limits

Settings and daily aggregate statistics stay local. The application does not record keystroke content, window titles, or screenshots. Application pages are restricted to local resources; external links may open in the system browser.

Settings follow system light/dark appearance and reduced-motion preferences. Login integration is available only in packaged macOS and Windows builds. Clicking the macOS Dock icon opens settings. Changing displays preserves an ongoing phase; dismissing the interactive overlay cancels that session across all displays. Cancellation records no completion.

Clearing today's statistics requires a second click within five seconds. A failed reset preserves existing statistics and reports that the operation did not complete.

Full-screen detection, actual meeting-state detection, automatic updates, data export, and restoring in-progress work counters after restart are not implemented. Native window and tray behavior depends on the desktop environment.

See [Compatibility](compatibility.md) for target-specific limits and [Security](security.md) for permission and storage boundaries.
