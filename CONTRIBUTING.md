# Contributing

## Required workflow

1. Read [Architecture](docs/architecture.md) and the existing implementation before adding files.
2. Keep changes focused. Explain any behavior change and update [Product behavior](docs/product.md) when a user-visible rule changes.
3. Run `npm test` and `npm run check` from the repository root.
4. For native window, tray, shortcut, or display changes, run `npm run smoke` and manually verify the affected target platform. Report untested platforms explicitly.
5. Include the problem, resulting behavior, validation, and remaining limitations in the pull request. Use English titles and descriptions.

## Language and content

- Use English for identifiers, comments, developer documentation, test names, diagnostics, logs, and commit or pull request descriptions.
- Chinese is allowed in `README.zh-CN.md` and intentional application interface copy. UI text belongs in the relevant renderer or existing presentation metadata; do not translate UI text as part of unrelated maintenance.
- Explain constraints and non-obvious decisions in comments. Do not retain debugging transcripts, conversational notes, or a history of abandoned implementations in source files.
- Public README files describe installation, capabilities, and material limitations. Internal algorithms, configuration schemas, and test mechanics belong in `docs/` or tests only when needed for maintenance.
- Never commit personal paths, machine-specific diagnoses, raw logs, environment dumps, private notes, or credentials. Store private working notes in ignored `.local/notes/`. Review diagnostic excerpts before sharing them.
- Document implemented behavior. Future ideas must be clearly scoped proposals, not product promises. Avoid unsupported health claims and absolute security claims.

## File placement

| Path | Allowed content | Exclusions |
| --- | --- | --- |
| `src/main/` | Electron integration and application services | DOM code and test fixtures |
| `src/preload/` | Small, explicit IPC bridges | Business rules and broad Electron exposure |
| `src/renderer/<surface>/` | HTML, CSS, and interface scripts for that surface | Node imports and generated previews |
| `tests/unit/` | Pure rules and persistence tests | Electron or desktop requirements |
| `tests/integration/` | Main process integration with controlled system substitutes | Real user data |
| `tests/renderer/` | Renderer behavior tests | Claims about visual correctness from DOM substitutes |
| `scripts/dev/` | Developer generators and setup helpers | Tests and Windows launchers |
| `scripts/windows/` | Windows launch and diagnostic scripts | Public incident reports |
| `scripts/check.mjs` | Repository policy and syntax checks | Application behavior |
| `assets/` | Runtime images | Generated reports and screenshots unrelated to the app |
| `build/` | Packaging input resources | Build output |
| `docs/` | Current product and maintenance documentation | Local incident histories and private research notes |
| `.local/` | Ignored notes, previews, and scratch work | Files required by the app, tests, or CI |

Root files are limited to package metadata, public project documentation, license, repository configuration, contributor instructions, and the three Windows double-click entry points. Put new helpers in their designated directory; do not create a miscellaneous `utils/` folder for unrelated features.

## Code boundaries

- Keep scheduling, configuration, persistence, session control, and window presentation separate. Extend an existing service when it owns the behavior; introduce a module only for a distinct responsibility.
- Keep `tracker.js`, `config.js`, `stats.js`, and `breaks.js` independent of Electron. Inject platform effects into session control.
- Business durations use seconds; phase payloads and timestamps use milliseconds. Derive short-break length from its phases.
- Do not mutate shared defaults, return mutable shared config objects across instances, or persist test state outside isolated test directories.
- Preserve renderer sandboxing, context isolation, CSP, navigation restrictions, and IPC source checks. Expose only fields and operations needed by the receiving page. Validate actions in the main process, not only through button visibility.
- Do not send local paths, logs, runtime versions, or other diagnostics in the regular UI state unless a user-facing feature needs them. Keep diagnostic output local and opt-in where practical.
- Add no runtime dependency, native module, network capability, or build tool without a concrete need and an explanation in the change description.

## Formatting and validation

Use two-space indentation, single quotes in JavaScript, semicolons, UTF-8, and LF for ordinary text. Windows `.cmd`, `.vbs`, and `.ps1` use CRLF; PowerShell files retain a UTF-8 BOM. Batch and VBScript entry points remain ASCII.

`npm run check` verifies file placement, language boundaries, line endings, syntax, local documentation links, generated-file exclusions, and the runtime packaging allowlist. CI runs the same command. These checks supplement code review; they do not verify privacy, medical evidence, or native desktop behavior.

Add meaningful regression coverage for changed behavior. Reuse the current dependency-free test harnesses; do not add assertions that merely duplicate implementation text. Keep test substitutes explicit and report their limits.

Do not edit lockfiles by hand to resolve dependency changes. Use npm and review both manifests. Do not publish a release, push a tag, or alter public access as part of a routine refactor.
