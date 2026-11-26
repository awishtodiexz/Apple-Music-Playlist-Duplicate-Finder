import { createBrowserSource } from './browser-source';
import { findDuplicates } from './duplicates';
import { connectFailure, errorCode, errorMessage, errorRecovery, recoveryLabel, ScanError, type Recovery } from './errors';
import { readPlaylist, scanLimits, type PlaylistSource, type ScanProgress } from './playlist-reader';
import { detectPlaylist } from './playlist-url';
import { appleMusicId, compareScans, comparisonText, csvFilename, exportLabels, formatGroupText, formatResultsText, lookalikeIdentities, outcomeTitle, positionParts, scanOutcome, songLabel, splitPositions, summarize, summaryLine, toCsv, visibleGroups, type ResultSummary, type SortMode } from './results';
import { cacheFreshness, clearCachedScan, consumeScanRequest, loadCachedScan, loadScanWindowPreference, loadThemePreference, saveCachedScan, saveScanWindowPreference, saveThemePreference, scanRequestKeyForTab, scanWindowKey, storedScanRequest, themeKey, writeScanRequest, type CachedScan, type CacheFreshness, type ScanCacheRef, type ScanRequest } from './storage';
import { nextTheme, themeLabel, type ThemePreference } from './theme';
import type { DuplicateGroup, PlaylistInfo, PlaylistRef } from './types';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error('Missing popup element');
  return found as T;
}
const scan = element<HTMLButtonElement>('scan');
const cancel = element<HTMLButtonElement>('cancel');
const playlistName = element('playlist-name');
const status = element('status');
const statusTitle = element('status-title');
const statusDetail = element('status-detail');
const statusProblem = element('status-problem');
const statusCode = element('status-code');
const results = element('results');
const list = element('duplicate-list');
const notes = element('scan-notes');
const progress = element<HTMLProgressElement>('scan-progress');
const showMore = element<HTMLButtonElement>('show-more');
const showAll = element<HTMLButtonElement>('show-all');
const resultsTitle = element('results-title');
const resultsNote = element('results-note');
const resultsSearch = element<HTMLInputElement>('results-search');
const resultsSort = element<HTMLSelectElement>('results-sort');
const resultsMin = element<HTMLSelectElement>('results-min');
const copyResults = element<HTMLButtonElement>('copy-results');
const downloadResults = element<HTMLButtonElement>('download-results');
const clearResults = element<HTMLButtonElement>('clear-results');
const resetFilters = element<HTMLButtonElement>('reset-filters');
const popOut = element<HTMLButtonElement>('pop-out');
const popoutSeparator = element('popout-separator');
const statusAnnouncer = element('status-announcer');
const resultsAnnouncer = element('results-announcer');
const resultsFeedback = element('results-feedback');
const resultsEmpty = element('results-empty');
const version = element('version');
const themeToggle = element<HTMLButtonElement>('theme-toggle');
const scanWindow = element<HTMLInputElement>('scan-window');
const scanWindowOption = element('scan-window-option');
const comparisonSection = element('scan-comparison');
const comparisonSummary = element('comparison-summary');
const resolvedDetails = element<HTMLDetailsElement>('resolved-details');
const resolvedSummary = element('resolved-summary');
const resolvedSongs = element('resolved-songs');
const scanSummary = element('scan-summary');
const summaryTitle = element('summary-title');
const summaryDetail = element('summary-detail');
const snapshotNote = element('snapshot-note');
const coverageNote = element('coverage-note');
const scanDetails = element<HTMLDetailsElement>('scan-details');
const settings = element<HTMLDetailsElement>('settings');
let newIdentities = new Set<string>();
const numberFormat = new Intl.NumberFormat();
const number = (value: number): string => numberFormat.format(value);
const batchSize = 50;
// Show all stops here so one press cannot freeze the popup on the largest cached scan.
const showAllLimit = 2_000;
const maxInlinePositions = 50;
const copiedMs = 2_000;
/**
 * The last fully completed scan. It stays in memory so a failed or cancelled
 * rescan can restore valid results (and the badge) instead of erasing them.
 */
interface CompletedScan {
  playlistName: string;
  scannedAt: number;
  cacheRef: ScanCacheRef;
  groups: DuplicateGroup[];
  totalTracks: number;
  unidentified: number;
  notes: string;
  cached: boolean;
  modified?: string | null;
  revision?: string | null;
  comparison: null | { kind: 'unavailable'; previousAt: number } |
    { kind: 'compared'; previousAt: number; data: ReturnType<typeof compareScans> };
}
let lastCompleted: CompletedScan | null = null;
let source: PlaylistSource | null = null;
// Fetched while connecting; reused once so the first scan skips a round trip.
// A popped-out window can stay open while the playlist is edited, so an old
// copy is not a valid "before" snapshot: past this age the scan refetches it.
let pendingInfo: PlaylistInfo | null = null;
let pendingInfoAt = 0;
const pendingInfoMaxAgeMs = 30_000;
let currentPlaylist: PlaylistRef | null = null;
let resolvedStorefront: string | null = null;
let connectedTabId: number | null = null;
let currentPlaylistName = '';
let busy = false;
let clearingResults = false;
let clearCount = 0;
// How the last failure can be recovered from, straight from the error policy table.
let failure: Recovery | null = null;
// The playlist the popup currently describes; a pop-out compares it with its tab when it regains focus.
let shownPlaylist: PlaylistRef | null = null;
let groups: DuplicateGroup[] = [];
let visible: DuplicateGroup[] = [];
let displayed = 0;
// Rows whose name and artist another row shares; computed once per scan, not per render.
let lookalikes = new Set<string>();
let totalTracks = 0;
let unidentified = 0;
let scanNotes = '';
let scanController: AbortController | null = null;
// Latest reading progress, for the scan window's title. Cleared with the scan.
let scanReading: { retrieved: number; total: number | null } | null = null;
// Progress arrives once per page, so the text is rewritten at most this often.
const statusThrottleMs = 1_000;

const manifestVersion = chrome.runtime?.getManifest?.()?.version;
if (manifestVersion) version.textContent = `v${manifestVersion}`;

// Applied before the first scan so an explicit choice never flashes the wrong palette.
let themePreference: ThemePreference = loadThemePreference();
function applyTheme(): void {
  document.documentElement.dataset.theme = themePreference;
  const label = themeLabel(themePreference);
  themeToggle.textContent = `Theme: ${label}`;
  themeToggle.setAttribute('aria-label', `Theme: ${label}. Switch to ${themeLabel(nextTheme(themePreference))}.`);
}
applyTheme();
themeToggle.addEventListener('click', () => {
  themePreference = nextTheme(themePreference);
  saveThemePreference(themePreference);
  applyTheme();
});

/**
 * Badge count survives closing the popup, so it is the glanceable result. It is
 * scoped to the scanned tab: a global badge would label every other tab too.
 */
function setBadge(count: number | null): void {
  try {
    if (!chrome.action || (count !== null && connectedTabId === null)) return;
    const target = connectedTabId === null ? {} : { tabId: connectedTabId };
    // Fixed red: the badge text is white, and the dark-theme accent is too light for white text.
    void Promise.resolve(chrome.action.setBadgeBackgroundColor({ color: '#c7284e', ...target })).catch(() => {});
    void Promise.resolve(chrome.action.setBadgeText({ text: count === null ? '' : count > 999 ? '999+' : String(count), ...target }))
      .catch(() => {});
  } catch {
    // Decorative only; never let a badge failure affect a scan.
  }
}

/** What the one scan button says. Failures take their label from the error policy, never from the error code. */
function scanControl(hasSource: boolean, recovery: Recovery | null, hasResult: boolean): { label: string; hidden: boolean } {
  const retry = (kind: 'rescan' | 'reconnect') => ({ label: recoveryLabel[kind] ?? '', hidden: false });
  // Nothing on this page can fix a failure that needs a different page or cannot be fixed.
  if (recovery === 'navigate' || recovery === 'none') return { label: '', hidden: true };
  if (recovery === 'reconnect') return retry('reconnect');
  // No source with no failure is the first connection still in progress, not a retry.
  if (!hasSource) return { label: 'Connecting…', hidden: false };
  if (recovery === 'rescan') return retry('rescan');
  return { label: hasResult ? 'Scan again' : 'Scan for duplicates', hidden: false };
}

