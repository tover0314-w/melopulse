import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeMeloLabCatalogue, syncMeloLabCatalogue } from '../../src/catalog/melolab.js';
import { CatalogStorage } from '../../src/catalog/storage.js';
import type { PlaylistRecord } from '../../src/schema.js';

const fixture = {
  playlists: [{
    id: 'launch-showcase-playlist-focus-flow',
    name: 'Focus Flow',
    description: 'Soft lo-fi, ambient, and downtempo pieces for deep work.',
    cover_url: 'https://melolab.ai/cover.jpg',
    is_public: true,
    song_count: 6,
  }],
};

const cachedPlaylist: PlaylistRecord = {
  id: 'melolab:cached',
  source: 'melolab',
  title: 'Cached playlist',
  url: 'https://melolab.ai/playlist/cached',
  activityTags: ['deep_focus'],
  moodTags: [],
  energy: 'medium',
  focus: 'medium',
  vocals: 'any',
};

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function responseWithDelayedJson(body: unknown, delayMs: number): Response {
  return {
    ok: true,
    status: 200,
    json: () => new Promise((resolve) => setTimeout(() => resolve(body), delayMs)),
  } as unknown as Response;
}

class DelayedSaveCatalogStorage extends CatalogStorage {
  private nextSaveDelay: Promise<void> | null = null;
  private onSaveStart: (() => void) | null = null;

  delayNextSave(delay: Promise<void>, onStart: () => void): void {
    this.nextSaveDelay = delay;
    this.onSaveStart = onStart;
  }

  override async saveMeloLabCache(records: PlaylistRecord[]): Promise<void> {
    const delay = this.nextSaveDelay;
    const onStart = this.onSaveStart;
    this.nextSaveDelay = null;
    this.onSaveStart = null;
    onStart?.();
    if (delay) await delay;
    await super.saveMeloLabCache(records);
  }
}

async function temporaryStorage(): Promise<{ storage: CatalogStorage; cachePath: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'melopulse-melolab-'));
  tempDirectories.push(directory);
  return { storage: new CatalogStorage(directory), cachePath: join(directory, 'melolab-catalog-cache.json') };
}

describe('MeloLab catalogue normalization', () => {
  it('derives canonical focus metadata from the public route contract', () => {
    const [playlist] = normalizeMeloLabCatalogue(fixture);

    expect(playlist).toMatchObject({
      id: 'melolab:launch-showcase-playlist-focus-flow',
      source: 'melolab',
      title: 'Focus Flow',
      url: 'https://melolab.ai/playlist/launch-showcase-playlist-focus-flow',
      activityTags: ['deep_focus', 'debugging', 'reviewing'],
      energy: 'low',
      focus: 'high',
      vocals: 'none',
    });
  });

  it.each([
    ['Suno Spotlight', ['feature', 'shipping'], 'high', 'medium', 'any'],
    ['Open Road Cinema', ['reviewing', 'maintenance'], 'medium', 'high', 'low'],
    ['After Dark R&B', ['maintenance', 'deep_focus'], 'low', 'medium', 'any'],
    ['Untitled collection', ['deep_focus'], 'medium', 'medium', 'any'],
  ] as const)('assigns the %s tag profile', (name, activityTags, energy, focus, vocals) => {
    const [playlist] = normalizeMeloLabCatalogue({
      playlists: [{ id: name.toLowerCase().replaceAll(' ', '-'), name, is_public: true }],
    });

    expect(playlist).toMatchObject({ activityTags, energy, focus, vocals });
  });

  it('omits records that are not public', () => {
    expect(normalizeMeloLabCatalogue({
      playlists: [
        { id: 'public', name: 'Public', is_public: true },
        { id: 'private', name: 'Private', is_public: false },
      ],
    }).map((playlist) => playlist.id)).toEqual(['melolab:public']);
  });

  it('encodes a remote ID as one canonical URL path segment', () => {
    const [playlist] = normalizeMeloLabCatalogue({
      playlists: [{ id: 'focus ?/# space', name: 'Focus', is_public: true }],
    });

    expect(playlist).toMatchObject({
      id: 'melolab:focus ?/# space',
      url: 'https://melolab.ai/playlist/focus%20%3F%2F%23%20space',
    });
  });

  it('resolves a MeloLab root-relative cover path from the public route', () => {
    const [playlist] = normalizeMeloLabCatalogue({
      playlists: [{
        id: 'launch-showcase-playlist-rain-on-loop',
        name: 'Rain on Loop',
        description: 'A public showcase playlist.',
        cover_url: '/assets/showcase/launch/covers/rain-on-loop.webp',
        is_public: true,
        song_count: 6,
      }],
    });

    expect(playlist?.coverUrl).toBe('https://melolab.ai/assets/showcase/launch/covers/rain-on-loop.webp');
  });

  it('canonicalizes a mixed-case absolute HTTPS cover URL', () => {
    const [playlist] = normalizeMeloLabCatalogue({
      playlists: [{
        id: 'mixed-case-cover',
        name: 'Mixed Case Cover',
        cover_url: 'HTTPS://cdn.example/cover.jpg',
        is_public: true,
      }],
    });

    expect(playlist?.coverUrl).toBe('https://cdn.example/cover.jpg');
  });

  it.each([
    '//evil.example/cover.jpg',
    'http://melolab.ai/cover.jpg',
    'https://user:pass@melolab.ai/cover.jpg',
    'assets/showcase/cover.jpg',
    '/\\evil.example/cover.jpg',
  ])('rejects unsafe cover URL %s', (coverUrl) => {
    expect(() => normalizeMeloLabCatalogue({
      playlists: [{ id: 'unsafe-cover', name: 'Unsafe Cover', cover_url: coverUrl, is_public: true }],
    })).toThrow();
  });
});

