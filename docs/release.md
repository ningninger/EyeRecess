# Release procedure

## Preparation

1. Update the version with `npm version <version> --no-git-tag-version` and review both package manifests.
2. Move the relevant changelog entries into the new version.
3. Run `npm ci`, `npm test`, and `npm run check`.
4. Verify the desktop experience and installation on each release target. Record limitations explicitly.
5. Review the packaged file allowlist. Include runtime code, runtime assets, license, and package metadata only.
6. Verify installation and first launch on a clean target machine without Node.js, npm, or a separate Electron installation. Test the complete distribution, not only the application executable copied out of its bundle.

## Build

| Command | Output |
| --- | --- |
| `npm run dist:mac` | DMG and ZIP for arm64 and x64 |
| `npm run dist:win` | x64 NSIS installer and portable executable |
| `npm run dist:linux` | Local AppImage build |

Use the corresponding operating system and toolchain. Local build commands include `--publish never` and write to ignored `dist/`.

The macOS npm build commands first generate `build/icon.icns` from `build/icon.png` using the built-in `sips` tool and a local ICNS encoder. The generated icon is ignored by Git. This avoids a separate network download of electron-builder's icon conversion toolset. When invoking electron-builder directly, run `npm run icons:mac` first.

For a local Apple Silicon build, an already installed Electron arm64 runtime can be reused:

```sh
npm run dist:mac -- --arm64 --dir -c.electronDist=node_modules/electron/dist
```

Use this override only when the installed runtime version and architecture match the build target. The output is `dist/mac-arm64/EyeRecess.app`; `--dir` skips DMG and ZIP creation. Wait for a successful build exit before copying the app. Other packaging targets or missing tools may still need network access.

## Publish

Publishing requires an explicit release decision. Push a `v<version>` tag matching `package.json` to trigger `.github/workflows/release.yml`. A manual run must select that tag.

The workflow runs automated tests and repository checks, builds macOS and Windows artifacts, and publishes a prerelease with checksums. It requires the tag to match the package version and uses that version's changelog section for release notes, followed by download and upgrade guidance. Linux is not included in automated releases.

Release notes should describe user-visible changes and material compatibility limits. Do not include local paths, debugging transcripts, environment assumptions, internal module names, or unverified health claims. Current builds are unsigned; signing and notarization require separate configuration. Keep credentials in CI secrets, never in repository files.
