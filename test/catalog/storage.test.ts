import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveDataDir } from '../../src/catalog/paths.js';
import { CatalogStorage } from '../../src/catalog/storage.js';
import type { PlaylistRecord } from '../../src/schema.js';

const userRecord: PlaylistRecord = {
  id: 'user-1',
  source: 'generic',
  title: 'User playlist',
  url: 'https://example.com/list',
  activityTags: ['deep_focus'],
  moodTags: ['calm'],
  energy: 'low',
  focus: 'high',
  vocals: 'none',
};

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('catalog storage', () => {
  it('uses MELOPULSE_CONFIG_DIR when configured', () => {
    expect(resolveDataDir({ MELOPULSE_CONFIG_DIR: 'C:\\catalogues' })).toBe('C:\\catalogues');
  });

  it('persists user playlists separately from an empty MeloLab cache', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'melopulse-storage-'));
    tempDirectories.push(directory);
    const storage = new CatalogStorage(directory);

    await storage.saveUserPlaylists([userRecord]);

    expect(await storage.loadUserPlaylists()).toEqual([userRecord]);
    expect(await storage.loadMeloLabCache()).toEqual([]);
  });

  it('returns an empty cache for malformed JSON without changing user playlists', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'melopulse-storage-'));
    tempDirectories.push(directory);
    const storage = new CatalogStorage(directory);
    await storage.saveUserPlaylists([userRecord]);
    const playlistsBefore = await readFile(join(directory, 'playlists.json'), 'utf8');
    await writeFile(join(directory, 'melolab-catalog-cache.json'), '{invalid json', 'utf8');

    expect(await storage.loadMeloLabCache()).toEqual([]);
    expect(await readFile(join(directory, 'playlists.json'), 'utf8')).toBe(playlistsBefore);
  });
});