function updateScanLabel(): void {
  const control = scanControl(source !== null, failure, lastCompleted !== null);
  scan.textContent = control.label;
  scan.hidden = control.hidden;
  scan.classList.toggle('secondary', lastCompleted !== null);
}

/** Settings has only two children; in a pop-out the window option is gone, so an empty disclosure hides too. */
function updateSettingsVisibility(): void {
  settings.hidden = scanWindowOption.hidden && clearResults.hidden;
}

/** The popped-out window carries the tab it was opened from; the toolbar popup does not. */
function pinnedTabId(search = location.search): number | null {
  const value = new URLSearchParams(search).get('tab');
  if (!value || !/^\d{1,16}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Only the pop-out has a real, resizable viewport; its CSS reflows down to 240px.
if (pinnedTabId() !== null) document.documentElement.dataset.window = 'pop-out';
scanWindowOption.hidden = pinnedTabId() !== null;
updateSettingsVisibility();
scanWindow.checked = loadScanWindowPreference();
scanWindow.addEventListener('change', () => saveScanWindowPreference(scanWindow.checked));
window.addEventListener('storage', event => {
  if (event.key === themeKey || event.key === null) {
    themePreference = loadThemePreference();
    applyTheme();
  }
  if (event.key === scanWindowKey || event.key === null) scanWindow.checked = loadScanWindowPreference();
});

async function openWindow(autoScan: boolean): Promise<void> {
  if (connectedTabId === null) return;
  const url = new URL(chrome.runtime.getURL('popup.html'));
  url.searchParams.set('tab', String(connectedTabId));
  if (autoScan && currentPlaylist) {
    url.searchParams.set('scan', currentPlaylist.id);
    const storefront = currentPlaylist.kind === 'catalog' ? (currentPlaylist.storefront ?? resolvedStorefront) : null;
    if (storefront) url.searchParams.set('storefront', storefront);
  }
  await chrome.windows.create({ url: url.href, type: 'popup', width: 400, height: 760 });
}

/**
 * The pop-out already open for this tab, or null. Windows are matched against
 * live extension contexts (or extension views before Chrome 116): each pop-out
 * is pinned to its source tab, so only a window showing this tab's popup counts.
 * Contexts are filtered by window, never by context type: an extension page in a
 * popup-type window is a TAB context in real Chromium (POPUP is the action popup).
 */
async function scanWindowForTab(tabId: number): Promise<number | null> {
  const popupUrl = new URL(chrome.runtime.getURL('popup.html'));
  const isPopupForTab = (href: string | undefined): boolean => {
    if (!href) return false;
    try {
      const url = new URL(href);
      return url.protocol === popupUrl.protocol && url.host === popupUrl.host && url.pathname === popupUrl.pathname &&
        pinnedTabId(url.search) === tabId;
    } catch {
      return false;
    }
  };
  const popupWindowIds = (await chrome.windows.getAll({ windowTypes: ['popup'] }))
    .map(({ id }) => id).filter((id): id is number => id !== undefined);
  if (popupWindowIds.length === 0) return null;
  // runtime.getContexts is the MV3 API (Chrome 116+). extension.getViews remains
  // the fallback because the extension still supports Chrome 111.
  if (typeof chrome.runtime.getContexts === 'function') {
    try {
      const contexts = await chrome.runtime.getContexts({ windowIds: popupWindowIds });
      const match = contexts.find(context => isPopupForTab(context.documentUrl));
      return match?.windowId ?? null;
    } catch { /* Fall through to the pre-116 view API. */ }
  }
  for (const id of popupWindowIds) {
    try {
      if (chrome.extension.getViews({ windowId: id }).some(view => isPopupForTab(view.location.href))) return id;
    } catch { /* A window can close between enumeration and inspection. */ }
  }
  return null;
}

/** Focus the pop-out already open for this tab, or open one. */
async function focusOrOpenWindow(): Promise<void> {
  const tabId = connectedTabId;
  if (tabId === null) return;
  const existing = await scanWindowForTab(tabId);
  if (existing !== null) {
    try {
      await chrome.windows.update(existing, { focused: true });
      return;
    } catch { /* The matching window may have closed after enumeration. */ }
  }
  await openWindow(false);
}

function updatePopOut(): void {
  // Hidden while a scan runs: opening the window closes this popup, which would
  // abort that scan before the new window could adopt the results.
  popOut.hidden = !(connectedTabId !== null && !busy && pinnedTabId() === null &&
    typeof chrome.windows?.create === 'function');
  // The footer separator belongs to the button; a popped-out window has neither.
  popoutSeparator.hidden = popOut.hidden;
}

popOut.addEventListener('click', async () => {
  if (connectedTabId === null || busy) return;
  const refocus = document.activeElement === popOut;
  popOut.disabled = true;
  try {
    await focusOrOpenWindow();
  } catch {
    setStatus('Could not open a window', 'Try Open in a window again.');
  } finally {
    popOut.disabled = false;
    if (refocus && !popOut.hidden) popOut.focus();
  }
});

interface StatusOptions {
  /** Error styling for the whole block. */
  error?: boolean;
  code?: string;
  /** A failure shown beside results that are still valid, so the title can stay neutral. */
  problem?: { message: string; error: boolean };
  /** Marks a progress update; repeats of the same phase are announced sparingly. */
  phase?: ScanProgress['phase'];
  announceExtra?: string;
}

/**
 * A scan window spends most of its life in the background, so its title is the one
 * place scan state stays visible in the taskbar and window switcher. Results win
 * over connect and failure states; an active scan wins over everything.
 */
function syncDocumentTitle(): void {
  const base = 'Apple Music Playlist Duplicate Finder';
  let headline = '';
  if (scanController) {
    headline = 'Scanning playlist…';
    if (scanReading?.total) {
      const percent = Math.min(100, Math.floor(scanReading.retrieved / scanReading.total * 100));
      headline = `Scanning playlist · ${percent}%`;
    }
  }
  else if (!scanSummary.hidden && summaryTitle.textContent) headline = summaryTitle.textContent;
  else if (busy || failure) headline = statusTitle.textContent ?? '';
  document.title = headline ? `${headline} — ${base}` : base;
}

function setStatus(title: string, detail: string, { error = false, code, problem, phase, announceExtra }: StatusOptions = {}): void {
  // Assigning identical text still replaces the node and re-triggers a live
  // region announcement, so only write what actually changed.
  // Progress ticks must not re-open the details a user chose to collapse.
  if (phase === undefined) scanDetails.open = true;
  if (statusTitle.textContent !== title) statusTitle.textContent = title;
  if (statusDetail.textContent !== detail) statusDetail.textContent = detail;
  status.dataset.error = String(error);
  statusProblem.textContent = problem?.message ?? '';
  statusProblem.dataset.error = String(problem?.error ?? false);
  statusProblem.hidden = !problem;
  statusCode.textContent = code ? `Error code: ${code}` : '';
  statusCode.hidden = !code;
  announceStatus(phase ?? title, phase !== undefined,
    [title, detail, problem?.message ?? '', code ? `Error code ${code}` : '', announceExtra ?? '']
      .filter(Boolean).map(endSentence).join(' '));
  syncDocumentTitle();
}

/** Titles carry no final period and details do; a screen reader needs exactly one pause between them. */
function endSentence(text: string): string {
  return text.split('\n').map(line => {
    const trimmed = line.trimEnd();
    if (!trimmed || /[.!?…]$/.test(trimmed)) return trimmed;
    return `${trimmed}.`;
  }).join('\n');
}

// Progress text changes every page, and a screen reader that repeats it is unusable.
// Every change of phase (or of title, for everything else) is announced at once;
// only repeated updates within one phase are held back.
const statusAnnounceIntervalMs = 20_000;
let lastAnnouncedKey = '';
let lastStatusAnnouncement = 0;
function announceStatus(key: string, repeatable: boolean, text: string): void {
  const now = Date.now();
  if (repeatable && key === lastAnnouncedKey && now - lastStatusAnnouncement < statusAnnounceIntervalMs) return;
  lastAnnouncedKey = key;
  lastStatusAnnouncement = now;
  if (statusAnnouncer.textContent !== text) statusAnnouncer.textContent = text;
}

function clearGroups(): void {
  cancelSearchDebounce();
  clearTimeout(resultsAnnounceTimer);
  resultsAnnounceTimer = undefined;
  groups = [];
  visible = [];
  displayed = 0;
  lookalikes = new Set();
  totalTracks = 0;
  unidentified = 0;
  scanNotes = '';
  comparisonSection.hidden = true;
  scanSummary.hidden = true;
  snapshotNote.textContent = '';
  resultsNote.hidden = true;
  scanDetails.open = true;
  newIdentities = new Set();
  list.replaceChildren();
  results.hidden = true;
  setResultsView(false);
  showMore.hidden = true;
  showAll.hidden = true;
  notes.hidden = true;
  notes.textContent = '';
  resultsEmpty.hidden = true;
  resultsFeedback.textContent = '';
  resultsSearch.value = '';
  resultsMin.value = '2';
  resultsSort.value = 'playlist';
  clearResults.hidden = true;
  updateSettingsVisibility();
  syncDocumentTitle();
}

function currentGroups(): DuplicateGroup[] {
  const mode = resultsSort.value as SortMode;
  return visibleGroups(groups, resultsSearch.value, mode || 'playlist', Number(resultsMin.value) || 2);
}

/** Writes "#1 first · #101 · #245"; the hidden label keeps the meaning for screen readers. */
function renderPositions(target: HTMLElement, group: DuplicateGroup, limit: number): void {
  const label = document.createElement('span');
  label.className = 'visually-hidden';
  label.textContent = 'Playlist positions: ';
  const parts = positionParts(group, limit);
  const first = document.createElement('span');
  first.className = 'keep';
  first.textContent = parts.first;
  const later = document.createElement('span');
  later.className = 'extras';
  later.textContent = parts.later;
  target.replaceChildren(label, first, later);
}

const copyTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
const rowGroups = new WeakMap<HTMLElement, DuplicateGroup>();

/** The row's own button says it worked: feedback far above a long list would never be seen. */
function confirmRowCopy(button: HTMLButtonElement, ok: boolean, name: string): void {
  clearTimeout(copyTimers.get(button));
  button.textContent = ok ? 'Copied' : 'Failed';
  button.setAttribute('aria-label', ok ? `Copied ${name}` : `Copy failed: ${name}`);
  const message = ok ? `Copied ${name}.` : 'Copy failed. Use CSV instead.';
  resultsAnnouncer.textContent = message;
  copyTimers.set(button, setTimeout(() => {
    button.textContent = 'Copy';
    button.setAttribute('aria-label', `Copy ${name}`);
    if (resultsAnnouncer.textContent === message) resultsAnnouncer.textContent = '';
  }, copiedMs));
}

function buildGroup(group: DuplicateGroup): HTMLLIElement {
  const { later } = splitPositions(group);
  const item = document.createElement('li');
  rowGroups.set(item, group);
  item.tabIndex = -1;
  // A span, not a p: summary content is limited to phrasing and heading content.
  const title = document.createElement('span');
  title.className = 'title';
  const song = document.createElement('span');
  song.className = 'song';
  // Let each name own its text direction; mixed-script titles then read in the
  // right order instead of inheriting the popup's left-to-right paragraph.
  song.dir = 'auto';
  // API-provided text is always text, never HTML.
  song.textContent = group.name;
  title.append(song);
  if (newIdentities.has(group.identity)) {
    const label = document.createElement('span');
    label.className = 'new-repeat';
    label.textContent = 'New';
    title.append(label);
  }
  if (group.artist.trim()) {
    const artist = document.createElement('span');
    artist.className = 'artist';
    artist.dir = 'auto';
    artist.textContent = group.artist;
    title.append(artist);
  }
  const detail = document.createElement('details');
  detail.className = 'song-details';
  const summary = document.createElement('summary');
  summary.append(title);
  const copyCount = document.createElement('span');
  copyCount.className = 'copy-count';
  copyCount.textContent = `${number(group.copies)} copies`;
  summary.append(copyCount);
  detail.append(summary);
  item.append(detail);
  const meta = document.createElement('div');
  meta.className = 'meta';
  const counts = document.createElement('span');
  counts.className = 'counts';
  counts.textContent = `${number(group.copies)} copies · ${number(later.length)} extra`;
  const positions = document.createElement('p');
  positions.className = 'positions';
  renderPositions(positions, group, maxInlinePositions);
  meta.append(counts, positions);
  detail.append(meta);
  if (lookalikes.has(group.identity)) {
    const note = document.createElement('p');
    note.className = 'lookalike';
    note.textContent = `Different Apple Music song, same title · Apple Music ID ${appleMusicId(group)}`;
    detail.append(note);
  }
  const name = group.artist.trim() ? `${group.name} by ${group.artist}` : group.name;
  if (group.positions.length > maxInlinePositions) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'more-positions';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = `Show all ${number(group.positions.length)} positions`;
    detail.append(toggle);
  }
  const copyGroup = document.createElement('button');
  copyGroup.type = 'button';
  copyGroup.className = 'copy-group';
  copyGroup.textContent = 'Copy';
  copyGroup.setAttribute('aria-label', `Copy ${name}`);
  detail.append(copyGroup);
  return item;
}

list.addEventListener('click', event => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest('button');
  if (!(button instanceof HTMLButtonElement)) return;
  const item = button.closest('li');
  if (!(item instanceof HTMLLIElement) || !list.contains(item)) return;
  const group = rowGroups.get(item);
  if (!group) return;
  const name = group.artist.trim() ? `${group.name} by ${group.artist}` : group.name;
  if (button.classList.contains('more-positions')) {
    const positions = item.querySelector<HTMLElement>('.positions');
    if (!positions) return;
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(expanded));
    button.textContent = expanded ? 'Show fewer positions' : `Show all ${number(group.positions.length)} positions`;
    if (expanded) {
      renderPositions(positions, group, Infinity);
      // Thousands of positions stay inside a short scroll area, and the
      // toggle keeps focus so a keyboard user can collapse it again.
      positions.tabIndex = 0;
      positions.setAttribute('role', 'group');
      positions.setAttribute('aria-label', `All playlist positions for ${name}`);
      positions.setAttribute('data-expanded', 'true');
    } else {
      renderPositions(positions, group, maxInlinePositions);
      positions.removeAttribute('tabindex');
      positions.removeAttribute('role');
      positions.removeAttribute('aria-label');
      positions.removeAttribute('data-expanded');
    }
    return;
  }
  if (!button.classList.contains('copy-group')) return;
  void copyText(formatGroupText(group)).then(ok => confirmRowCopy(button, ok, name));
});

