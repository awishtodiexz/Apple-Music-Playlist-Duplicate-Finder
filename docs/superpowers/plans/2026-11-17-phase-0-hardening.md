# Phase 0 — Verification and Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four Phase 0 gaps — DOM contract drift, primary-action styling, MusicKit envelope drift, and source coverage — with automated gates that fail before a bad build ships.

**Architecture:** Four independent changes, each owning disjoint files. Wave 1 runs the DOM gate and MusicKit fixtures in parallel. Wave 2 runs the button fix and coverage gate in parallel. The orchestrator verifies each wave, one independent reviewer checks the combined diff, and a full `npm run check` closes the phase.

**Tech Stack:** TypeScript, esbuild, Node 22.8+/24/26, Playwright Chromium, c8 10.1.3.

**Spec:** Phase 0 of the verified assessment in this thread. Exact requirements are restated in Global Constraints; later roadmap phases need separate plans.

## Global Constraints

- Work on `main` in `C:\Users\yoedy\Downloads\github projects\Apple-Music-duplicate-finder`. Never create branches, worktrees, commits, pushes or pull requests.
- Never run `git stash`, `git reset` or `git clean`. Leave changes uncommitted.
- Node 22.8+, 24 or 26; Chrome/Edge 111+.
- No new runtime dependencies. The only dependency change allowed is devDependency `c8@10.1.3`, installed exactly in Wave 0.
- No new network calls, telemetry, permissions or CSP changes.
- User-facing copy stays English and keeps the existing plain tone.
- No `any`, no broad refactors, no comments unless they explain a non-obvious constraint.
- Each worker owns only its listed files. It never edits another worker's files or the plan.
- Each worker runs only its task's verification commands. The orchestrator runs the full gate.
- Workers never dispatch subagents, commit, push, branch, stash or clean.
- Model gate before every dispatch: provider `opencode`, model `opencode-go/hy4-flash-free`, option `variant=high`. If unavailable or different, stop and report; never substitute.
- Orchestrator gate: current thread must be `opencode-go/deepseek-v4.1-flash` with `variant=max`.
- Primary action after a scan: `#scan` enabled, class `secondary`, background `rgb(199, 40, 78)`, text `rgb(255, 255, 255)`, in light and dark, with `var(--action-hover)` on hover.
- DOM contract: every id referenced in `src/popup.ts` exists exactly once in `dist/popup.html` and appears as a quoted literal in `dist/popup.js`.
- Fixtures are sanitized; no tokens, cookies or emails. `auth-401.json` maps to `AUTH`; `rate-limit-429.json` maps to `RATE_LIMIT` with `retryAfterMs: 2000`.
- Coverage gate: every pure source file (`src/*.ts` except `popup.ts`) must have a coverage record and at least 90% lines; the suite must be at least 85% branches. Expected baseline: ~98.5% lines, ~89% branches.

## Review Focus

1. A stale build pairing new popup HTML with old popup JS must fail before packaging, not at runtime with `Missing popup element`.
2. The primary action must stay visually primary after results, in both themes and on hover, without changing other secondary buttons.
3. A renamed or malformed MusicKit envelope must fail closed with a safe code and never return partial results.
4. Coverage must measure `src/`, not be diluted by test files, and must not depend on the last test process.
5. The new gates must not slow or destabilize the existing 189-test suite or the browser/extension suites.

## Execution Model

| Wave | Workers | Tasks | Why safe together |
|---|---|---|---|
| 0 | Orchestrator | Setup, baseline, c8 install | No concurrent writes |
| 1 | 2 parallel | Task 1 (DOM gate) + Task 3 (fixtures) | Task 1 writes `dist/`; Task 3 writes only `tests/`, `docs/` and `.cache/task3`. Task 3 must not run `security-test` (it reads `dist/`). |
| 2 | 2 parallel | Task 2 (button) + Task 4 (coverage) | Task 2 writes `dist/`; Task 4 writes only `package.json`, `package-lock.json`, `scripts/coverage.mjs`, `.cache/tests`, `.cache/covrun`, `.cache/c8`. No shared paths. |
| Final | 1 reviewer + orchestrator | Combined review and full gate | No concurrent implementation writes |

Task numbering is fixed: **Task 1** DOM gate, **Task 2** button, **Task 3** fixtures, **Task 4** coverage. Wave order is 1+3, then 2+4.

## Task 1: Element-ID Contract Gate

**Files:**
- Modify: `scripts/validate-build.mjs`
- Owned by Worker 1 only.

**Interfaces:**
- Consumes: `dist/popup.html`, `dist/popup.js`, `src/popup.ts`.
- Produces: extra assertions inside `validateBuild()`; no exported API change.

