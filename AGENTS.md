# Repository instructions

Read `CONTRIBUTING.md` and `docs/architecture.md` before changing this project. Follow their file placement, language, documentation, and process-boundary requirements.

- Use English for all developer-facing content. Preserve Chinese user-facing interface text and `README.zh-CN.md` unless the task requests localization changes.
- Keep generated files and private notes under ignored `.local/`; never place them in `src/` or public documentation.
- Keep tests under `tests/`, developer tools under `scripts/dev/`, and Windows launchers under `scripts/windows/`.
- Do not expose local diagnostics or implementation metadata through the application UI or public README without a product need.
- Run `npm test` and `npm run check` after code or tooling changes. State native desktop validation limits accurately.
- Preserve existing user changes. Do not commit, push, publish, or rewrite Git history unless requested.