function updateResultsTitle(): void {
  const query = resultsSearch.value.trim();
  const minCopies = Number(resultsMin.value) || 2;
  const batching = displayed < visible.length;
  const count = number(visible.length);
  let text: string;
  if (query || minCopies > 2) {
    text = `Repeated songs · ${count} of ${number(groups.length)} matching`;
    if (batching) text += ` · ${number(displayed)} shown`;
  } else {
    text = batching ?
      `Repeated songs · ${number(displayed)} of ${count} shown` :
      `Repeated songs · ${count}`;
  }
  if (resultsTitle.textContent !== text) resultsTitle.textContent = text;
}

/** The scope Copy and CSV export: every song matching the filters, not just the rows drawn. */
function updateExportLabels(): void {
  const labels = exportLabels(visible.length, visible.length < groups.length);
  copyResults.textContent = labels.copy;
  copyResults.setAttribute('aria-label', labels.copyName);
  downloadResults.textContent = labels.csv;
  downloadResults.setAttribute('aria-label', labels.csvName);
}

function appendBatch(count: number = batchSize): void {
  const end = Math.min(displayed + count, visible.length);
  list.append(...visible.slice(displayed, end).map(buildGroup));
  displayed = end;
  const remaining = visible.length - displayed;
  const nextBatch = Math.min(batchSize, remaining);
  showMore.hidden = remaining <= 0;
  showMore.textContent = `Show ${number(nextBatch)} more ${nextBatch === 1 ? 'song' : 'songs'}`;
  // One batch is what Show more already does, so a second button would only repeat it.
  showAll.hidden = remaining <= batchSize;
  const step = Math.min(remaining, showAllLimit);
  showAll.textContent = step === remaining ? `Show all ${number(visible.length)}` : `Show next ${number(step)}`;
  showAll.setAttribute('aria-label', `${showAll.textContent} repeated songs`);
  results.hidden = groups.length === 0;
  setResultsView(lastCompleted !== null);
  resultsEmpty.hidden = visible.length !== 0;
  copyResults.disabled = visible.length === 0;
  downloadResults.disabled = visible.length === 0;
  updateExportLabels();
  updateResultsTitle();
}

