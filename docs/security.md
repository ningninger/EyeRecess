# Security boundaries

EyeRecess is a local Electron application. It runs with the current user's operating system privileges; it is not distributed as a macOS App Sandbox application. Renderer sandboxing and macOS hardened-runtime entitlements are different controls.

## Runtime restrictions

- Settings and overlays use sandboxed renderers with context isolation and no Node integration. Preloads expose specific operations only.
- Main-process IPC checks the registered renderer surface, exact application page, and main-frame identity. An overlay cannot change preferences, reset statistics, open links, or quit through settings IPC.
- Permission request, permission check, and device permission handlers deny browser permissions. The application does not request camera, microphone, screen recording, or accessibility access for its current features.
- Renderer requests are limited to renderer files and application assets. Navigation, child navigation, redirects, webviews, and new windows are blocked. CSP disallows network connections and inline scripts.
- External links are restricted to HTTP(S) URLs without credentials or control characters and open in the system browser after an explicit settings action.
- Configuration uses a bounded known schema. Unknown fields, invalid switches, invalid enum values, and malformed quiet-hour times are discarded or normalized. Pause and focus requests have finite duration limits.
- Saved statistics accept known nonnegative numeric fields only. Renderer statistics and custom hints use text nodes, not HTML interpolation.

The main process still has filesystem and process access, which it needs for local storage and optional meeting-process detection. Renderer network restrictions do not constitute an operating-system firewall for Node.js. A malicious modification to the app bundle, its source, or its development dependencies is outside these renderer boundaries.

## Packaging and dependencies

Release packaging disables Electron's Node execution mode, Node environment options, and CLI inspector flags, and loads application code from ASAR only. ASAR is packaging, not encryption or a substitute for publisher signing. Unsigned or ad-hoc-signed local builds do not provide verified publisher identity. Official signing and notarization still require a release owner and credentials.

The macOS entitlement input retains V8 JIT and removes unsigned executable memory and library validation exceptions. No native application modules require those broader exceptions. Validate Developer ID signing, nested helpers, and launch on a clean target machine before publishing; local ad-hoc builds and source launches do not prove hardened-runtime compatibility.

Runtime setup uses Electron's downloader and package-bundled checksums. Third-party mirrors are opt-in. The legacy fetch command delegates to the same verified installer; there is no separate unchecked archive downloader. macOS icon generation uses local image tools and does not download a converter.

Run `npm audit` when registry access is available. Passing local tests does not establish that dependencies have no published vulnerabilities. Review the lockfile and build toolchain as well as application runtime code.

## Storage and failure behavior

Preferences and statistics use a temporary file and rename so an interrupted replacement preserves the previous file. New files request owner-only permissions on POSIX systems; Windows uses the current user's directory ACLs. Settings roll back in memory if persistence fails; statistics remain dirty for a later retry. Data and logs are local, unencrypted, and readable by someone with access to the account.

Only process names are examined for meeting reduction, at most once per 15 seconds while enabled. This does not determine whether a call is active. Process output is not included in normal UI state. Logs may include paths and error details: review excerpts before sharing them. See [Support](support.md).

## Required verification

`npm test` covers IPC boundaries, permissions, configuration, local resources, failed writes, and overlay lifecycle races with controlled substitutes. `npm run check` verifies repository rules. Native focus, display coverage, login behavior, global shortcuts, publisher signing, and operating-system prompts require target-platform testing. Never label a release secure solely because these automated checks pass.
