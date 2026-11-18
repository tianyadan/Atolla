# Atolla Electron for macOS (Apple Silicon)

## Prerequisites

- Apple Silicon Mac (`arm64`)
- Node.js 20 or later
- Go 1.26 or later
- Existing Atolla runtime prerequisites, including at least one local engine command (`claude`, `codex` or `agent`)

## Development

Install dependencies once:

```bash
cd web && npm install
cd ../desktop && npm install
```

Start Vite in one terminal, then start Electron in another. The development Electron runtime starts the Go backend at `127.0.0.1:8080` so Vite's existing `/api` proxy remains valid.

```bash
cd web && npm run dev
cd ../desktop && npm run dev
```

## Package an arm64 DMG

```bash
cd desktop
npm run package
```

The result is written to `dist/electron/`. The command builds the React assets, compiles the Go backend with `GOOS=darwin GOARCH=arm64`, stages both resources, verifies the staged executable, and creates a DMG.

## Package with GitHub Actions

`.github/workflows/desktop-macos.yml` builds the same arm64 DMG on a GitHub-hosted macOS runner:

- Manual run: Actions → **Desktop macOS DMG** → **Run workflow**; the DMG is attached to the run as the `atolla-mac-arm64-dmg` artifact (kept 14 days).
- Tag run: push a tag such as `v0.6.7` (`git tag v0.6.7 && git push origin v0.6.7`); the DMG is also attached to a **draft** GitHub Release for review.

Notes:

- The artifact version comes from `desktop/package.json`, so bump that version before tagging.
- The build is unsigned (`identity: null`, `CSC_IDENTITY_AUTO_DISCOVERY=false`). Users downloading the DMG from a browser must right-click → Open or clear the quarantine attribute. Signing and notarization need Apple Developer certificates stored as repository secrets.
- macOS runners consume private-repository Actions minutes at a 10x multiplier; a full package run is usually 5–10 minutes.

## Runtime files and troubleshooting

- Database: `~/Library/Application Support/Atolla/data/atolla.db`
- Backend log: `~/Library/Application Support/Atolla/logs/backend.log`
- Desktop configuration directory: `~/Library/Application Support/Atolla/config/`

If startup fails, inspect `backend.log`, ensure a supported local engine is available in the launch environment, and verify the packaged app contains `Contents/Resources/bin/atolla-server` and `Contents/Resources/web/index.html`.

## Distribution limitation

The first release is unsigned and not notarized. It is suitable for local testing only; distributing it to other Macs requires a separate Apple Developer ID signing and notarization release process.