function renderResults(): void {
  // Feedback about the last copy, download or reveal describes a list that no longer exists.
  resultsFeedback.textContent = '';
  visible = currentGroups();
  displayed = 0;
  list.replaceChildren();
  appendBatch();
  // Typing should not announce per character; the count is debounced, and a
  // scan's own status announcement already covers the first render.
  if (!busy) announceResults();
}

let resultsAnnounceTimer: ReturnType<typeof setTimeout> | undefined;
function announceResults(): void {
  clearTimeout(resultsAnnounceTimer);
  resultsAnnounceTimer = setTimeout(() => {
    if (busy) return;
    const text = visible.length === groups.length ?
      `${number(visible.length)} ${visible.length === 1 ? 'song' : 'songs'} shown.` :
      `${number(visible.length)} of ${number(groups.length)} songs match.`;
    if (resultsAnnouncer.textContent !== text) resultsAnnouncer.textContent = text;
  }, 500);
}

const searchDebounceMs = 120;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let searchTrailingPending = false;

/** Forget a pending debounced search render and any trailing render folded into it. */
function cancelSearchDebounce(): void {
  clearTimeout(searchTimer);
  searchTimer = undefined;
  searchTrailingPending = false;
}

/**
 * Leading-edge + trailing-edge debounce for the search box. The first keystroke
 * renders at once so the list stays responsive; the rest of a burst coalesce into
 * one render after typing settles. Sort and minimum-copies stay immediate.
 */
function onSearchInput(event: Event): void {
  // Stale copy/download/reveal feedback describes the previous list; drop it as
  // soon as the query changes, even while the list rebuild is coalesced.
  resultsFeedback.textContent = '';
  const input = event as InputEvent;
  // Typing emits one single-character insertion per event; a fill, paste or
  // clear replaces the whole value at once. Only keystroke bursts need
  // coalescing, and whole-value edits must stay immediate for callers that fill
  // the field and assert the new list on the next line.
  const typing = input.inputType === 'insertText' && input.data !== null && input.data.length === 1;
  if (!typing) {
    renderResultsNow();
    return;
  }
  if (searchTimer === undefined) {
    renderResults();
  } else {
    searchTrailingPending = true;
  }
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchTimer = undefined;
    if (searchTrailingPending) {
      searchTrailingPending = false;
      renderResults();
    }
  }, searchDebounceMs);
}

/** Render from a non-typing control or an explicit clear, cancelling a pending trailing render. */
function renderResultsNow(): void {
  cancelSearchDebounce();
  renderResults();
}

/** Clear results applies to the completed scan on screen: something saved, or results worth discarding. */
function clearAvailable(completed: CompletedScan): boolean {
  return completed.cached || completed.totalTracks > 0 || completed.comparison !== null;
}

/** Paint one completed scan. Only a completed scan ever reaches this function. */
function applyCompleted(completed: CompletedScan): void {
  const changed = lastCompleted !== completed;
  // Rebuilding the list removes a focused row, and hiding the results hides a focused
  // control; either would drop keyboard focus onto the body.
  const listFocused = list.contains(document.activeElement);
  const resultsFocused = results.contains(document.activeElement);
  lastCompleted = completed;
  currentPlaylistName = completed.playlistName;
  groups = completed.groups;
  totalTracks = completed.totalTracks;
  unidentified = completed.unidentified;
  scanNotes = completed.notes;
  notes.textContent = scanNotes;
  notes.hidden = !scanNotes;
  lookalikes = lookalikeIdentities(groups);
  const comparison = completed.comparison;
  comparisonSection.hidden = comparison === null;
  resolvedDetails.hidden = true;
  newIdentities = new Set();
  if (comparison) {
    const date = `Compared with scan from ${formatDate(comparison.previousAt)}.`;
    if (comparison.kind === 'unavailable') {
      comparisonSummary.textContent = `${date}\nSome songs could not be identified in one of these scans, so changes cannot be confirmed.`;
    } else {
      comparisonSummary.textContent = `${comparisonText(comparison.data)}\n${date}`;
      newIdentities = new Set(comparison.data.added.map(group => group.identity));
      resolvedDetails.hidden = comparison.data.resolved.length === 0;
      const count = comparison.data.resolved.length;
      resolvedSummary.textContent = `${number(count)} ${count === 1 ? 'song' : 'songs'} no longer repeated`;
      resolvedSongs.textContent = '';
      resolvedDetails.open = false;
    }
  }
  setBadge(groups.length);
  renderResults();
  renderSummary();
  if (changed) scanDetails.open = false;
  clearResults.hidden = !clearAvailable(completed);
  updateSettingsVisibility();
  if (resultsFocused && results.hidden) summaryTitle.focus();
  else if (listFocused) resultsTitle.focus();
}

resolvedDetails.addEventListener('toggle', () => {
  const comparison = lastCompleted?.comparison;
  if (resolvedDetails.open && comparison?.kind === 'compared') {
    // A tampered or huge cache could name thousands of songs; bound the write like positionParts.
    const resolved = comparison.data.resolved;
    const lines = resolved.slice(0, maxInlinePositions).map(songLabel);
    if (resolved.length > maxInlinePositions) lines.push(`…and ${number(resolved.length - maxInlinePositions)} more`);
    resolvedSongs.textContent = lines.join('\n');
  }
});

function renderSummary(): void {
  const completed = lastCompleted;
  if (!completed) return;
  const summary = summarize(totalTracks, groups, unidentified);
  const extraCount = summary.extraCopies;
  scanSummary.hidden = false;
  resultsNote.hidden = groups.length === 0;
  // The headline states the scan's outcome, not a claim the outcome logic avoids.
  const outcome = scanOutcome(summary);
  summaryTitle.textContent = groups.length > 0 ?
    `${number(groups.length)} ${groups.length === 1 ? 'song repeats' : 'songs repeat'}` :
    outcomeTitle[outcome];
  summaryDetail.textContent = groups.length > 0 ?
    `${number(extraCount)} extra ${extraCount === 1 ? 'copy' : 'copies'} · ${number(totalTracks)} songs scanned` :
    outcome === 'clean' ? `${number(totalTracks)} songs scanned` : summaryLine(summary);
  snapshotNote.textContent = `Scan from ${formatDate(completed.scannedAt)}`;
  // The note stays visible whenever the skip was partial (the browser suite pins it for
  // repeats); the "may be missing" hedge is only false when nothing could be checked.
  coverageNote.hidden = completed.unidentified === 0 || outcome === 'unchecked';
  coverageNote.textContent = `${number(completed.unidentified)} ${completed.unidentified === 1 ? 'song was' : 'songs were'} skipped, so some repeats may be missing.`;
  updateScanLabel();
  syncDocumentTitle();
}

