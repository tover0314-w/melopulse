import { describe, expect, it } from 'vitest';
import { createProgram } from '../../src/cli/program.js';
import type { MeloPulseService } from '../../src/service.js';

type Call = { method: keyof MeloPulseService; input?: unknown };

function fakeService(calls: Call[]): MeloPulseService {
  return {
    addPlaylist: async (input) => {
      calls.push({ method: 'addPlaylist', input });
      return {
        id: 'spotify:abc', source: 'spotify', title: input.title ?? 'Spotify playlist', url: input.url,
        activityTags: input.activityTags ?? ['deep_focus'], moodTags: input.moodTags ?? [],
        energy: input.energy ?? 'medium', focus: input.focus ?? 'medium', vocals: input.vocals ?? 'any',
      };
    },
    listPlaylists: async () => [],
    recommend: async (input) => {
      calls.push({ method: 'recommend', input });
      return [{
        playlist: {
          id: 'melolab:focus-flow', source: 'melolab', title: 'Focus Flow',
          url: 'https://melolab.ai/playlist/focus-flow', activityTags: ['debugging'], moodTags: [],
          energy: 'low', focus: 'high', vocals: 'none',
        },
        score: 8,
        reasons: ['Fits debugging work with high focus and low vocal distraction.'],
      }];
    },
    syncCatalog: async () => {
      calls.push({ method: 'syncCatalog' });
      return { count: 0, playlists: [] };
    },
    play: async (id) => {
      calls.push({ method: 'play', input: id });
      return { id, url: 'https://open.spotify.com/playlist/abc' };
    },
  };
}

async function run(arguments_: string[], service = fakeService([])): Promise<{ stdout: string; stderr: string; exitCodes: number[] }> {
  let stdout = '';
  let stderr = '';
  const exitCodes: number[] = [];
  const program = createProgram(service, {
    stdout: { write: (text: string) => { stdout += text; return true; } },
    stderr: { write: (text: string) => { stderr += text; return true; } },
    isInteractive: false,
    setExitCode: (code) => { exitCodes.push(code); },
  });
  await program.parseAsync(arguments_, { from: 'user' });
  return { stdout, stderr, exitCodes };
}

describe('melopulse commands', () => {
  it('writes an added playlist as JSON and calls only addPlaylist', async () => {
    const calls: Call[] = [];
    const result = await run(['add', 'https://open.spotify.com/playlist/abc', '--title', 'Debug Mix', '--activity', 'debugging', '--json'], fakeService(calls));

    expect(JSON.parse(result.stdout)).toMatchObject({ id: 'spotify:abc', title: 'Debug Mix' });
    expect(result.stderr).toBe('');
    expect(calls).toEqual([{ method: 'addPlaylist', input: expect.objectContaining({ title: 'Debug Mix', activityTags: ['debugging'] }) }]);
  });

  it('writes recommendations as JSON and forwards --no-git', async () => {
    const calls: Call[] = [];
    const result = await run(['recommend', '--activity', 'debugging', '--no-git', '--json'], fakeService(calls));

    expect(JSON.parse(result.stdout)).toHaveLength(1);
    expect(calls).toEqual([{ method: 'recommend', input: expect.objectContaining({ activity: 'debugging', useGitContext: false }) }]);
  });

  it('writes a play handoff as JSON and calls only play', async () => {
    const calls: Call[] = [];
    const result = await run(['play', 'spotify:abc', '--json'], fakeService(calls));

    expect(JSON.parse(result.stdout)).toEqual({ id: 'spotify:abc', url: 'https://open.spotify.com/playlist/abc' });
    expect(calls).toEqual([{ method: 'play', input: 'spotify:abc' }]);
  });

  it('writes sync results as JSON and calls only syncCatalog', async () => {
    const calls: Call[] = [];
    const result = await run(['sync', '--json'], fakeService(calls));

    expect(JSON.parse(result.stdout)).toEqual({ count: 0, playlists: [] });
    expect(calls).toEqual([{ method: 'syncCatalog' }]);
  });

  it('reports command failures through the injected exit-code setter', async () => {
    const service = fakeService([]);
    service.syncCatalog = async () => { throw new Error('sync unavailable'); };

    const result = await run(['sync', '--json'], service);

    expect(result.stderr).toContain('sync unavailable');
    expect(result.exitCodes).toEqual([1]);
  });
});
