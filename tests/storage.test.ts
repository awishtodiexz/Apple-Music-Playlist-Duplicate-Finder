import assert from 'node:assert/strict';
import test from 'node:test';
import { cacheFreshness, clearCachedScan, loadCachedScan, loadScanWindowPreference, loadThemePreference, saveCachedScan, saveScanWindowPreference, saveThemePreference, type CachedScan } from '../src/storage';
import type { DuplicateGroup } from '../src/types';

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } as Storage,
});

const group: DuplicateGroup = {
  identity: 'catalog:1', name: 'Numb', artist: 'Linkin Park',
  positions: [1, 101, 245], copies: 3, extraCopies: 2,
};
const scan: CachedScan = {
  version: 1, playlistId: 'p.fixture', playlistName: 'Fixture', scannedAt: 1_760_000_000_000,
  groups: [group], unidentified: 0, totalTracks: 245,
  countVerified: true, modificationChecked: true, notes: 'Markers matched.',
};

test('scan windows default on, remember the choice, and tolerate corrupt preferences', () => {
  values.delete('amdf:scan-window:v1');
  assert.equal(loadScanWindowPreference(), true);
  saveScanWindowPreference(false);
  assert.equal(loadScanWindowPreference(), false);
  saveScanWindowPreference(true);
  assert.equal(loadScanWindowPreference(), true);
  values.set('amdf:scan-window:v1', 'invalid');
  assert.equal(loadScanWindowPreference(), true);
});

test('a cached scan round-trips only for the same playlist', () => {
  values.clear();
  assert.equal(saveCachedScan(scan), true);
  assert.deepEqual(loadCachedScan('p.fixture'), scan);
  assert.equal(loadCachedScan('p.other'), null);
});

test('a cached scan round-trips exact library IDs for rescan comparisons', () => {
  const aliased = { ...scan, groups: [{ ...group, libraryIds: ['i.first', 'i.second'] }] };
  assert.equal(saveCachedScan(aliased), true);
  assert.deepEqual(loadCachedScan('p.fixture'), aliased);
});

test('v1.2.5 cache and theme storage remain readable without migration', () => {
  // v1.2.5 wrote these exact keys and CachedScan version 1. Keep existing
  // users' cached last scan and theme preference across the 1.3.0 update.
  const legacy = {
    version: 1 as const,
    playlistId: 'p.fixture',
    playlistName: 'Fixture',
    scannedAt: 1_760_000_000_000,
    groups: [{ identity: 'catalog:1', name: 'Numb', artist: 'Linkin Park', positions: [1, 101, 245], copies: 3, extraCopies: 2 }],
    unidentified: 0,
    totalTracks: 245,
    countVerified: true,
    modificationChecked: true,
    notes: 'Markers matched.',
    modified: '2026-10-23T00:00:00Z',
    revision: 'v1',
  };
  values.set('amdf:last-scan:v1', JSON.stringify(legacy));
  assert.deepEqual(loadCachedScan('p.fixture'), legacy);
  values.set('amdf:theme:v1', 'dark');
  assert.equal(loadThemePreference(), 'dark');
});

test('corrupt or invalid cached data is ignored', () => {
  values.set('amdf:last-scan:v1', '{not json');
  assert.equal(loadCachedScan('p.fixture'), null);
  values.set('amdf:last-scan:v1', JSON.stringify({ ...scan, groups: [{ ...group, positions: ['1'] }] }));
  assert.equal(loadCachedScan('p.fixture'), null);
});

function writeRawCache(value: unknown): void {
  values.set('amdf:last-scan:v1', JSON.stringify(value));
}

