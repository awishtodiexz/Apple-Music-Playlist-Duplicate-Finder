# Changelog

## [Unreleased]

## [1.7](https://github.com/awishtodiexz/Apple-Music-Playlist-Duplicate-Finder/releases/tag/v1.7) (2026-11-25)

### Added

- The scan window's title shows live progress while scanning ("Scanning playlist · 42%") and the outcome when finished, so a background scan is readable in the taskbar and window switcher.
- Ctrl/Cmd+F focuses the results search; the browser's find bar cannot search a virtualized list.

### Fixed

- Scan window detection now matches real Chrome: extension pages in popup windows are reported as tab contexts, so the previous filter never matched and "Open in a window" would have opened a duplicate window instead of focusing the live one.
- A scan handed to a pop-out that is still connecting is no longer consumed and dropped; the validated request starts once the window is ready.
- Scan handoffs are keyed per tab, so handing off scans for two different tabs no longer overwrites one with the other.
- CSV filenames preserve Unicode letters, accents, combining marks and emoji, truncate by code point instead of splitting surrogate pairs, and use the scan's date in your local calendar rather than the export date in UTC.
- Result rows use valid phrasing content inside their disclosures, and dead playlist styles that never rendered are removed.

### Changed

- Elapsed scan time reads as minutes and seconds, and scan timestamps use natural locale formatting ("2:31 PM", not "02:31 PM").
- The scan-window setting reads "Scan in a separate window", and narrow pop-out headers wrap naturally.

## [1.6.6](https://github.com/awishtodiexz/Apple-Music-Playlist-Duplicate-Finder/releases/tag/v1.6.6) (2026-11-25)

### Fixed

- Pressing Scan while a scan window for the tab is already open no longer opens a second window and a second scan against Apple Music; the open window is focused and the scan is handed to it.
- A pop-out now re-checks its tab when it regains focus, as documented. Trimming an over-limit playlist in place re-enables scanning without reloading the window; previously the dead end persisted because in-place edits fire no tab events.

## [1.6.5](https://github.com/awishtodiexz/Apple-Music-Playlist-Duplicate-Finder/releases/tag/v1.6.5) (2026-11-21)

### Fixed

- Cancelling a scan during MusicKit start-up is honoured; an early cancel could previously be lost while the read still ran.
- **Clear results** stays available after a failed rescan of a clean scan instead of flipping visibility.
- An older row's Copy timer can no longer erase a newer copy confirmation early.
- Summary wording for empty and fully-skipped playlists matches the actual outcome; the skipped-song note now hides only when nothing could be checked, and stays visible for partial skips the browser suite relies on.
- Filtered **Copy all** output states its scope ("Filtered to X of Y repeated songs.") instead of implying the full result set.
- Progress updates no longer re-open Scan details after you collapse them.
- In forced-colors mode the error status is marked by a shape cue, not colour alone.
- Opening "Songs no longer repeated" on a very large or tampered cache renders a bounded list.
- The collapsed row clamp no longer pushes the "New" badge onto its own line, inert row-grid and shadowed rules were removed, and the per-group Copy button aligns right again.
- The "Show all" render check tolerates shared machines (bound 150→500 ms after 712 ms was measured on an identical build).

### Changed

- Popup accessibility polish: correct connect label, the Settings disclosure hides when it would be empty, disclosure markers are excluded from accessible names, the feedback live region stays in the accessibility tree, and focus is restored after a failed scan-window handoff.
- Song names with no artist no longer leave a dangling separator in results, copies or the resolved list.
- Long song and artist names clamp to two lines in collapsed rows, and the "Since your last scan" comparison gets an accented card.
- `docs/ARCHITECTURE.md` documents the accepted `amdf:cancel:*` page-world residual risk.
- Refreshed light/dark screenshots.

## [1.6.3](https://github.com/awishtodiexz/Apple-Music-Playlist-Duplicate-Finder/releases/tag/v1.6.3) (2026-11-19)

### Added

- A build-time popup DOM contract check: every element id used by `src/popup.ts` must exist in the shipped HTML and bundle, so a stale markup/code pairing fails before packaging.
- Sanitized MusicKit response fixtures and a contract test covering metadata, v3, legacy, nested, auth, rate-limit and malformed envelopes.
- `npm run coverage`, a source-only gate: at least 90% lines per pure source file and at least 85% branches overall.

### Changed

- Upgrade c8 to 11.0.0 with patched glob/minimatch overrides and run the coverage gate in CI on Linux Node 24.
- Fast typing in the search box coalesces into one list rebuild per burst instead of one per character.
- Same-title duplicate detection is linear; 25,000 same-title songs group in milliseconds instead of roughly 0.75 seconds.
- The scan timestamp is visible next to the results without opening Scan details.
- **Open in a window** focuses the window already open for the same tab, including after the toolbar popup is reopened.
- Rescan comparisons match library and catalog transitions by unambiguous catalog IDs and isolate regionless catalog scans and cached results to their resolved storefront.

