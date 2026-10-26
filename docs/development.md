# Development

Read [Contributing](../CONTRIBUTING.md) before making changes. Run commands from the repository root with Node.js 22.12.0 or later.

Run `npm ci` before the first desktop launch. The install downloads Electron; allow installation scripts and internet access. Source launch commands check for missing or incomplete dependencies before starting the runtime. Release builds include Electron and require no separate Node.js installation.

Runtime setup reuses Electron's own downloader and extractor, including its bundled checksums. It honors an existing HTTP(S) proxy and supports Electron's mirror environment settings. See [Support](support.md#electron-download-failures) for download recovery. Test-only CI sets `ELECTRON_SKIP_BINARY_DOWNLOAD=1`; remove that setting before native validation.

## Commands

| Command | Purpose |
| --- | --- |
| `npm ci` | Install locked dependencies |
| `npm run setup:electron` | Download or repair the installed Electron runtime |
| `npm start` | Start the desktop application |
| `npm run win` | Run the Windows launcher with console output |
| `npm run app` | Run the Windows launcher without a console |
| `npm run demo` | Demonstrate accelerated reminders; displays real overlays |
| `npm run smoke` | Load the actual Electron tray and windows, then exit |
| `npm test` | Run all automated behavior tests without a desktop |
| `npm run test:logic` | Run pure rules and persistence tests |
| `npm run test:boot` | Run main-process integration tests with a virtual clock |
| `npm run test:settings` | Run settings-save behavior tests |
| `npm run check` | Enforce repository rules and check JavaScript syntax |
| `npm run preview` | Generate an offline settings preview in `.local/preview/settings/` |
| `npm run icons` | Regenerate runtime PNG icons |
| `npm run icons:mac` | Generate the macOS packaging icon with local system tools |
| `npm run fetch:electron` | Compatibility alias for the verified runtime setup command |

The preview uses production HTML, CSS, and renderer code with local mock data. Settings and preset changes work in memory and reset on reload; they do not change desktop preferences. Desktop actions are disabled. Open `.local/preview/settings/index.html` in a browser after generation.

## Validation requirements

| Change | Required validation |
| --- | --- |
| Documentation | `npm run check`; verify claims against current behavior |
| Pure rules or persistence | `npm test` and `npm run check`; cover changed behavior |
| IPC or session control | All checks plus main-process integration coverage |
| Renderer behavior | All checks plus relevant renderer tests; inspect the actual page for visual changes |
| Tray, windows, displays, shortcuts, login | All checks plus `npm run smoke` and manual verification on affected platforms |
| Packaging or launch scripts | All checks plus the relevant platform build or launcher; state any unavailable platform |

Automated substitutes do not verify layout, focus, operating system permissions, display coverage, or installer behavior. Report these limits in review notes.

## Working data

Tests use isolated temporary directories or `.boot-test/`. Developer previews and private notes belong under `.local/`. Both are ignored. Do not depend on private local files in code, tests, packaging, or CI.

Use the tray's log-folder action for local troubleshooting. Share only relevant, reviewed excerpts; never attach complete environment dumps or user data by default.

## Native memory checks

Run `node scripts/dev/memory-check.cjs --expect-idle-release` with a desktop and an installed Electron runtime. It starts an isolated source instance, cycles micro/short/long reminders and settings, and samples idle periods. Application settings, test data, and reports stay under a unique ignored `.local/memory-check/` directory. Hidden native windows avoid interrupting other work; this does not validate visible compositor allocation, focus, or multi-display behavior.

The default run uses three rounds of 60 cycles, a 10-cycle warm-up, and 70 idle seconds after each round. Optional `--rounds=`, `--cycles=`, `--idle-seconds=`, and `--label=` arguments control the bounded workload. A 20-minute timeout and 1.5 GiB sampled working-set budget stop excessive runs. Use an idle period above 60 seconds when checking retirement. This tool is opt-in and is not part of normal startup or CI.

Reports contain process working sets, main-process heap before/after diagnostic garbage collection, renderer heap and DOM counters, window counts, timer resources, and listener counts. Garbage collection is enabled only for this development run. Sampling and the report itself allocate memory. Summed working sets can double-count shared pages; they differ from macOS Activity Monitor's memory footprint, and do not include WindowServer's allocations. Inspect the trend after warm-up and repeated idle periods rather than treating a high single sample as a leak. Stable short tests cannot prove the absence of leaks during days of use, graphics-driver changes, or other desktop environments.