test('schema-inconsistent cached scans are rejected', () => {
  const cases: Array<[string, unknown]> = [
    ['positions length differs from copies', { ...scan, groups: [{ ...group, positions: [1, 101] }] }],
    ['position zero', { ...scan, groups: [{ ...group, positions: [0, 101, 245] }] }],
    ['unsorted positions', { ...scan, groups: [{ ...group, positions: [1, 245, 101] }] }],
    ['duplicate positions', { ...scan, groups: [{ ...group, positions: [1, 1, 245] }] }],
    ['position beyond the scanned total', { ...scan, totalTracks: 200 }],
    ['unidentified entries beyond the scanned total', { ...scan, unidentified: 246 }],
    ['duplicate group identities', { ...scan, groups: [group, group] }],
    ['overlapping positions across groups', {
      ...scan,
      groups: [group, { identity: 'catalog:2', name: 'Other', artist: 'Artist', positions: [1, 2, 3], copies: 3, extraCopies: 2 }],
    }],
    ['invalid scan timestamp', { ...scan, scannedAt: 0 }],
    ['storefront is not a string', { ...scan, storefront: ['us'] }],
    ['oversized song text', { ...scan, groups: [{ ...group, name: 'x'.repeat(2001) }] }],
    ['aliases on a library-only group', { ...scan, groups: [{ ...group, identity: 'library:i.one', libraryIds: ['i.one'] }] }],
    ['aliases are not an array', { ...scan, groups: [{ ...group, libraryIds: 'i.one' }] }],
    ['more aliases than copies', { ...scan, groups: [{ ...group, libraryIds: ['i.a', 'i.b', 'i.c', 'i.d'] }] }],
    ['invalid library IDs', { ...scan, groups: [{ ...group, libraryIds: ['1001'] }] }],
    ['repeated library IDs', { ...scan, groups: [{ ...group, libraryIds: ['i.one', 'i.one'] }] }],
  ];
  for (const [label, value] of cases) {
    writeRawCache(value);
    assert.equal(loadCachedScan('p.fixture'), null, label);
  }
});

test('a consistent multi-group cache is still accepted', () => {
  writeRawCache({
    ...scan,
    groups: [group, { identity: 'catalog:2', name: 'Other', artist: 'Artist', positions: [2, 3], copies: 2, extraCopies: 1 }],
  });
  assert.equal(loadCachedScan('p.fixture')?.groups.length, 2);
});

test('a cached group with inconsistent copy counts is rejected', () => {
  values.set('amdf:last-scan:v1', JSON.stringify({
    ...scan,
    groups: [{ ...group, copies: 3, extraCopies: 1 }],
  }));
  assert.equal(loadCachedScan('p.fixture'), null);
});

test('oversized results are refused and do not leave stale data behind', () => {
  values.clear();
  assert.equal(saveCachedScan({ ...scan, groups: [{ ...group, name: 'x'.repeat(5_000_000) }] }), false);
  assert.equal(loadCachedScan('p.fixture'), null);
});

test('a full 50,000-track result set fits the cache', () => {
  values.clear();
  const groups = Array.from({ length: 25_000 }, (_, index) => ({
    identity: `catalog:${index}`,
    name: `Song ${index}`,
    artist: 'Artist',
    positions: [index * 2 + 1, index * 2 + 2],
    copies: 2,
    extraCopies: 1,
  }));
  assert.equal(saveCachedScan({ ...scan, groups, totalTracks: 50_000 }), true);
  assert.equal(loadCachedScan('p.fixture')?.groups.length, 25_000);
});

test('a 50,000-track cache saves without library IDs when they push it over the size cap', () => {
  let position = 0;
  const groups = Array.from({ length: 16_000 }, (_, index) => {
    const copies = index < 2_000 ? 4 : 3;
    return {
      ...group,
      identity: `catalog:1${String(index).padStart(127, '0')}`,
      positions: Array.from({ length: copies }, () => ++position),
      copies,
      extraCopies: copies - 1,
    };
  });
  assert.equal(position, 50_000);
  const compact = { ...scan, groups, totalTracks: position };
  const aliased = {
    ...compact,
    groups: groups.map(group => ({
      ...group, libraryIds: group.positions.map(position => `i.${String(position).padStart(126, 'a')}`),
    })),
  };
  const compactRaw = JSON.stringify(compact);
  assert.ok(compactRaw.length <= 4_500_000);
  assert.ok(JSON.stringify(aliased).length > 4_500_000);
  assert.equal(saveCachedScan(compact), true);
  assert.equal(saveCachedScan(aliased), true);
  assert.equal(values.get('amdf:last-scan:v1'), compactRaw);
  assert.deepEqual(loadCachedScan('p.fixture'), compact);
  assert.equal(aliased.groups[0]?.libraryIds.length, 4);
});