**Acceptance criteria:**
- [ ] Every id passed to `element('id')`, `element<HTML...>('id')` or `document.getElementById('id')` in `src/popup.ts` (currently 45 unique references) must have exactly one `id="<id>"` in `dist/popup.html`.
- [ ] Every such id must appear as a quoted literal in `dist/popup.js`.
- [ ] Duplicate ids in `dist/popup.html` fail the build.
- [ ] Failure messages name the id and the missing side, for example `popup contract: "scan" is referenced by src/popup.ts but missing from dist/popup.html`.
- [ ] All existing checks remain untouched.

**Steps:**
- [ ] **Step 1: Add the contract check.** In `validateBuild()`, after the existing HTML and JS reads, extract ids from `src/popup.ts` with a quote-agnostic regex for `element(...)` and `getElementById(...)`. For each id, assert one HTML id and one JS literal. Assert HTML ids are unique.
- [ ] **Step 2: Verify the clean build.** Run `npm run build` then `node scripts/validate-build.mjs`. Expected: PASS.
- [ ] **Step 3: Reproduce the 1.6.2 failure.** Run `Copy-Item public/popup.html dist/popup.html -Force`, replace `id="scan"` with `id="scan-broken"` in `dist/popup.html`, then run `node scripts/validate-build.mjs`. Expected: FAIL and the message names `scan`.
- [ ] **Step 4: Restore and re-verify.** Run `Copy-Item public/popup.html dist/popup.html -Force`, then `node scripts/validate-build.mjs`. Expected: PASS.
- [ ] **Step 5: Typecheck.** Run `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Report evidence** to `C:\Users\yoedy\AppData\Local\Temp\opencode\sdd-phase0\task-1-report.md`.

## Task 2: Primary Button Accent

**Files:**
- Modify: `public/popup.css`
- Modify: `scripts/browser-test.mjs`
- Owned by Worker 2 only. Do not edit `src/popup.ts` unless CSS alone cannot work; if so, report why.

**Interfaces:**
- Consumes: existing `#scan`, `secondary` class added by `src/popup.ts:160`, `--action` and `--action-hover` variables.
- Produces: scoped CSS overrides and one Playwright assertion after the first successful scan.

**Acceptance criteria:**
- [ ] After the first successful scan, `#scan` is enabled, has class `secondary`, background `rgb(199, 40, 78)` and color `rgb(255, 255, 255)`.
- [ ] The same holds after `document.documentElement.dataset.theme = 'dark'`.
- [ ] Hover uses `var(--action-hover)`; disabled state still looks disabled.
- [ ] No other `.secondary` button changes appearance.
- [ ] The existing accessibility audit passes.

**Steps:**
- [ ] **Step 1: Write the failing assertion.** Immediately after `assert.equal(await popup.locator('#scan').textContent(), 'Scan again');` in `scripts/browser-test.mjs` (currently line 201), read `getComputedStyle` for background and color and assert the values above. Set the dark theme, re-read, then reset to `light`.
- [ ] **Step 2: Run it and see it fail.** Run `npm run build` then `node scripts/browser-test.mjs`. Expected: FAIL on the background assertion with `rgb(255, 255, 255)`.
- [ ] **Step 3: Add the smallest scoped CSS overrides.** In `public/popup.css`, target `#scan.secondary` (including `:hover:enabled`) so only the primary action regains the accent.
- [ ] **Step 4: Run it and see it pass.** Run `npm run build` then `node scripts/browser-test.mjs`. Expected: PASS.
- [ ] **Step 5: Prove the assertion catches the regression.** Temporarily disable the new CSS override, rerun the browser test. Expected: FAIL. Restore the override, rerun. Expected: PASS.
- [ ] **Step 6: Report evidence** to `task-2-report.md`.

## Task 3: MusicKit Contract Fixtures

**Files:**
- Create: `tests/fixtures/musickit/v3-metadata.json`
- Create: `tests/fixtures/musickit/v3-tracks.json`
- Create: `tests/fixtures/musickit/legacy-tracks.json`
- Create: `tests/fixtures/musickit/nested-tracks.json`
- Create: `tests/fixtures/musickit/auth-401.json`
- Create: `tests/fixtures/musickit/rate-limit-429.json`
- Create: `tests/fixtures/musickit/malformed-envelope.json`
- Create: `tests/musickit-fixtures.test.ts`
- Modify: `docs/DEVELOPMENT.md` (one short subsection)
- Owned by Worker 3 only. Do not modify existing tests or `src/`.

**Interfaces:**
- Consumes: `musicKitBridge` and `cancelMusicKitRead` from `src/musickit-bridge.ts`; the `setup(get, instanceExtra)` harness at `tests/musickit-bridge.test.ts:10`; the serialized-VM pattern at `tests/bridge-isolation.test.ts:14`.
- Produces: seven JSON fixtures and one test file.