describe('MeloLab catalogue synchronization', () => {
  it('saves and returns a normalized valid response', async () => {
    const { storage } = await temporaryStorage();

    const result = await syncMeloLabCatalogue({ storage, fetchImpl: async () => response(fixture) });

    expect(result).toMatchObject({ count: 1, playlists: normalizeMeloLabCatalogue(fixture) });
    expect(await storage.loadMeloLabCache()).toEqual(result.playlists);
  });

  it('rejects an HTTP error without changing the existing cache bytes', async () => {
    const { storage, cachePath } = await temporaryStorage();
    await storage.saveMeloLabCache([cachedPlaylist]);
    const cacheBefore = await readFile(cachePath, 'utf8');

    await expect(syncMeloLabCatalogue({ storage, fetchImpl: async () => response({}, 500) }))
      .rejects.toMatchObject({ code: 'MELOLAB_SYNC_HTTP_ERROR' });
    expect(await readFile(cachePath, 'utf8')).toBe(cacheBefore);
  });

  it('rejects an invalid response without changing the existing cache bytes', async () => {
    const { storage, cachePath } = await temporaryStorage();
    await storage.saveMeloLabCache([cachedPlaylist]);
    const cacheBefore = await readFile(cachePath, 'utf8');

    await expect(syncMeloLabCatalogue({ storage, fetchImpl: async () => response({ playlists: [{}] }) }))
      .rejects.toMatchObject({ code: 'MELOLAB_SYNC_INVALID_RESPONSE' });
    expect(await readFile(cachePath, 'utf8')).toBe(cacheBefore);
  });

  it('times out delayed body parsing without overwriting the existing cache', async () => {
    const { storage, cachePath } = await temporaryStorage();
    await storage.saveMeloLabCache([cachedPlaylist]);
    const cacheBefore = await readFile(cachePath, 'utf8');

    await expect(syncMeloLabCatalogue({
      storage,
      timeoutMs: 10,
      fetchImpl: async () => responseWithDelayedJson(fixture, 80),
    })).rejects.toMatchObject({ code: 'MELOLAB_SYNC_TIMEOUT_ERROR' });

    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(await readFile(cachePath, 'utf8')).toBe(cacheBefore);
  });

  it('waits for a delayed cache commit instead of timing out while it can still write', async () => {
    const { cachePath } = await temporaryStorage();
    const storage = new DelayedSaveCatalogStorage(dirname(cachePath));
    await storage.saveMeloLabCache([cachedPlaylist]);
    const cacheBefore = await readFile(cachePath, 'utf8');
    let releaseSave!: () => void;
    let signalSaveStart!: () => void;
    const saveRelease = new Promise<void>((resolve) => { releaseSave = resolve; });
    const saveStarted = new Promise<void>((resolve) => { signalSaveStart = resolve; });
    storage.delayNextSave(saveRelease, signalSaveStart);
    const sync = syncMeloLabCatalogue({ storage, timeoutMs: 10, fetchImpl: async () => response(fixture) });

    try {
      await saveStarted;
      const outcome = await Promise.race([
        sync.then(() => 'settled', () => 'failed'),
        new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 25)),
      ]);

      expect(outcome).toBe('pending');
      expect(await readFile(cachePath, 'utf8')).toBe(cacheBefore);

      releaseSave();
      await expect(sync).resolves.toMatchObject({ count: 1 });
      expect(await storage.loadMeloLabCache()).toEqual(normalizeMeloLabCatalogue(fixture));
    } finally {
      releaseSave();
      await sync.catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  });
});