test('a storage quota error retries with the original payload size', t => {
  const compactRaw = JSON.stringify(scan);
  const aliased = { ...scan, groups: [{ ...group, libraryIds: ['i.one'] }] };
  const { setItem } = localStorage;
  const writes = t.mock.method(localStorage, 'setItem', (key: string, value: string) => {
    if (value.length > compactRaw.length) throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
    setItem(key, value);
  });
  assert.equal(saveCachedScan(aliased), true);
  assert.equal(writes.mock.callCount(), 2);
  assert.equal(values.get('amdf:last-scan:v1'), compactRaw);
});

test('if both cache writes fail, the superseded scan is removed and nothing is saved', t => {
  const cacheKey = 'amdf:last-scan:v1';
  assert.equal(saveCachedScan(scan), true);
  assert.deepEqual(loadCachedScan('p.fixture'), scan);
  const compact = { ...scan, scannedAt: scan.scannedAt + 60_000 };
  const aliased = { ...compact, groups: [{ ...group, libraryIds: ['i.one'] }] };
  const writes = t.mock.method(localStorage, 'setItem', () => {
    throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
  });

  assert.equal(saveCachedScan(aliased), false);
  assert.deepEqual(writes.mock.calls.map(call => call.arguments), [
    [cacheKey, JSON.stringify(aliased)],
    [cacheKey, JSON.stringify(compact)],
  ]);
  assert.equal(values.has(cacheKey), false);
  assert.equal(loadCachedScan('p.fixture'), null);
});

test('a completed scan replaces the previous cached scan', () => {
  values.clear();
  assert.equal(saveCachedScan(scan), true);
  const newer: CachedScan = { ...scan, scannedAt: scan.scannedAt + 60_000, groups: [], unidentified: 0, totalTracks: 245 };
  assert.equal(saveCachedScan(newer), true);
  assert.equal(loadCachedScan('p.fixture')?.scannedAt, scan.scannedAt + 60_000);
  assert.deepEqual(loadCachedScan('p.fixture')?.groups, []);
});

test('clearing removes the cached scan', () => {
  assert.equal(saveCachedScan(scan), true);
  clearCachedScan(scan);
  assert.equal(loadCachedScan('p.fixture'), null);
});

test('clearing removes only the exact scan it was shown for', () => {
  values.clear();
  const original: CachedScan = { ...scan, scanId: 'aaaaaaaa-1111-2222-3333-444444444444' };
  assert.equal(saveCachedScan(original), true);
  // A stale clear must not remove the newer scan another window saved meanwhile.
  const newer: CachedScan = {
    ...original, scannedAt: original.scannedAt + 60_000, scanId: 'bbbbbbbb-1111-2222-3333-444444444444',
  };
  assert.equal(saveCachedScan(newer), true);
  clearCachedScan(original);
  assert.deepEqual(loadCachedScan('p.fixture'), newer);
  // A clear naming another playlist leaves this scan alone.
  clearCachedScan({ playlistId: 'p.other', storefront: null, scannedAt: newer.scannedAt, scanId: newer.scanId });
  assert.deepEqual(loadCachedScan('p.fixture'), newer);
  // The same playlist and timestamp with a different scan ID is a different scan.
  clearCachedScan({ playlistId: 'p.fixture', storefront: null, scannedAt: newer.scannedAt,
    scanId: 'cccccccc-1111-2222-3333-444444444444' });
  assert.deepEqual(loadCachedScan('p.fixture'), newer);
  clearCachedScan(newer);
  assert.equal(loadCachedScan('p.fixture'), null);
});

