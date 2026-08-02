import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMeloPulseService } from '../src/service.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'melopulse-service-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('MeloPulse service', () => {
  it('adds and recommends playlists without accessing the network', async () => {
    const dataDir = await temporaryDirectory();
    const nonGitDir = await temporaryDirectory();
    const service = createMeloPulseService({
      dataDir,
      cwd: nonGitDir,
      fetchImpl: async () => { throw new Error('network forbidden'); },
    });

    const added = await service.addPlaylist({
      url: 'https://open.spotify.com/playlist/abc',
      title: 'My Debug Mix',
      activityTags: ['debugging'],
      moodTags: ['focused'],
      energy: 'medium',
      focus: 'high',
      vocals: 'low',
    });

    expect(added.source).toBe('spotify');
    expect(await service.recommend({ activity: 'debugging', useGitContext: false, limit: 1 })).toHaveLength(1);
  });

  it('hands a known playlist URL to the injected opener', async () => {
    const dataDir = await temporaryDirectory();
    const opened: string[] = [];
    const service = createMeloPulseService({ dataDir, openUrl: async (url) => { opened.push(url); } });
    const added = await service.addPlaylist({ url: 'https://open.spotify.com/playlist/abc#ignored' });

    await expect(service.play(added.id)).resolves.toEqual({ id: added.id, url: 'https://open.spotify.com/playlist/abc' });
    expect(opened).toEqual(['https://open.spotify.com/playlist/abc']);
  });

  it('rejects play requests for unknown playlist IDs', async () => {
    const service = createMeloPulseService({ dataDir: await temporaryDirectory() });

    await expect(service.play('missing')).rejects.toMatchObject({ code: 'PLAYLIST_NOT_FOUND' });
  });

  it('applies documented metadata defaults to playlist additions', async () => {
    const service = createMeloPulseService({ dataDir: await temporaryDirectory() });

    await expect(service.addPlaylist({ url: 'https://example.com/list' })).resolves.toMatchObject({
      source: 'generic',
      title: 'Generic playlist',
      activityTags: ['deep_focus'],
      moodTags: [],
      energy: 'medium',
      focus: 'medium',
      vocals: 'any',
    });
  });

  it('lists locally saved playlists without synchronizing a catalogue', async () => {
    const service = createMeloPulseService({
      dataDir: await temporaryDirectory(),
      fetchImpl: async () => { throw new Error('network forbidden'); },
    });
    await service.addPlaylist({ url: 'https://open.spotify.com/playlist/local-list' });

    await expect(service.listPlaylists('spotify')).resolves.toMatchObject([
      { source: 'spotify', url: 'https://open.spotify.com/playlist/local-list' },
    ]);
  });

  it('uses the injected fetch implementation only for an explicit catalogue sync', async () => {
    const service = createMeloPulseService({
      dataDir: await temporaryDirectory(),
      fetchImpl: async () => new Response(JSON.stringify({
        playlists: [{ id: 'remote-focus', name: 'Remote Focus', is_public: true }],
      }), { status: 200 }),
    });

    await expect(service.syncCatalog()).resolves.toMatchObject({
      count: 1,
      playlists: [{ id: 'melolab:remote-focus', title: 'Remote Focus' }],
    });
  });
});