/** Caveats the summary line does not already state. */
function scanNotesText(summary: ResultSummary, countVerified: boolean, modificationChecked: boolean): string {
  const lines: string[] = [];
  // With no repeats, the summary line already says how many songs were skipped.
  if (scanOutcome(summary) === 'duplicates' && summary.unidentified > 0) {
    const one = summary.unidentified === 1;
    lines.push(`${number(summary.unidentified)} ${one ? 'song had' : 'songs had'} no Apple Music ID and ${one ? 'was' : 'were'} skipped.`);
  }
  if (!countVerified) lines.push('Apple Music gave no song total, so the count could not be double-checked.');
  if (!modificationChecked) {
    lines.push('Apple Music did not say when this playlist last changed, so edits that keep the song count the same cannot be detected. Scan again after you edit it.');
  }
  return lines.join('\n');
}

/** Serialize reads and writes across extension windows. */
async function withScanCache<T>(operation: () => T, unavailable: T): Promise<T> {
  try {
    if (typeof navigator.locks?.request !== 'function') return operation();
    return await navigator.locks.request('amdf:scan-cache', operation);
  } catch { return unavailable; }
}

function restoreCached(cached: CachedScan): CompletedScan {
  const completed: CompletedScan = {
    playlistName: cached.playlistName,
    scannedAt: cached.scannedAt,
    cacheRef: { playlistId: cached.playlistId, storefront: cached.storefront, scannedAt: cached.scannedAt, scanId: cached.scanId },
    groups: cached.groups,
    totalTracks: cached.totalTracks,
    unidentified: cached.unidentified,
    // Rebuilt rather than read back, so a scan saved by an older version gets today's wording.
    notes: scanNotesText(summarize(cached.totalTracks, cached.groups, cached.unidentified), cached.countVerified, cached.modificationChecked),
    cached: true,
    modified: cached.modified,
    revision: cached.revision,
    comparison: null,
  };
  applyCompleted(completed);
  return completed;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

const tooLargeToKeep = 'These results are too large to keep after closing. Use Copy all or CSV to save them.';

/** Explains that results on screen are the previous completed scan, never the failed one. */
function lastCompletedNotice(completed: CompletedScan): string {
  const persistence = completed.cached ? '' : `\n${tooLargeToKeep}`;
  return `Showing your last scan from ${formatDate(completed.scannedAt)}.${persistence}\n` +
    summaryLine(summarize(completed.totalTracks, completed.groups, completed.unidentified));
}

/** The summary and date of the scan on screen, when the title already says it is the last scan. */
function lastScanDetail(completed: CompletedScan): string {
  return `${summaryLine(summarize(completed.totalTracks, completed.groups, completed.unidentified))}\nScanned ${formatDate(completed.scannedAt)}.`;
}

const refreshAdvice: Record<CacheFreshness, string> = {
  current: 'Scan again to refresh.',
  changed: 'The playlist changed since this scan. Scan again to refresh.',
  unknown: 'Could not check whether the playlist changed since then.',
};

/** Connect-time states that are not errors: retrying cannot help, so they get a plain title and no scan button. */
const neutralConnectTitles: Readonly<Record<string, string | undefined>> = {
  NOT_PLAYLIST: 'Open a playlist',
  LIMIT: 'Playlist too large to scan',
  TAB_CLOSED: 'Apple Music tab closed',
};

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path for browsers that deny clipboard access.
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  try { return document.execCommand('copy'); } finally { textarea.remove(); }
}