test('clearing with unavailable storage is a safe no-op', () => {
  const real = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => { throw new Error('storage blocked'); },
  });
  try {
    clearCachedScan(scan);
    assert.equal(loadCachedScan('p.fixture'), null);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: real });
  }
});

test('cache freshness compares modification and revision markers', () => {
  const info = { name: 'P', total: 245, modified: null, revision: null };
  assert.equal(cacheFreshness({ ...scan, modified: 'a' }, { ...info, modified: 'a' }), 'current');
  assert.equal(cacheFreshness({ ...scan, modified: 'a' }, { ...info, modified: 'b' }), 'changed');
  assert.equal(cacheFreshness({ ...scan, modified: 'a' }, info), 'unknown');
  assert.equal(cacheFreshness(scan, { ...info, modified: 'x' }), 'unknown');
  assert.equal(cacheFreshness({ ...scan, modified: null, revision: 'r1' }, { ...info, revision: 'r1' }), 'current');
  assert.equal(cacheFreshness({ ...scan, modified: null, revision: 'r1' }, { ...info, revision: 'r2' }), 'changed');
  assert.equal(cacheFreshness({ ...scan, modified: null, revision: 'r1' }, info), 'unknown');
});

test('cache freshness is changed when any shared marker differs', () => {
  const info = { name: 'P', total: 245, modified: null, revision: null };
  // A same modification date does not hide a changed revision hash.
  assert.equal(cacheFreshness(
    { ...scan, modified: 'a', revision: 'r1' },
    { ...info, modified: 'a', revision: 'r2' },
  ), 'changed');
  assert.equal(cacheFreshness(
    { ...scan, modified: 'a', revision: 'r1' },
    { ...info, modified: 'a', revision: 'r1' },
  ), 'current');
  // A marker that exists on only one side cannot contradict the matching one.
  assert.equal(cacheFreshness(
    { ...scan, modified: 'a', revision: 'r1' },
    { ...info, modified: 'a', revision: null },
  ), 'current');
  assert.equal(cacheFreshness(
    { ...scan, modified: 'a', revision: null },
    { ...info, modified: 'a', revision: 'r1' },
  ), 'current');
});

test('cache freshness treats a changed known total as a playlist change', () => {
  const info = { name: 'P', total: 245, modified: null, revision: null };
  assert.equal(cacheFreshness({ ...scan, totalTracks: 245 }, info), 'unknown');
  assert.equal(cacheFreshness({ ...scan, totalTracks: 244 }, info), 'changed');
  assert.equal(cacheFreshness({ ...scan, totalTracks: 245, modified: 'm' }, { ...info, modified: 'm' }), 'current');
});

test('metadata markers survive a cache round-trip', () => {
  values.clear();
  assert.equal(saveCachedScan({ ...scan, modified: 'm', revision: 'r' }), true);
  const loaded = loadCachedScan('p.fixture');
  assert.equal(loaded?.modified, 'm');
  assert.equal(loaded?.revision, 'r');
});

test('the theme preference defaults to auto and survives a round-trip', () => {
  values.delete('amdf:theme:v1');
  assert.equal(loadThemePreference(), 'auto');
  saveThemePreference('dark');
  assert.equal(loadThemePreference(), 'dark');
});

test('an unknown or corrupt theme preference falls back to auto', () => {
  values.set('amdf:theme:v1', 'purple');
  assert.equal(loadThemePreference(), 'auto');
  values.set('amdf:theme:v1', '');
  assert.equal(loadThemePreference(), 'auto');
});

test('catalog cache is scoped to a known storefront', () => {
  const catalog = { ...scan, playlistId: 'pl.fixture', storefront: 'us' };
  assert.equal(saveCachedScan(catalog), true);
  assert.deepEqual(loadCachedScan('pl.fixture', 'us'), catalog);
  assert.equal(loadCachedScan('pl.fixture', 'gb'), null);
  assert.equal(loadCachedScan('pl.fixture', null), null);
});
