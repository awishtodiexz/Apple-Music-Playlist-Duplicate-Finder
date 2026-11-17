# Project agent instructions

Apple Music Playlist Duplicate Finder is a read-only Manifest V3 Chrome/Edge extension. It reads the current Apple Music playlist through the page's MusicKit instance and lists exact duplicate songs. TypeScript, plain HTML/CSS, esbuild, Playwright.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Typecheck and build `dist/` |
| `npm test` | Unit tests |
| `npm run test:browser` | Popup in Chromium against a mocked Apple Music page |
| `npm run test:extension` | Installs the real built extension in a fresh profile |
| `npm run test:package` | Builds and verifies the release ZIP |
| `npm run check:security` | Permissions, CSP, source/network invariants and credential scan |
| `npm run check:docs` | Version consistency |
| `npm run coverage` | Source-only line and branch gate (at least 90% lines, 85% branches) |
| `npm run benchmark` | CPU and pagination timings at 1k, 10k and 50k tracks |
| `npm run check` | Full gate except coverage and benchmark |

## Invariants

- Read-only: never add code or UI that edits, reorders or deletes Apple Music data.
- Keep the manifest to `activeTab` and `scripting`; no host permissions, telemetry, servers or remote assets. The CSP in `public/manifest.json` is part of the contract.
- Treat page-world and cross-context replies as untrusted. Validate every field before use.
- Match by Apple Music ID, never by title. Entries without a usable ID are skipped and counted.
- Never show partial results after a failed or cancelled scan.
- Keep the popup element ids in `src/popup.ts` and `public/popup.html` in sync; `npm run build` fails on drift.
- The `#scan` primary action keeps its accent after a scan; the browser suite enforces it.
- MusicKit fixtures in `tests/fixtures/musickit/` are sanitized. Never add tokens, cookies or emails.
- Keep every pure source file at or above 90% lines and the suite at or above 85% branches.

## Workflow

- Work on `main`. Do not commit, push, branch, stash, reset or clean unless the user asks.
- Run `npm run check` before calling work complete. Run `npm run coverage` when touching `src/`.
- Read `docs/ARCHITECTURE.md` and `docs/DEVELOPMENT.md` before changing the bridge, reader or storage.