**Acceptance criteria:**
- [ ] `v3-metadata.json`: `{ "data": [{ "id": "p.fixture", "type": "library-playlists", "attributes": { "name": "Fixture playlist", "trackCount": 3, "lastModifiedDate": "2026-01-01T00:00:00Z" } }], "response": { "status": 200 } }`.
- [ ] `v3-tracks.json`: three `library-songs` with `attributes.name`, `attributes.artistName`, `attributes.playParams.catalogId`; `meta.total` 3; `next` offset 3; `response.status` 200.
- [ ] `legacy-tracks.json`: `{ "json": { "data": [three songs], "meta": { "total": 3 } } }`.
- [ ] `nested-tracks.json`: `{ "data": { "data": [three songs], "meta": { "total": 3 } } }`.
- [ ] `auth-401.json`: `{ "data": { "status": 401 } }` → `AUTH`.
- [ ] `rate-limit-429.json`: `{ "response": { "status": 429, "headers": { "retry-after": "2" } }, "data": { "data": [] } }` → `RATE_LIMIT` with `retryAfterMs: 2000`.
- [ ] `malformed-envelope.json`: `{ "data": { "items": [] } }` → `FORMAT`.
- [ ] The test asserts metadata `{ name: 'Fixture playlist', total: 3, modified: '2026-01-01T00:00:00Z' }`, ordered positions for all three track envelopes, the malformed envelope failing with `FORMAT`, and no token-like keys in any fixture.
- [ ] `docs/DEVELOPMENT.md` explains the fixtures are sanitized shape captures, how to replace them, and that credentials never belong in them.