function downloadCsv(): void {
  // The BOM lets Excel detect UTF-8 instead of mangling non-ASCII names.
  const blob = new Blob(['\uFEFF' + toCsv(visible)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = csvFilename(currentPlaylistName || 'playlist', new Date(lastCompleted?.scannedAt ?? Date.now()));
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * A name cut off by its line clamp becomes a toggle. A mouse tooltip is not enough:
 * keyboard and touch users expand it with Enter, Space or a tap.
 */
function updateNameToggle(): void {
  if (playlistName.dataset.expanded === 'true') return;
  if (playlistName.scrollHeight > playlistName.clientHeight + 1) {
    playlistName.setAttribute('role', 'button');
    playlistName.tabIndex = 0;
    playlistName.setAttribute('aria-expanded', 'false');
  } else {
    playlistName.removeAttribute('role');
    playlistName.removeAttribute('tabindex');
    playlistName.removeAttribute('aria-expanded');
  }
}

function toggleName(): void {
  if (playlistName.getAttribute('role') !== 'button') return;
  const expanded = playlistName.dataset.expanded !== 'true';
  playlistName.dataset.expanded = String(expanded);
  playlistName.setAttribute('aria-expanded', String(expanded));
  if (!expanded) updateNameToggle();
}
playlistName.addEventListener('click', toggleName);
playlistName.addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  toggleName();
});
// A pop-out can be resized, which changes where the name is cut off.
window.addEventListener('resize', updateNameToggle);

function showPlaylistName(name: string, tooltip = ''): void {
  playlistName.textContent = name;
  playlistName.title = tooltip;
  delete playlistName.dataset.expanded;
  updateNameToggle();
}

// The sticky bar grows as its toolbar wraps in a narrow pop-out, so the room scrolling
// must leave above a focused row (scroll-padding-top in the CSS) follows its live height.
const resultsControls = element('results-controls');
function syncControlsHeight(): void {
  document.documentElement.style.setProperty('--controls-height', `${resultsControls.offsetHeight}px`);
}
new ResizeObserver(syncControlsHeight).observe(resultsControls);

/** Completed scans give the playlist name the header's emphasis. */
function setResultsView(shown: boolean): void {
  if (document.body.classList.contains('has-results') === shown) return;
  document.body.classList.toggle('has-results', shown);
  updateNameToggle();
}

let refocusScanAfterConnect = false;
/** Give focus back to the scan button, or to the status when a failure left no button to press. */
function focusScan(): void {
  if (!scan.hidden && !scan.disabled) { scan.focus(); return; }
  if (busy) refocusScanAfterConnect = true;
  statusTitle.tabIndex = -1;
  statusTitle.focus();
}

async function initialize(): Promise<void> {
  // "Retry connection" disables the focused button; give focus back afterwards.
  const refocus = document.activeElement === scan;
  const previousCompleted = lastCompleted;
  const previousPlaylist = shownPlaylist;
  const clearAtStart = clearCount;
  busy = true;
  failure = null;
  shownPlaylist = null;
  // A new connection may target a different playlist; never carry the previous
  // playlist's results into it. A cache for this playlist is restored below.
  lastCompleted = null;
  currentPlaylistName = '';
  clearGroups();
  source = null;
  currentPlaylist = null;
  resolvedStorefront = null;
  pendingInfo = null;
  scan.disabled = true;
  scan.hidden = false;
  scan.textContent = 'Connecting…';
  showPlaylistName('Detecting playlist…');
  setStatus('Connecting to Apple Music…', 'Checking the current playlist.');
  connectedTabId = null;
  updatePopOut();
  try {
    const pinned = pinnedTabId();
    let tab: chrome.tabs.Tab | undefined;
    if (pinned !== null) {
      try { tab = await chrome.tabs.get(pinned); } catch { throw new ScanError('TAB_CLOSED'); }
    } else {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    }
    if (tab?.id === undefined) throw new Error('Tab unavailable');
    connectedTabId = tab.id;
    updatePopOut();
    const playlist = detectPlaylist(tab.url ?? '');
    shownPlaylist = playlist;
    const candidate = createBrowserSource(tab.id, playlist);
    // A regionless catalog route needs MusicKit to establish its cache identity.
    // Explicit routes and library playlists can paint before the round trip.
    let cached = await withScanCache(() => loadCachedScan(playlist.id, playlist.storefront), null);
    if (cached) {
      const restored = restoreCached(cached);
      showPlaylistName(cached.playlistName, cached.playlistName);
      setStatus('Showing last scan', `${lastScanDetail(restored)} Checking Apple Music…`);
    } else {
      // The badge outlives the popup, so a different playlist must not inherit it.
      setBadge(null);
    }
    const info = await candidate.metadata();
    if (playlist.kind === 'catalog' && playlist.storefront === null) {
      cached = await withScanCache(() => loadCachedScan(playlist.id, info.storefront), null);
      if (cached) restoreCached(cached);
    } else if (cached) {
      const currentCached = await withScanCache(() => loadCachedScan(playlist.id, playlist.storefront), null);
      if (!currentCached) {
        lastCompleted = null;
        clearGroups();
        setBadge(null);
        cached = null;
      } else if (currentCached.scannedAt !== cached.scannedAt || currentCached.scanId !== cached.scanId) {
        cached = currentCached;
        restoreCached(cached);
      }
    }
    currentPlaylistName = info.name;
    showPlaylistName(info.name, info.name);
    // Fail here rather than on a scan that could only fail the same way.
    if (info.total !== null && info.total > scanLimits.maxTracks) throw new ScanError('LIMIT');
    pendingInfo = info;
    pendingInfoAt = Date.now();
    source = candidate;
    currentPlaylist = playlist;
    resolvedStorefront = playlist.kind === 'catalog' ? info.storefront ?? null : null;
    const restoreUncached = !cached && clearCount === clearAtStart && !clearingResults &&
      previousCompleted !== null && !previousCompleted.cached &&
      previousPlaylist !== null && previousPlaylist.id === playlist.id && previousPlaylist.kind === playlist.kind &&
      (playlist.kind !== 'catalog' || previousCompleted.cacheRef.storefront === (info.storefront ?? null));
    if (restoreUncached) applyCompleted(previousCompleted);
    if (cached && lastCompleted) {
      setStatus('Showing last scan', `${lastScanDetail(lastCompleted)} ${refreshAdvice[cacheFreshness(cached, info)]}`);
    } else if (restoreUncached) {
      setStatus('Showing last scan', `${lastScanDetail(previousCompleted)} ${refreshAdvice[cacheFreshness(previousCompleted, info)]}`);
    } else {
      // No cache, or the user cleared it while this connection was in flight:
      // neither case may claim to be showing a cached scan.
      setStatus('Ready to scan', 'Find songs listed more than once. Keep this open while scanning.');
    }
  } catch (error) {
    if (error instanceof ScanError && error.code === 'TAB_CLOSED' && previousCompleted &&
      clearCount === clearAtStart && !clearingResults) {
      applyCompleted(previousCompleted);
      showPlaylistName(previousCompleted.playlistName, previousCompleted.playlistName);
    }
    const { message, recovery } = connectFailure(error);
    const code = errorCode(error);
    const neutralTitle = neutralConnectTitles[code];
    failure = recovery;
    if (lastCompleted) {
      // The results on screen are still valid: say why they cannot be refreshed next to them.
      setStatus('Showing last scan', lastScanDetail(lastCompleted), { code, problem: { message, error: !neutralTitle } });
    } else {
      if (recovery === 'navigate') showPlaylistName('No playlist open');
      else if (!currentPlaylistName) showPlaylistName('Playlist unavailable');
      setStatus(neutralTitle ?? 'Could not connect', message, { error: !neutralTitle, code });
      setBadge(null);
    }
  } finally {
    busy = false;
    scan.disabled = clearingResults;
    updateScanLabel();
    updatePopOut();
    const shouldRefocus = refocus || refocusScanAfterConnect;
    refocusScanAfterConnect = false;
    if (shouldRefocus) focusScan();
    if (!recheckPending) adoptScanRequest(false);
    replayRecheck();
    syncDocumentTitle();
  }
}

/**
 * A toolbar popup closes when the page changes, but a pop-out stays open, so it follows
 * its tab. tabs.onUpdated and onRemoved need no "tabs" permission: they report the move
 * (with the URL while activeTab holds, and without it after a cross-origin move, which
 * then reads as "not a playlist"). Reconnect when the playlist is no longer the one shown,
 * or when the last failure offered no retry (a playlist over the limit may have been trimmed).
 */
let recheckPending = false;
let rechecking = false;
async function recheckPinnedTab(): Promise<void> {
  const pinned = pinnedTabId();
  if (pinned === null) return;
  if (busy || rechecking || clearingResults) { recheckPending = true; return; }
  rechecking = true;
  let shouldInit = false;
  try {
    let current: PlaylistRef | null;
    try { current = detectPlaylist((await chrome.tabs.get(pinned)).url ?? ''); } catch { current = null; }
    if (busy || clearingResults) { recheckPending = true; return; }
    shouldInit = current?.id !== shownPlaylist?.id || current?.kind !== shownPlaylist?.kind ||
      (current?.kind === 'catalog' && current.storefront !== shownPlaylist?.storefront) || failure === 'none';
  } finally {
    rechecking = false;
  }
  if (shouldInit) {
    await initialize();
  } else {
    adoptScanRequest();
    replayRecheck();
  }
}

/** An event that arrived while connecting or scanning described the page before that work finished. */
function replayRecheck(): void {
  if (!recheckPending) return;
  recheckPending = false;
  void recheckPinnedTab();
}

function matchesScanRequest(playlist: PlaylistRef | null, storefront: string | null, request: ScanRequest): boolean {
  if (request.playlist !== undefined && (playlist === null || playlist.id !== request.playlist)) return false;
  if (request.storefront !== undefined &&
    (playlist === null || playlist.kind !== 'catalog' || (playlist.storefront ?? storefront) !== request.storefront)) return false;
  return true;
}

/**
 * Start a scan handed to this pop-out, or leave it stored while a connect or clear finishes.
 * Reads the live storage entry so a stale storage event cannot run an overwritten or removed request.
 */
function adoptScanRequest(allowReconnect = true): void {
  const pinned = pinnedTabId();
  if (pinned === null) return;
  const stored = storedScanRequest(pinned);
  if (!stored || stored.request.tab !== pinned) return;
  if (scanController !== null) {
    if (matchesScanRequest(currentPlaylist, resolvedStorefront, stored.request)) consumeScanRequest(pinned, stored.raw);
    return;
  }
  if (busy || rechecking || clearingResults) return;
  const needsReconnect = !currentPlaylist || !source || !matchesScanRequest(currentPlaylist, resolvedStorefront, stored.request) ||
    failure === 'reconnect' || failure === 'navigate' || failure === 'none';
  if (needsReconnect) {
    if (allowReconnect) {
      void initialize();
      return;
    }
    consumeScanRequest(pinned, stored.raw);
    return;
  }
  if (consumeScanRequest(pinned, stored.raw)) void startScan();
}

const pinnedTab = pinnedTabId();
if (pinnedTab !== null) {
  // Apple Music navigates without reloading, so a URL change alone (no status) counts too.
  chrome.tabs.onUpdated?.addListener((tabId, change) => {
    if (tabId === pinnedTab && (change.status === 'complete' || (change.url !== undefined && change.status === undefined))) {
      void recheckPinnedTab();
    }
  });
  chrome.tabs.onRemoved?.addListener(tabId => { if (tabId === pinnedTab) void recheckPinnedTab(); });
  // Editing the playlist in place moves neither the URL nor the loading status, so no
  // tab event fires. Focus is the backstop: it matters most when the last failure
  // offered no retry, because an over-limit playlist may have been trimmed in place.
  window.addEventListener('focus', () => { void recheckPinnedTab(); });
  // A scan handed off from the toolbar popup arrives here when this window was
  // already open for the tab. A scan already running fulfills it; a connect in
  // progress leaves it stored so it can start as soon as the playlist is ready.
  window.addEventListener('storage', event => {
    if (event.key !== scanRequestKeyForTab(pinnedTab) || typeof event.newValue !== 'string') return;
    adoptScanRequest();
  });
}

/** Draw more rows and move focus to the first new one, so the revealing button can hide safely. */
function reveal(count: number): void {
  const firstNew = displayed;
  appendBatch(count);
  const first = list.children[firstNew] as HTMLElement | undefined;
  // The note joins the sticky bar; measure it before scrolling so the new row lands below the whole bar.
  resultsFeedback.textContent = `Showing ${number(displayed)} of ${number(visible.length)}.`;
  syncControlsHeight();
  first?.focus({ preventScroll: true });
  first?.scrollIntoView({ block: 'start' });
}

showMore.addEventListener('click', () => reveal(batchSize));
showAll.addEventListener('click', () => reveal(showAllLimit));

cancel.addEventListener('click', () => scanController?.abort());
window.addEventListener('pagehide', () => scanController?.abort());

// The debounced results announcer already reports the filtered count; writing
// a second live status message here would announce every filter twice.
resultsSearch.addEventListener('input', onSearchInput);
resultsSort.addEventListener('change', renderResultsNow);
resultsMin.addEventListener('change', renderResultsNow);

resetFilters.addEventListener('click', () => {
  resultsSearch.value = '';
  resultsMin.value = '2';
  renderResultsNow();
  resultsSearch.focus();
  resultsFeedback.textContent = 'Search and filters cleared.';
});

// "/" is the common search shortcut; Escape clears the query before the popup closes.
// Ctrl/Cmd+F means "find in this list" here: the browser's own find-in-page bar
// cannot search a virtualized list and is useless inside an extension popup.
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.altKey) return;
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'f' && !results.hidden) {
    event.preventDefault();
    resultsSearch.focus();
    resultsSearch.select();
    return;
  }
  if (event.ctrlKey || event.metaKey) return;
  const target = event.target as HTMLElement | null;
  const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' ||
    target.tagName === 'TEXTAREA' || target.isContentEditable);
  if (event.key === '/' && !typing && !results.hidden) {
    event.preventDefault();
    resultsSearch.focus();
    resultsSearch.select();
    return;
  }
  if (event.key === 'Escape' && target === resultsSearch) {
    if (resultsSearch.value) {
      resultsSearch.value = '';
      renderResultsNow();
      resultsFeedback.textContent = '';
    } else {
      // Blurring would drop focus onto the body; the heading keeps keyboard users in the results.
      resultsTitle.focus();
    }
  }
});