### Fixed

- Completed empty-playlist scans keep **Clear results** available after reopening, so their saved playlist metadata can be removed.
- The primary **Scan again** button keeps its accent after a completed scan instead of rendering as an outlined secondary button.
- Duplicate rows preserve keyboard focus across rescans.
- Regionless catalog scans reject storefront switches, including while a replacement MusicKit instance initializes.
- A slow start no longer stops a scan before the ten-minute deadline.
- **Open in a window** no longer focuses a scan window that belongs to another tab.
- Clearing results in one window no longer removes a newer saved scan from another window.
- The credential check flags signed JWTs and Apple Music user token headers.

## [1.6.2](https://github.com/awishtodiexz/Apple-Music-Playlist-Duplicate-Finder/releases/tag/v1.6.2) (2026-11-14)

- Fix the popup failing to open in 1.6.1 with `Missing popup element`. Its build paired new popup markup with old popup code.
- Make the popup a plain read-only report. Remove the Start cleanup button, removal checklist and Verify changes view, which made it look like the extension could delete songs. Rows now show `3 copies` instead of `2 to remove`, positions read `#1 first` instead of `suggested keep`, and a rescan shows a short "Since your last scan" note above the list.

## [1.6.1](https://github.com/awishtodiexz/Apple-Music-Playlist-Duplicate-Finder/releases/tag/v1.6.1) (2026-11-14)

- Rename the extension to Apple Music Playlist Duplicate Finder. The manifest, popup, copied results, repository, npm package and release ZIP names now match.

## [1.6](https://github.com/awishtodiexz/Apple-Music-Playlist-Duplicate-Finder/releases/tag/v1.6) (2026-11-14)

- Simplify the popup into results, cleanup, and fresh-scan verification views, with one main extra-copy count, expandable song positions, and secondary tools in disclosures.
- Start scans in a separate window by default, with a saved option to scan in the toolbar popup.
- Add a removal checklist ordered from the highest playlist position to the lowest, with checkmarks and scan timestamps.
- Compare successful rescans with the previous completed scan, showing extra-copy changes, new repeated songs, and songs no longer repeated.

## [1.5.1](https://github.com/awishtodiexz/Apple-Music-Playlist-Duplicate-Finder/releases/tag/v1.5.1) (2026-11-14)

- Keep catalog playlist results and pop-out connections scoped to their storefront.

## [1.5](https://github.com/awishtodiexz/Apple-Music-Playlist-Duplicate-Finder/releases/tag/v1.5) (2026-11-14)

### Added

- **Show all** reveals the rest of long results, up to 2,000 songs per press.

### Changed

- Clearer titles after a scan: **No repeated songs**, **This playlist is empty** and **Nothing could be checked**.
- Plainer messages throughout.
- A slow Apple Music response shows **Retrying (1 of 2)…** progress.
- A more compact results list shows more songs at once. Each row reads `3 copies · 2 extra` and shows which position is kept, such as `#1 keep · #101 · #245`.
- A note says that songs are matched by Apple Music ID, not title. Same-title songs that are different Apple Music songs are labeled as such.
- **Copy all N** and **CSV (N)** say how many songs they export. The warning for results that are too large to keep names the same actions.
- Search, sort and export stay at the top of the popup while you scroll.
- Per-song **Copy** confirms on the row.
- Copied text uses the same one-line summary as the popup.
- **Cancel scan** is an outlined button.
- Control borders have stronger contrast, the scan button is easier to spot in high-contrast mode, and button and text sizes are more consistent.
- The playlist name can be expanded by keyboard or touch.

### Fixed

- The toolbar popup is always its full 380px width, instead of sometimes opening narrow and cramped.
- A page that is not a playlist shows a neutral **Open a playlist** state instead of an error and a useless retry.
- A playlist over 50,000 songs says so before scanning, with no scan button.
- The button always matches the message: **Retry scan**, **Retry connection**, or no button when retrying cannot help.
- A connection error next to your last scan is shown on its own line, below the summary.
- Screen readers hear the start of a scan right away.
- A pop-out window follows its Apple Music tab when the tab changes page or closes, and recovers after an over-limit playlist is trimmed.
- **Cancel scan** no longer offers **Retry scan**.
- Focused rows are no longer hidden under the sticky toolbar.

## [1.4.2](https://github.com/awishtodiexz/Apple-Music-Playlist-Duplicate-Finder/releases/tag/v1.4.2) (2026-11-13)

### Changed