**Steps:**
- [ ] **Step 1: Write the failing test first.** Add `tests/musickit-fixtures.test.ts` reading files with `readFileSync('tests/fixtures/musickit/<name>.json', 'utf8')` (cwd is repo root), using the `setup` harness and a path-dependent mock. Run `npx esbuild tests/musickit-fixtures.test.ts --bundle --platform=node --format=esm --target=node22 --outfile=.cache/task3/musickit-fixtures.test.js --sourcemap=inline` then `node --test .cache/task3/musickit-fixtures.test.js`. Expected: FAIL with ENOENT.
- [ ] **Step 2: Create the seven fixtures** with the exact shapes above.
- [ ] **Step 3: Rerun the test.** Expected: PASS for metadata, v3, legacy, nested, auth, rate limit and malformed.
- [ ] **Step 4: Typecheck.** Run `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Document the fixtures** in `docs/DEVELOPMENT.md`.
- [ ] **Step 6: Report evidence** to `task-3-report.md`. Do not run `node scripts/security-test.mjs`; the orchestrator runs it after Wave 1 because it reads `dist/`.

## Task 4: Coverage Gate

**Files:**
- Create: `scripts/coverage.mjs`
- Modify: `package.json` (add the `coverage` script)
- Modify: `package-lock.json` only if Wave 0 did not already update it
- Owned by Worker 4 only. Do not modify `src/`, `tests/`, `public/` or other scripts.

**Interfaces:**
- Consumes: `c8@10.1.3` pre-installed by Wave 0; `tests/*.test.ts`; the esbuild build pattern in `scripts/test.mjs`.
- Produces: `npm run coverage`, a deterministic src-only gate.

**Acceptance criteria:**
- [ ] `npm run coverage` builds every test, runs each test bundle in its own process, merges per-run lcov, and prints `src` line and branch percentages.
- [ ] Exit 0 when overall lines >= 90, overall branches >= 85, and every pure source file has a coverage record and >= 90% lines; exit 1 otherwise, when a pure module has no record, or when any test fails.
- [ ] Baseline on this machine: ~98.5% lines, ~89% branches.
- [ ] Removing four major test files (`musickit-bridge`, `playlist-reader`, `browser-source`, `storage`) drops branches below 85% and exits 1 (observed 67.42%); restoring exits 0. A single tree-shaken probe is not a valid proof: esbuild removes it, and a 90/85 floor is not a per-branch detector.
- [ ] `npm test` still reports 189 passing tests.

**Steps:**
- [ ] **Step 1: Write `scripts/coverage.mjs`.** Remove `.cache/tests`, `.cache/covrun`, `.cache/c8`, `coverage`. Bundle `tests/*.test.ts` to `.cache/tests` with the same options as `scripts/test.mjs`. Copy bundles to `.cache/covrun/` so c8 does not default-exclude a `tests/` path. For each bundle run `node node_modules/c8/bin/c8.js --clean=false --temp-directory .cache/c8/<name> --reports-dir .cache/lcov/<name> --reporter=lcov node <bundle>`. Merge lcov `DA` and `BRDA` records across runs, keeping only `^src[\\/]` paths; a line or branch is covered if any run covers it. Print the table and apply the thresholds.
- [ ] **Step 2: Add the script.** Add `"coverage": "node scripts/coverage.mjs"` to `package.json`.
- [ ] **Step 3: Run the gate.** Run `npm run coverage`. Expected: exit 0 with overall lines >= 90, overall branches >= 85, and every pure file present at >= 90% lines.
- [ ] **Step 4: Prove it fails on a real coverage loss.** Rename `tests/musickit-bridge.test.ts`, `tests/playlist-reader.test.ts`, `tests/browser-source.test.ts` and `tests/storage.test.ts` to `.bak`, run `npm run coverage`, expect exit 1 (observed 67.42% branches). Restore them in a `finally`, rerun `npm run coverage`, expect exit 0.
- [ ] **Step 5: Confirm the suite.** Run `npm test`. Expected: 189 passing.
- [ ] **Step 6: Confirm ownership.** Run `git status --short`. Expected: only `package.json`, `package-lock.json` and `scripts/coverage.mjs`.
- [ ] **Step 7: Report evidence** to `task-4-report.md`.

## Wave 0 Setup (Orchestrator, after approval)

- [ ] Verify the working tree is clean with `git status --short`.
- [ ] Record `git rev-parse HEAD` in the ledger.
- [ ] Verify the orchestrator with `orchestrator_capabilities()`: `inheritedModel` is `opencode-go/deepseek-v4.1-flash` and `inheritedOptions` contains `{ id: 'variant', value: 'max' }`.
- [ ] Install the only allowed dependency: `npm install --save-dev --save-exact c8@10.1.3`. Confirm `npm ls c8 --depth=0` reports `10.1.3`.
- [ ] Run the baseline `npm run build` and `npm test`. Expected: build PASS, 182 passing. Record the duration.

## Dispatch Protocol (every worker, every wave)

- [ ] Call `orchestrator_capabilities({ search: 'hy4' })`.
- [ ] Assert provider `opencode`, model `opencode-go/hy4-flash-free`, and `variant` options include `high`. If any differ or the model is absent, stop and report. Do not substitute.
- [ ] Dispatch with `delegate_task({ task, target: { providerInstanceId: 'opencode', model: 'opencode-go/hy4-flash-free', options: { variant: 'high' } }, role: 'implementation', isolation: 'shared', mode: 'async' })`.
- [ ] Record `taskId`, owned files and the brief path in the ledger.
- [ ] Do not poll. Wait for the completion wake, then inspect the report.

## Review and Verification Protocol

- [ ] After Wave 1: `git status --short`; inspect the diff for Task 1 and Task 3 only; run `node scripts/validate-build.mjs`, `node --test .cache/task3/musickit-fixtures.test.js`, `npm run typecheck`, and `node scripts/security-test.mjs` (now safe because the build is idle).
- [ ] After Wave 2: inspect the diff for Task 2 and Task 4 only; run `node scripts/browser-test.mjs`, `npm run coverage`, `npm test`, and `npm run typecheck`.
- [ ] After Wave 2: dispatch one independent reviewer (`role: 'review'`, same verified Hy4 model) with the full diff, the four briefs and the four reports. Require spec-compliance and code-quality verdicts. Fix small findings directly; re-dispatch only for a scoped re-review.
- [ ] Final gate: `npm run check` (includes build, unit, browser, extension, package and security), `npm run coverage`, `npm run benchmark`, `git status --short`.
- [ ] Benchmark bar at 50k tracks: no more than 10% regression on read/match/CSV medians versus baseline `4.38 ms / 6.99 ms / 13.8 ms`; no more than 20% on any one metric.
- [ ] Report the final file list and verification evidence. Do not commit.

## Failure Handling

- If a worker edits outside its ownership, stop it, inspect the diff, and restore only those files by writing the original content from `git show HEAD:<path>`. Never `git reset`, `git stash` or `git clean`.
- If a wave gate fails, give the responsible worker one scoped fix round. If it still fails, the orchestrator fixes or reports the block.
- If a browser or coverage run times out under Wave 2 CPU contention, rerun that command alone before treating it as a failure.
- If `opencode-go/hy4-flash-free` is unavailable or its `variant=high` option is gone, stop and report. Do not silently substitute.

## Approval Gate

Implementation starts only after the human partner approves this plan. On approval, execute Wave 0, then Wave 1, then Wave 2, then the final gate, without pausing between tasks except for the four stop conditions: an irreversible action, a security-sensitive action, a side effect outside the repo, or a plan that is broken at every path.