copyResults.addEventListener('click', async () => {
  const scope = visible.length < groups.length ?
    `Filtered to ${number(visible.length)} of ${number(groups.length)} repeated songs.` : undefined;
  const text = formatResultsText(currentPlaylistName || 'Current playlist', visible, summarize(totalTracks, groups, unidentified), scanNotes, scope);
  if (await copyText(text)) {
    resultsFeedback.textContent = exportLabels(visible.length, visible.length < groups.length).copied;
  } else {
    resultsFeedback.textContent = 'Copy failed. Use CSV instead.';
  }
});

downloadResults.addEventListener('click', () => {
  downloadCsv();
  resultsFeedback.textContent = exportLabels(visible.length, visible.length < groups.length).downloaded;
});

clearResults.addEventListener('click', async () => {
  const completed = lastCompleted;
  if (!completed || clearingResults) return;
  clearCount++;
  clearingResults = true;
  clearResults.disabled = true;
  scan.disabled = true;
  await withScanCache(() => clearCachedScan(completed.cacheRef), undefined);
  clearingResults = false;
  clearResults.disabled = scanController !== null;
  scan.disabled = busy;
  if (lastCompleted !== completed) {
    replayRecheck();
    adoptScanRequest();
    return;
  }
  lastCompleted = null;
  clearGroups();
  setBadge(null);
  // A failed rescan was about the scan being cleared; the button goes back to a first scan.
  if (failure === 'rescan') failure = null;
  updateScanLabel();
  setStatus('Results cleared', scan.hidden ? 'This playlist cannot be scanned from here.' :
    source ? 'Run a scan to find repeated songs again.' : `Press ${scan.textContent}, then scan again.`);
  // The button that had focus is now hidden; keep keyboard users in the popup.
  focusScan();
  replayRecheck();
  adoptScanRequest();
});

