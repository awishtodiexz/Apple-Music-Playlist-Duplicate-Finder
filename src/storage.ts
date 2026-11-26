import { isThemePreference, type ThemePreference } from './theme';
import type { DuplicateGroup, PlaylistInfo } from './types';

const cacheKey = 'amdf:last-scan:v1';
export const themeKey = 'amdf:theme:v1';
export const scanWindowKey = 'amdf:scan-window:v1';
// Chromium allows 5,000,000 characters per origin; a full 50,000-track scan with
// 25,000 groups measures 2.97 MB, so this leaves headroom without risking quota errors.
const maxCacheChars = 4_500_000;
// The cache is untrusted persisted data. Keep it within the same bounds the
// scanner enforces so a corrupt or tampered entry cannot render an inconsistent
// or unbounded result set.
const maxTracks = 50_000;
const maxGroups = Math.floor(maxTracks / 2);
const maxText = 2_000;
const maxIdentity = 256;
const maxNotes = 20_000;
// ECMAScript's maximum valid Date value; larger timestamps render as "Invalid Date".
const maxTimestamp = 8_640_000_000_000_000;
const playlistIdPattern = /^(?:p|pl)\.[A-Za-z0-9_-]{1,126}$/;

export interface CachedScan {
  version: 1;
  playlistId: string;
  storefront?: string | null;
  /** Distinguishes two scans of the same playlist taken at the same millisecond. */
  scanId?: string;
  playlistName: string;
  scannedAt: number;
  groups: DuplicateGroup[];
  unidentified: number;
  totalTracks: number;
  countVerified: boolean;
  modificationChecked: boolean;
  notes: string;
  /** Metadata markers captured at scan time; absent in caches written before v1.2.1. */
  modified?: string | null;
  revision?: string | null;
}

export type CacheFreshness = 'current' | 'changed' | 'unknown';

/** The identity a conditional clear matches: only this exact scan may be removed. */
export type ScanCacheRef = Pick<CachedScan, 'playlistId' | 'storefront' | 'scannedAt' | 'scanId'>;

/**
 * A scan is stale when a known marker or the known track total differs. Every
 * marker available on both sides must agree: a matching modification date must
 * not hide a changed revision hash. Missing markers prove nothing.
 */
export function cacheFreshness(scan: Pick<CachedScan, 'totalTracks' | 'modified' | 'revision'>, info: PlaylistInfo): CacheFreshness {
  if (typeof info.total === 'number' && scan.totalTracks !== info.total) return 'changed';
  const comparable: Array<[string | null | undefined, string | null | undefined]> = [
    [scan.modified, info.modified],
    [scan.revision, info.revision],
  ];
  let matched = false;
  for (const [cached, current] of comparable) {
    if (!cached || !current) continue;
    if (cached !== current) return 'changed';
    matched = true;
  }
  return matched ? 'current' : 'unknown';
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPosition(value: unknown): value is number {
  return isCount(value) && value >= 1 && value <= maxTracks;
}

/**
 * A cached group must satisfy the same invariants the detector and reader
 * guarantee: one ascending, unique, one-based position per copy. A parsed JSON
 * cache is untrusted input, not a trusted typed value.
 */
function isGroup(value: unknown): value is DuplicateGroup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const group = value as Partial<DuplicateGroup>;
  if (typeof group.identity !== 'string' || group.identity.length === 0 ||
    group.identity.length > maxIdentity) return false;
  if (typeof group.name !== 'string' || group.name.length > maxText ||
    typeof group.artist !== 'string' || group.artist.length > maxText) return false;
  if (!isCount(group.copies) || group.copies <= 1 || !isCount(group.extraCopies) ||
    group.extraCopies !== group.copies - 1) return false;
  if (!Array.isArray(group.positions) || group.positions.length !== group.copies ||
    group.positions.length > maxTracks) return false;
  const { libraryIds } = group;
  if (libraryIds !== undefined && (!/^catalog:\d{1,128}$/.test(group.identity) ||
    !Array.isArray(libraryIds) || libraryIds.length > group.copies ||
    libraryIds.some(id => typeof id !== 'string' || id.length > 128 || !/^i\.[A-Za-z0-9-]+$/.test(id)) ||
    new Set(libraryIds).size !== libraryIds.length)) return false;
  let previous = 0;
  for (const position of group.positions) {
    if (!isPosition(position) || position <= previous) return false;
    previous = position;
  }
  return true;
}