- Each repeated song shows a compact **3 copies** badge and its positions as `#1 · #101 · #245`, instead of two full sentences.
- The toolbar's copy button is now **Copy list**, so it no longer looks like each song's **Copy**. **Copy list** and **CSV** use neutral colors, leaving the accent color for **Scan again**.
- **Clear results**, **Copy** and **Show all positions** are smaller outlined buttons, and links are no longer underlined outside of sentences.
- The search field has a search icon, and both dropdowns have matching arrows.

## [1.4.1](https://github.com/awishtodiexz/Apple-Music-Playlist-Duplicate-Finder/releases/tag/v1.4.1) (2026-11-12)

### Changed

- A successful scan no longer shows a technical consistency note. The warning only appears when Apple provides no modification marker.
- Shorter, clearer `INSTALL.txt` in the download.
- Rewritten README and documentation.

## [1.4.0](https://github.com/awishtodiexz/Apple-Music-Playlist-Duplicate-Finder/releases/tag/v1.4.0) (2026-11-12)

### Fixed

- The toolbar badge now only appears on the tab that was scanned, instead of on every tab.
- A popup left open in its own window no longer fails with `INCOMPLETE` after the playlist was edited before scanning.
- Previous results, search and sort stay visible during a rescan instead of disappearing until it finishes.
- Keyboard focus moves between **Scan** and **Cancel scan** instead of getting lost.

## [1.3.0](https://github.com/awishtodiexz/Apple-Music-Playlist-Duplicate-Finder/releases/tag/v1.3.0) (2026-11-10)

### Added

- Support for catalog playlists, using the storefront from the playlist URL.
- A failed or cancelled rescan keeps the last completed result on screen, clearly labeled.
- Accessibility improvements: proper text direction for song names, better contrast, forced-colors support and expandable position lists that keep focus.

### Changed

- Stricter checks on Apple's responses. Truncated or inconsistent pages now fail the scan instead of passing silently.
- The cached scan is marked stale if the playlist's version or track count changed.
- CSV export guards against spreadsheet formula injection in more cases.

### Fixed

- Copy and CSV keep the playlist name when MusicKit is unavailable.
- Clearing results while the popup connects no longer brings them back.
- Expanding a huge position list no longer drops focus or stretches the popup.
- Layout fixes for the footer and the results title at narrow widths.

## [1.2.5](https://github.com/awishtodiexz/Apple-Music-Playlist-Duplicate-Finder/releases/tag/v1.2.5) (2026-11-08)

### Added

- Duplicate count on the toolbar badge.
- Copy a single song's positions.
- Filter results by minimum copies.
- **Open in a window**, so a scan survives the popup losing focus.
- Cached results tell you when the playlist has changed since the scan.

### Changed

- `/` focuses search and Escape clears it.
- CSV files include a BOM so Excel reads non-English names correctly.
- The cache now fits a full 50,000-song scan.
- Faster rendering of long position lists.
- More tolerant playlist URL detection.
- Scans that clearly can't finish in time stop early.

### Fixed

- Cached results stay visible when Apple Music can't be reached.
- The badge no longer carries over to a different playlist.
- Search no longer breaks on Turkish and similar locales.

## [1.2.0](https://github.com/awishtodiexz/Apple-Music-Playlist-Duplicate-Finder/releases/tag/v1.2.0) (2026-11-08)

### Added

- Theme switch: Auto, Light or Dark.
- Search, sort, copy and CSV export for results.
- The last completed scan is restored when you reopen the popup.
- Extra-copy counts, collapsible position lists, and error codes for bug reports.

### Changed

- `Retry-After` from Apple is respected when retrying.

### Fixed

- Unexpected errors are no longer reported as network failures.

## [1.1.2](https://github.com/awishtodiexz/Apple-Music-Playlist-Duplicate-Finder/releases/tag/v1.1.2) (2026-11-07)

- Retry network errors, timeouts and rate limits instead of failing the whole scan.
- Time out a stuck page after 30 seconds instead of waiting forever.
- Raise the scan limit from five to ten minutes.
- Fix playlist detection for URLs with a trailing slash.
- Fewer screen-reader announcements while a scan is running.
- Tighter content security policy and a smaller bundle.

## [1.1.1](https://github.com/awishtodiexz/Apple-Music-Playlist-Duplicate-Finder/releases/tag/v1.1.1) (2026-11-05)

- Use the playlist's own storefront for catalog playlists.
- Fix "1 more songs" wording.
- Tighter content security policy.

## [1.1.0](https://github.com/awishtodiexz/Apple-Music-Playlist-Duplicate-Finder/releases/tag/v1.1.0) (2026-10-27)

- Cancel a running scan.
- Scan limits and protection against late responses.
- Warnings when Apple can't confirm the playlist didn't change during a scan.
- Reproducible release ZIPs with SHA-256 checksums.

## [1.0](https://github.com/awishtodiexz/Apple-Music-Playlist-Duplicate-Finder/releases/tag/v1.0) (2026-10-24)

First release.
