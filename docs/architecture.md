# Architecture

EyeRecess uses Electron and plain HTML, CSS, and JavaScript. There is no renderer bundler or runtime application dependency.

## Ownership

| Module | Responsibility |
| --- | --- |
| `src/main/main.js` | Application lifecycle, platform events, scheduling, tray, settings window, and IPC routing |
| `src/main/tracker.js` | Active-time counters, idle handling, and reminder priority |
| `src/main/breaks.js` | Break plans, phase transitions, deferral limits, completion, and cancellation |
| `src/main/config.js` | Defaults, presets, normalization, and configuration persistence |
| `src/main/stats.js` | Daily aggregation and bounded local persistence |
| `src/main/dnd.js` | Quiet hours, manual focus, and meeting-process detection |
| `src/main/overlay.js` | Glow and break window presentation |
| `src/main/security.js` | Renderer restrictions and trusted IPC checks |
| `src/main/icons.js` | Platform-specific runtime images |
| `src/main/log.js` | Local startup and error logging |
| `src/preload/` | Explicit renderer-to-main bridges |
| `src/renderer/settings/` | Settings, current status, and daily summaries |
| `src/renderer/overlay/` | Glow and guided-break presentation |

## Control flow

The main process samples activity and passes it to the tracker. Due reminders are presented as a glow, reduced during meetings, or passed to the break controller. The controller owns session decisions; the overlay owns windows. Completion updates counters and statistics. Cancellation hides the session and clears pending waits without recording completion.

Settings changes cross an explicit preload bridge. The main process validates the sender, applies configuration, and returns the state required by the interface. Periodic state messages update status and statistics without exposing diagnostic metadata.

IPC privileges are scoped to either settings or overlays and require the registered main frame and exact local entry page. Display changes rebuild the current overlay presentation while preserving the phase deadline; session rules remain in the controller. Hiding overlays also stops renderer animation work.

## Dependency rules

- Pure application services do not import Electron or renderer code.
- The main process composes services and injects platform effects.
- Preload files contain bridges only; renderers do not access Node or Electron directly.
- A renderer may use assets for its surface, but must not import another surface's implementation.
- Tests may import production modules; production code must never import tests or developer scripts.
- `assets/` and `build/` are inputs. `dist/`, `.boot-test/`, and `.local/` are disposable outputs.

See [Contributing](../CONTRIBUTING.md) for the directory map, language rules, and required checks. Keep implementation detail near the owning code instead of expanding public project documentation.