function optionalText(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.length <= maxText);
}

function isCachedScan(value: unknown): value is CachedScan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const scan = value as Partial<CachedScan>;
  const { version, playlistId, playlistName, scannedAt, groups, unidentified, totalTracks } = scan;
  if (version !== 1 || typeof playlistId !== 'string' || !playlistIdPattern.test(playlistId) ||
    typeof playlistName !== 'string' || playlistName.length > maxText ||
    !isCount(scannedAt) || scannedAt <= 0 || scannedAt > maxTimestamp ||
    !Array.isArray(groups) || groups.length > maxGroups ||
    !isCount(unidentified) || unidentified > maxTracks ||
    !isCount(totalTracks) || totalTracks > maxTracks || unidentified > totalTracks ||
    typeof scan.countVerified !== 'boolean' || typeof scan.modificationChecked !== 'boolean' ||
    typeof scan.notes !== 'string' || scan.notes.length > maxNotes ||
    !optionalText(scan.modified) || !optionalText(scan.revision) ||
    !(scan.storefront == null || typeof scan.storefront === 'string' && /^[a-z]{2}$/.test(scan.storefront)) ||
    !(scan.scanId === undefined || typeof scan.scanId === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(scan.scanId))) return false;
  // Every track is either unidentified or belongs to exactly one retained group,
  // so these totals bound the whole cache and catch inconsistent copies/counts.
  const identities = new Set<string>();
  const usedPositions = new Set<number>();
  let copies = 0;
  for (const group of groups) {
    if (!isGroup(group) || identities.has(group.identity)) return false;
    identities.add(group.identity);
    copies += group.copies;
    if (copies + unidentified > totalTracks) return false;
    for (const position of group.positions) {
      if (position > totalTracks || usedPositions.has(position)) return false;
      usedPositions.add(position);
    }
  }
  return true;
}

function discardCached(store: Storage): void {
  try { store.removeItem(cacheKey); } catch { /* ignore */ }
}

function readCachedScan(store: Storage): CachedScan | null {
  try {
    const raw = store.getItem(cacheKey);
    if (!raw) return null;
    if (raw.length > maxCacheChars) { discardCached(store); return null; }
    let value: unknown;
    try { value = JSON.parse(raw); } catch { discardCached(store); return null; }
    if (!isCachedScan(value)) { discardCached(store); return null; }
    return value;
  } catch {
    return null;
  }
}

/** The last completed scan is cached locally so closing the popup does not lose it. */
export function loadCachedScan(playlistId: string, storefront: string | null = null): CachedScan | null {
  const store = storage();
  if (!store) return null;
  const scan = readCachedScan(store);
  return scan && scan.playlistId === playlistId &&
    (!playlistId.startsWith('pl.') || (storefront !== null && scan.storefront === storefront)) ? scan : null;
}

function writeCachedScan(store: Storage, raw: string): boolean {
  if (raw.length > maxCacheChars) return false;
  try {
    store.setItem(cacheKey, raw);
    return true;
  } catch {
    return false;
  }
}

/** Returns false when the result is too large or storage is unavailable; never throws. */
export function saveCachedScan(scan: CachedScan): boolean {
  const store = storage();
  if (!store) return false;
  try {
    if (!isCachedScan(scan)) { discardCached(store); return false; }
    if (writeCachedScan(store, JSON.stringify(scan))) return true;
    if (scan.groups.some(group => group.libraryIds !== undefined)) {
      const groups = scan.groups.map(({ libraryIds, ...group }) => group);
      if (writeCachedScan(store, JSON.stringify({ ...scan, groups }))) return true;
    }
  } catch { /* ignore */ }
  // Never leave a superseded cache behind when the replacement failed.
  discardCached(store);
  return false;
}