function elapsedText(elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 60) return `${seconds}s elapsed`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m${remainder ? ` ${remainder}s` : ''} elapsed`;
}

/** One progress report as status text. A retry says so, because the wait looks like a freeze. */
function progressStatus(event: ScanProgress, keepNote: string): { title: string; detail: string } {
  const count = event.total === null ? number(event.retrieved) : `${number(event.retrieved)} of ${number(event.total)}`;
  const retrieved = `${count} songs retrieved · ${elapsedText(event.elapsedMs)}`;
  const keepOpen = `Keep this open while scanning.${keepNote}`;
  switch (event.phase) {
    case 'validating':
      return { title: 'Checking playlist…', detail: `${retrieved}\n${keepOpen}` };
    case 'retrying':
      return { title: 'Scanning playlist…',
        detail: `Apple Music is slow to respond. Retrying (${event.attempt} of ${event.attempts})…\n${retrieved}\n${keepOpen}` };
    case 'reading':
      return { title: 'Scanning playlist…', detail: `${retrieved}\n${keepOpen}` };
  }
}

function comparisonAnnouncement(comparison: NonNullable<CompletedScan['comparison']>): string {
  const text = comparison.kind === 'unavailable' ?
    'Some songs could not be identified in one of these scans, so changes cannot be confirmed.' : comparisonText(comparison.data);
  return `Since your last scan. ${text}`;
}

async function startScan(): Promise<void> {
  if (busy || clearingResults) return;
  if (!source || !currentPlaylist) { await initialize(); return; }
  if (pinnedTabId() === null && scanWindow.checked) {
    busy = true;
    // Disabling the focused Scan button would drop keyboard focus onto the body.
    const refocus = document.activeElement === scan;
    scan.disabled = true;
    updatePopOut();
    try {
      // A pop-out already open for this tab must not be duplicated: focus it and
      // hand the scan over through storage, the way a new window's startup scan
      // travels in its URL. Two windows scanning one playlist would double the
      // request volume against Apple Music.
      const tabId = connectedTabId;
      const existing = tabId === null ? null : await scanWindowForTab(tabId);
      if (existing !== null && tabId !== null) {
        try {
          await chrome.windows.update(existing, { focused: true });
          writeScanRequest(tabId, currentPlaylist.id,
            currentPlaylist.kind === 'catalog' ? (currentPlaylist.storefront ?? resolvedStorefront ?? undefined) : undefined);
          return;
        } catch { /* The matching window may have closed after enumeration. */ }
      }
      await openWindow(true);
    } catch {
      setStatus('Could not open a scan window', 'Try again, or turn off “Scan in a separate window” to scan here.');
    } finally {
      busy = false;
      scan.disabled = false;
      updatePopOut();
      if (refocus) focusScan();
    }
    return;
  }
  const scanTabId = connectedTabId;
  const playlist = currentPlaylist;
  const scanSource = source;
  // Claim busy/disabled synchronously before awaiting the per-tab Web Lock so
  // rapid re-clicks and callers awaiting button state cannot race the lock.
  const focusCancel = document.activeElement === scan;
  busy = true;
  scan.disabled = true;
  updatePopOut();
  const runScan = async (): Promise<void> => {
    failure = null;
    const age = Date.now() - pendingInfoAt;
    const regionlessCatalog = playlist.kind === 'catalog' && playlist.storefront === null;
    const baselineInfo = !regionlessCatalog && pendingInfo && age >= 0 && age <= pendingInfoMaxAgeMs ? pendingInfo : undefined;
    pendingInfo = null;
    const controller = new AbortController();
    scanController = controller;
    cancel.hidden = false;
    scan.textContent = 'Scanning…';
    if (focusCancel) cancel.focus();
    // The badge and the results on screen describe the last completed scan; keep
    // them (and the user's search/sort) until a new completed scan replaces them.
    // Clear stays unavailable so it cannot race the scan's own cache write.
    const showingPrevious = lastCompleted !== null;
    if (!showingPrevious) clearGroups();
    results.setAttribute('aria-busy', 'true');
    clearResults.disabled = true;
    resultsFeedback.textContent = '';
    const keepNote = showingPrevious ? '\nPrevious results stay visible until this scan completes.' : '';
    progress.hidden = false;
    progress.removeAttribute('value');
    scanDetails.open = true;
    setStatus('Scanning playlist…', `Connecting to Apple Music…${keepNote}`, { phase: 'reading' });
    // The first page shows at once; after that, steady reading updates are throttled.
    let lastReading = 0;
    let scanStorefront: string | undefined;
    let cancelHadFocus = false;
    try {
      const result = await readPlaylist({
        ...scanSource,
        metadata: async signal => {
          const info = await scanSource.metadata(signal);
          scanStorefront = info.storefront;
          return info;
        },
      }, event => {
        const timestamp = Date.now();
        if (event.phase === 'reading' && lastReading > 0 && timestamp - lastReading < statusThrottleMs) return;
        lastReading = event.phase === 'reading' && event.retrieved > 0 ? timestamp : 0;
        // The bar moves with the text, so the two never disagree.
        if (event.total !== null && event.total > 0) {
          progress.max = event.total;
          progress.value = event.retrieved;
        } else progress.removeAttribute('value');
        if (event.phase === 'reading') scanReading = { retrieved: event.retrieved, total: event.total };
        const { title, detail } = progressStatus(event, keepNote);
        setStatus(title, detail, { phase: event.phase });
      }, { signal: controller.signal, ...(baselineInfo ? { info: baselineInfo } : {}) });
      const duplicates = findDuplicates(result.tracks);
      currentPlaylistName = result.info.name;
      showPlaylistName(result.info.name, result.info.name);
      totalTracks = result.tracks.length;
      unidentified = duplicates.unidentified;
      const resultSummary = summarize(totalTracks, duplicates.groups, unidentified);
      scanNotes = scanNotesText(resultSummary, result.countVerified, result.modificationChecked);
      // Without results on screen, the caveats have nowhere else to go.
      const notesInStatus = duplicates.groups.length === 0 && scanNotes ? `\n${scanNotes}` : '';
      const scannedAt = Date.now();
      const storefront = playlist.kind === 'catalog' ? result.info.storefront ?? null : null;
      const playlistId = playlist.id;
      const cacheRef: ScanCacheRef = { playlistId, storefront, scannedAt, scanId: crypto.randomUUID() };
      const cachedPayload: CachedScan = {
        version: 1,
        ...cacheRef,
        playlistName: result.info.name,
        groups: duplicates.groups,
        unidentified,
        totalTracks,
        countVerified: result.countVerified,
        modificationChecked: result.modificationChecked,
        notes: scanNotes,
        modified: result.info.modified,
        revision: result.info.revision ?? null,
      };
      // Reading and validation already succeeded; hide Cancel before waiting on the cache lock.
      cancelHadFocus = document.activeElement === cancel;
      cancel.hidden = true;
      const { storedBaseline, saved } = await withScanCache(() => ({
        storedBaseline: loadCachedScan(playlistId, storefront),
        saved: saveCachedScan(cachedPayload),
      }), { storedBaseline: null, saved: false });
      const inMemory = (playlist.kind !== 'catalog' || lastCompleted?.cacheRef.storefront === storefront) ? lastCompleted : null;
      let previous: CompletedScan | CachedScan | null;
      if (inMemory && storedBaseline) {
        previous = inMemory.scannedAt > storedBaseline.scannedAt ? inMemory :
          storedBaseline.scannedAt > inMemory.scannedAt ? storedBaseline :
            inMemory.cacheRef.scanId === storedBaseline.scanId ? inMemory : storedBaseline;
      } else {
        previous = inMemory ?? storedBaseline;
      }
      const comparison: CompletedScan['comparison'] = previous === null ? null :
        previous.unidentified > 0 || unidentified > 0 ? { kind: 'unavailable', previousAt: previous.scannedAt } :
          { kind: 'compared', previousAt: previous.scannedAt, data: compareScans(previous.groups, duplicates.groups) };
      // With a list below, the summary stays one line; the date is on the next visit's "last scan".
      const scannedLine = duplicates.groups.length === 0 ? `\nScanned ${formatDate(scannedAt)}.` : '';
      scanController = null;
      setStatus(outcomeTitle[scanOutcome(resultSummary)], `${summaryLine(resultSummary)}${notesInStatus}${scannedLine}`,
        { announceExtra: comparison ? comparisonAnnouncement(comparison) : undefined });
      // Only this completed, fully validated scan may replace the last success.
      applyCompleted({
        playlistName: result.info.name,
        scannedAt,
        cacheRef,
        groups: duplicates.groups,
        totalTracks,
        unidentified,
        notes: scanNotes,
        cached: saved,
        modified: result.info.modified,
        revision: result.info.revision ?? null,
        comparison,
      });
      if (!saved) resultsFeedback.textContent = tooLargeToKeep;
    } catch (error) {
      if (regionlessCatalog && scanStorefront !== undefined && lastCompleted?.cacheRef.storefront !== scanStorefront) {
        lastCompleted = null;
      }
      // A failed or cancelled scan never replaces the last completed result. When
      // one exists, restore it and state plainly that it is not this scan's output.
      if (!lastCompleted) clearGroups();
      const cancelled = error instanceof ScanError && error.code === 'CANCELLED';
      const recovery = errorRecovery(error);
      // A cancel is the user's choice, not a failure: the ordinary scan button comes back.
      failure = cancelled ? null : recovery;
      const code = cancelled ? undefined : errorCode(error);
      if (lastCompleted) {
        const previous = lastCompleted;
        applyCompleted(previous);
        setStatus(cancelled ? 'Scan cancelled' : 'Scan failed',
          `${errorMessage(error)}\n${lastCompletedNotice(previous)}`, { error: !cancelled, code });
      } else {
        setBadge(null);
        setStatus(cancelled ? 'Scan cancelled' : 'Scan failed', errorMessage(error), { error: !cancelled, code });
      }
      if (recovery === 'reconnect') {
        source = null;
        currentPlaylist = null;
      }
    } finally {
      // Hiding the focused Cancel button would drop keyboard focus onto the body.
      const restoreFocus = cancelHadFocus || document.activeElement === cancel || document.activeElement === scan;
      busy = false;
      scanController = null;
      cancel.hidden = true;
      scan.disabled = clearingResults;
      results.removeAttribute('aria-busy');
      clearResults.disabled = false;
      updateScanLabel();
      updatePopOut();
      progress.hidden = true;
      scanReading = null;
      if (restoreFocus) focusScan();
      replayRecheck();
      if (!recheckPending && !busy) adoptScanRequest(true);
      syncDocumentTitle();
    }
  };
  if (scanTabId !== null && typeof navigator.locks?.request === 'function') {
    let competing = false;
    try {
      await navigator.locks.request(`amdf:scan-tab:${scanTabId}`, { ifAvailable: true }, async lock => {
        if (lock === null) {
          competing = true;
          return;
        }
        await runScan();
      });
    } catch {
      await runScan();
      return;
    }
    if (!competing) return;
    try {
      if (pinnedTabId() === null) {
        try {
          const existing = await scanWindowForTab(scanTabId);
          if (existing !== null) {
            await chrome.windows.update(existing, { focused: true });
            return;
          }
        } catch { /* The scan window may have closed after enumeration. */ }
      }
      setStatus('Scan already in progress', 'Another window is already scanning this tab.');
    } finally {
      busy = false;
      scan.disabled = clearingResults;
      updatePopOut();
      if (focusCancel) focusScan();
      replayRecheck();
      syncDocumentTitle();
    }
    return;
  }
  await runScan();
}

scan.addEventListener('click', () => { void startScan(); });

// Consume the handoff once. Reloading a scan window must not start another scan.
const startupUrl = new URL(location.href);
const requestedScan = startupUrl.searchParams.get('scan');
const requestedStorefrontRaw = startupUrl.searchParams.get('storefront');
if (requestedScan !== null || requestedStorefrontRaw !== null) {
  startupUrl.searchParams.delete('scan');
  startupUrl.searchParams.delete('storefront');
  history.replaceState(null, '', startupUrl.href);
}
const requestedStorefront = requestedStorefrontRaw !== null && /^[a-z]{2}$/.test(requestedStorefrontRaw) ? requestedStorefrontRaw : null;
const invalidStorefront = requestedStorefrontRaw !== null && requestedStorefront === null;
void initialize().then(() => {
  if (requestedScan !== null && pinnedTabId() !== null && currentPlaylist?.id === requestedScan && source && !failure &&
    !invalidStorefront && (requestedStorefront === null ||
      (currentPlaylist.kind === 'catalog' && (currentPlaylist.storefront ?? resolvedStorefront) === requestedStorefront))) {
    void startScan();
  }
});
