import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { musicKitBridge } from '../src/musickit-bridge';
import type { BridgeRequest, TrackPage } from '../src/types';

type Reply = Awaited<ReturnType<typeof musicKitBridge>>;

const FIXTURES = 'tests/fixtures/musickit';
const fixture = (name: string): unknown => JSON.parse(readFileSync(`${FIXTURES}/${name}.json`, 'utf8'));

const playlist = { id: 'p.fixture', kind: 'library' as const, storefront: 'us' };
const tracksRequest: BridgeRequest = { action: 'tracks', playlist, offset: 0 };
const metadataRequest: BridgeRequest = { action: 'metadata', playlist };
const metadataPath = '/v1/me/library/playlists/p.fixture';
const tracksPath = '/v1/me/library/playlists/p.fixture/tracks?limit=100&offset=0&include=catalog';

// Mirrors setup() in tests/musickit-bridge.test.ts: page-world mocks stay out of
// module scope, and instanceExtra can replace api with a v3 { music } surface.
function makeInstance(get: (path: string) => unknown, instanceExtra: Record<string, unknown>) {
  return Object.defineProperties(
    { isAuthorized: true, api: { get(path: string) { return get(path); } } },
    Object.getOwnPropertyDescriptors(instanceExtra),
  );
}

// Drives each fixture through the imported bridge (globalThis.window, as in
// tests/musickit-bridge.test.ts) and through the serialized bridge in a fresh vm
// context (as in tests/bridge-isolation.test.ts), the way chrome.scripting runs it.
async function readVia(req: BridgeRequest, get: (path: string) => unknown,
  instanceExtra: Record<string, unknown> = {}): Promise<Reply> {
  const win = {
    location: { origin: 'https://music.apple.com', pathname: '/us/library/playlist/p.fixture' },
    MusicKit: { getInstance: () => makeInstance(get, instanceExtra) },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  };
  Object.defineProperty(globalThis, 'window', { value: win, writable: true, configurable: true });
  const direct = await musicKitBridge(req);
  const context = vm.createContext({ window: win, setTimeout, clearTimeout, AbortController, URL, Promise });
  const source = '(' + musicKitBridge.toString() + ')';
  const serialized = await vm.runInContext(source, context, { timeout: 5_000 })(req);
  assert.equal(JSON.stringify(serialized), JSON.stringify(direct));
  return direct;
}

function v3(body: unknown, path: string) {
  return { api: { music: async (requested: string) => { assert.equal(requested, path); return body; } } };
}

function expectPage(reply: Reply, nextOffset: number | null): TrackPage {
  assert.equal(reply.ok, true, JSON.stringify(reply));
  if (!reply.ok) throw new Error('unreachable');
  const page = reply.data as TrackPage;
  assert.deepEqual(page.tracks.map(track => track.position), [1, 2, 3]);
  assert.equal(page.total, 3);
  assert.equal(page.nextOffset, nextOffset);
  return page;
}

test('v3 metadata fixture resolves the sanitized playlist info', async () => {
  const reply = await readVia(metadataRequest, () => assert.fail('legacy get should not be used'),
    v3(fixture('v3-metadata'), metadataPath));
  assert.deepEqual(reply, {
    ok: true,
    data: { name: 'Fixture playlist', total: 3, modified: '2026-01-01T00:00:00Z' },
  });
});

test('v3 tracks fixture resolves three ordered tracks and a next offset', async () => {
  const reply = await readVia(tracksRequest, () => assert.fail('legacy get should not be used'),
    v3(fixture('v3-tracks'), tracksPath));
  const page = expectPage(reply, 3);
  assert.deepEqual(page.tracks.map(track => track.catalogId), ['1001', '1002', '1003']);
});

test('legacy and nested tracks fixtures resolve three ordered tracks', async () => {
  for (const name of ['legacy-tracks', 'nested-tracks']) {
    const reply = await readVia(tracksRequest, path => {
      assert.equal(path, tracksPath);
      return fixture(name);
    });
    expectPage(reply, null);
  }
});

test('auth fixture maps to AUTH', async () => {
  const reply = await readVia(tracksRequest, () => fixture('auth-401'));
  assert.deepEqual(reply, { ok: false, code: 'AUTH' });
});

test('rate-limit fixture maps to RATE_LIMIT with retryAfterMs', async () => {
  const reply = await readVia(tracksRequest, () => fixture('rate-limit-429'));
  assert.deepEqual(reply, { ok: false, code: 'RATE_LIMIT', retryAfterMs: 2000 });
});

test('a renamed data envelope fails closed with FORMAT', async () => {
  const reply = await readVia(tracksRequest, () => fixture('malformed-envelope'));
  assert.deepEqual(reply, { ok: false, code: 'FORMAT' });
});

test('fixtures contain no credential-like keys', () => {
  const banned = ['devToken', 'userToken', 'authorization', 'cookie', 'set-cookie'];
  const files = readdirSync(FIXTURES).filter(name => name.endsWith('.json'));
  assert.ok(files.length >= 6);
  for (const file of files) {
    const lower = readFileSync(`${FIXTURES}/${file}`, 'utf8').toLowerCase();
    for (const key of banned) {
      assert.equal(lower.includes(key.toLowerCase()), false, `${file} contains ${key}`);
    }
  }
});