/** Removes only the scan the caller was shown; a newer scan saved meanwhile is kept. */
export function clearCachedScan(expected: ScanCacheRef): void {
  const store = storage();
  if (!store) return;
  const scan = readCachedScan(store);
  if (scan && scan.playlistId === expected.playlistId && (scan.storefront ?? null) === (expected.storefront ?? null) &&
    scan.scannedAt === expected.scannedAt && scan.scanId === expected.scanId) discardCached(store);
}

/** Missing, unreadable, or unknown values fall back to the system theme. */
export function loadThemePreference(): ThemePreference {
  const store = storage();
  if (!store) return 'auto';
  try {
    const value = store.getItem(themeKey);
    return isThemePreference(value) ? value : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveThemePreference(preference: ThemePreference): void {
  const store = storage();
  if (!store) return;
  try { store.setItem(themeKey, preference); } catch { /* ignore */ }
}

/** Scans use a persistent window unless the user explicitly chooses the popup. */
export function loadScanWindowPreference(): boolean {
  try { return storage()?.getItem(scanWindowKey) !== 'false'; } catch { return true; }
}

export function saveScanWindowPreference(enabled: boolean): void {
  try { storage()?.setItem(scanWindowKey, String(enabled)); } catch { /* ignore */ }
}

// A scan handed off to an already-open pop-out cannot travel in the URL the way a
// new window's startup scan does, so it is written here; the pop-out's storage
// listener picks it up. Each tab has its own entry so simultaneous handoffs cannot
// overwrite one another. A request older than 45 seconds never arrived.
export const scanRequestKey = 'amdf:scan-request:v1';
export const scanRequestKeyForTab = (tabId: number): string => `${scanRequestKey}:${tabId}`;
const scanRequestMaxAgeMs = 45_000;

export interface ScanRequest {
  tab: number;
  at: number;
  playlist?: string;
  storefront?: string;
}

/** Never throws; a missing or full storage simply drops the request. */
export function writeScanRequest(tabId: number, playlistId?: string, storefront?: string): void {
  const store = storage();
  if (!store) return;
  const validStorefront = storefront !== undefined && /^[a-z]{2}$/.test(storefront) && playlistId?.startsWith('pl.') ? storefront : undefined;
  try {
    store.setItem(scanRequestKeyForTab(tabId), JSON.stringify({ tab: tabId, at: Date.now(),
      ...(playlistId ? { playlist: playlistId } : {}), ...(validStorefront ? { storefront: validStorefront } : {}) }));
  } catch { /* ignore */ }
}

/** Validates an untrusted stored payload: right shape, plausible tab id and playlist, and fresh. */
export function readScanRequest(raw: string, now: number = Date.now()): ScanRequest | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const request = value as Partial<ScanRequest>;
  if (!isCount(request.tab) || request.tab < 1 || typeof request.at !== 'number' ||
    !Number.isFinite(request.at) || request.at <= 0 ||
    !(request.playlist === undefined || typeof request.playlist === 'string' && playlistIdPattern.test(request.playlist)) ||
    !(request.storefront === undefined || typeof request.storefront === 'string' && /^[a-z]{2}$/.test(request.storefront) &&
      request.playlist?.startsWith('pl.'))) return null;
  const age = now - request.at;
  if (age < 0 || age > scanRequestMaxAgeMs) return null;
  return { tab: request.tab, at: request.at, ...(request.playlist ? { playlist: request.playlist } : {}),
    ...(request.storefront ? { storefront: request.storefront } : {}) };
}

/** The live stored request plus its exact raw payload, so consuming it cannot remove a newer write. */
export function storedScanRequest(tabId: number, now: number = Date.now()): { raw: string; request: ScanRequest } | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(scanRequestKeyForTab(tabId));
    if (!raw) return null;
    const request = readScanRequest(raw, now);
    return request?.tab === tabId ? { raw, request } : null;
  } catch {
    return null;
  }
}

/** Removes only the request the caller was shown; returns true only when that exact entry was removed. */
export function consumeScanRequest(tabId: number, expected: string): boolean {
  const store = storage();
  if (!store) return false;
  const key = scanRequestKeyForTab(tabId);
  try {
    if (store.getItem(key) !== expected) return false;
    store.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
