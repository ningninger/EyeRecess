# Product behavior

This document records the current behavior contract. Numeric defaults live in `src/main/config.js`; detailed schemas and diagnostic transcripts do not belong here.

## Activity and reminders

- Activity is estimated from recent keyboard or pointer input, not actual gaze.
- Short idle periods pause accumulation and reset the micro-break counter. Longer idle periods reset all break counters.
- By default, 60 seconds without input pauses accumulation and 180 seconds resets reminder counters. Reading and video playback can therefore pause the estimate. Users can enable reading mode under advanced system settings; this keeps time and reminders advancing without input, and counts time away from an unlocked computer. Breaks, lock, and sleep still stop activity accumulation. Reading mode is off by default and persists across restarts and preset changes. The status area explains the current counting rule and idle pauses. This is an estimate, not a screen-time or gaze measurement.
- Delayed awake samples retain their elapsed duration. Changing the system calendar does not change elapsed activity. Summaries refresh approximately every five seconds; statistics are saved in batches and flushed on lock, suspend, and normal quit. Abrupt termination can still lose the most recent unsaved batch. Calendar dates follow the system date.
- Sleeping or locking ends the active break and resets work counters. Restarting preserves settings and daily summaries, but starts new work counters.
- When multiple reminders are due, long breaks take priority over short breaks, followed by micro breaks.
- Completing a break resets counters for that level and shorter levels.

## Breaks

Micro reminders normally use an unobtrusive edge glow. At a configurable frequency they become a short eye-closure overlay. Short breaks combine eye closure, blinking, and movement. Long breaks begin with eye closure and continue with time away from the screen.

The default schedule is a micro reminder after 10 active minutes, a short break after 50 active minutes, and a long break after two active hours. Presets and individual timings are configurable. The classic and gentle presets still include short and long breaks.

All presets use 20-second micro reminders. Standard and classic short breaks last two minutes (40 seconds of eye closure, 20 seconds of blinking, 60 seconds of movement). Dense short breaks last three minutes (60/20/100 seconds); gentle short breaks last 90 seconds (20/20/50 seconds). Long-break intervals and durations are unchanged. On loading version 1 settings, unchanged shipped micro and short timings in named presets upgrade automatically; custom timings, hints, and other preferences remain intact.

## Personalization

The settings page starts with presets and three reminder cards. Each reminder can be enabled independently. Disabled reminders stop automatic scheduling; manual breaks remain available. Advanced timing and content controls, system preferences, and statistics are collapsed by default.

Section navigation opens the relevant collapsed group. A fixed save-status bar stays visible while scrolling. The header shows the next enabled reminder, using the scheduler's priority when times tie, and replaces its countdown during breaks and silent modes. Pause suppresses reminders while activity continues; manual focus can be ended from settings or the tray. Closing settings keeps the app running, while the exit action quits the application. Clean settings follow tray changes; unsaved drafts remain intact during state updates.

Blink guidance alternates gentle eye closure, relaxation, and opening without instructing users to squeeze their eyes. Preset labels describe reminder frequency rather than claiming a medical benefit.

Users can omit individual short-break steps by setting their duration to zero, while keeping at least one step. A zero-length initial eye-closure phase starts a long break directly with time away. Long breaks reserve at least one minute for time away.

Optional plain-text hints replace micro-reminder guidance, the short-break movement hint, or the long-break time-away hint. Empty hints retain the built-in copy. Hints are limited to 120 characters and stored locally with settings. They do not change the blink cadence, phase names, or permissions.

Changes save after an edit is committed (leaving a field or changing a switch). The page reports invalid drafts and failed writes, retains newer edits while saving, and offers a retry. Restoring the recommended plan resets all three reminder schedules and their hints; quiet hours, presentation, system preferences, and statistics are preserved. Selecting another preset changes its schedule values and enables reminders while retaining custom hints and other advanced choices.

Every guided phase, including micro, short, and long eye closure, provides a fixed top-right exit button, a second exit button below the guidance, and Escape to cancel. Every covered display shows the controls. The tray also offers dismissal, and edge glows have a close button that accepts clicks without taking keyboard focus; the rest of the glow stays transparent to pointer input. Short and long eye-closure phases still permit one optional deferral. Escape always exits and does not use that deferral allowance.

An explicit exit records a skip rather than a completed break, stops all phase timers, and hides every overlay. The skipped reminder is postponed by up to five active minutes (or its interval if shorter), and other overdue reminders receive the existing three-minute recovery grace. Late or repeated actions cannot affect a different session. The main process validates session identity and deferral eligibility.

## Quiet modes

Pause, focus, and quiet hours suppress automatic reminders while activity still accumulates. Returning to normal mode leaves a grace period instead of replaying overdue reminders.

When meeting software is detected, automatic reminders use a glow rather than an overlay. This detection is approximate. Users can still start a break manually.

## Data and limits

Settings and daily aggregate statistics stay local. The application does not record keystroke content, window titles, or screenshots. Application pages are restricted to local resources; external links may open in the system browser.

Settings follow system light/dark appearance and reduced-motion preferences. Login integration is available only in packaged macOS and Windows builds. Clicking the macOS Dock icon opens settings. Changing displays preserves an ongoing phase; dismissing the interactive overlay cancels that session across all displays. Cancellation records no completion.

Clearing today's statistics requires a second click within five seconds. A failed reset preserves existing statistics and reports that the operation did not complete.

Full-screen detection, actual meeting-state detection, automatic updates, data export, and restoring in-progress work counters after restart are not implemented. Native window and tray behavior depends on the desktop environment.

See [Compatibility](compatibility.md) for target-specific limits and [Security](security.md) for permission and storage boundaries.
