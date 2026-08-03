import { Readable, Writable } from 'node:stream';
import { CommanderError } from 'commander';
import { describe, expect, it } from 'vitest';
import { createProgram } from '../../src/cli/program.js';
import { MeloPulseError } from '../../src/errors.js';
import type { MeloPulseService } from '../../src/service.js';
import type { CliIO } from '../../src/cli/program.js';

type Call = { method: keyof MeloPulseService; input?: unknown };
const INLINE_CONTROL_CHARACTER = new RegExp(String.raw`[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]`, 'u');

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
    listPlaylists: async (source) => {
      calls.push({ method: 'listPlaylists', input: source });
      return [{
        id: 'spotify:abc', source: 'spotify', title: 'Spotify playlist', url: 'https://open.spotify.com/playlist/abc',
        activityTags: ['deep_focus'], moodTags: [], energy: 'medium', focus: 'medium', vocals: 'any',
      }];
    },
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

async function run(
  arguments_: readonly string[],
  service = fakeService([]),
  suppliedIO: Partial<CliIO> = {},
): Promise<{ stdout: string; stderr: string; exitCodes: number[] }> {
  let stdout = '';
  let stderr = '';
  const exitCodes: number[] = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      stdout += chunk.toString();
      callback();
    },
  });
  const program = createProgram(service, {
    stdout: { write: (text: string) => { stdout += text; return true; } },
    stderr: { write: (text: string) => { stderr += text; return true; } },
    output,
    isInteractive: false,
    setExitCode: (code) => { exitCodes.push(code); },
    ...suppliedIO,
  });
  try {
    await program.parseAsync([...arguments_], { from: 'user' });
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
  }
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

  it('keeps interactive add JSON as one stdout value without a prompt', async () => {
    const result = await run(['add', 'https://open.spotify.com/playlist/abc', '--json'], fakeService([]), {
      isInteractive: true,
      input: Readable.from(['A prompted title\n']),
    });

    expect(JSON.parse(result.stdout)).toMatchObject({ id: 'spotify:abc', title: 'Spotify playlist' });
    expect(result.stdout).not.toContain('Playlist title:');
  });

  it('lists local playlists by source without calling sync', async () => {
    const calls: Call[] = [];
    const result = await run(['list', '--source', 'spotify'], fakeService(calls));

    expect(result.stdout).toContain('spotify:abc');
    expect(result.stdout).toContain('Spotify | medium energy | medium focus');
    expect(calls).toEqual([{ method: 'listPlaylists', input: 'spotify' }]);
  });

  it('states sanitized recommendation context and selection metadata', async () => {
    const result = await run([
      'recommend',
      '--activity', 'debugging',
      '--mood', "calm\n\u001B[31mfocused",
      '--no-git',
      '--limit', '1',
    ]);

    expect(result.stdout).toContain('MeloPulse recommendations');
    expect(result.stdout).toContain('Git context off');
    expect(result.stdout).toContain('1 requested');
    expect(result.stdout).toContain('activity debugging');
    expect(result.stdout).toContain('mood calm focused');
    expect(result.stdout).toContain('MeloLab | low energy | high focus');
    expect(result.stdout).not.toMatch(INLINE_CONTROL_CHARACTER);
  });

  it.each([
    ['unknown option', ['recommend', '--json', '--unknown'], 'UNKNOWN_OPTION'],
    ['missing argument', ['play', '--json'], 'MISSING_ARGUMENT'],
    ['conflicting options', ['recommend', '--json', '--git', '--no-git'], 'CONFLICTING_OPTIONS'],
  ] as const)('renders %s parser failures as one JSON ErrorView on stderr', async (_scenario, arguments_, code) => {
    const result = await run(arguments_);

    expect(result.stdout).toBe('');
    expect(result.stderr.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        code,
        message: expect.any(String),
        suggestion: expect.any(String),
        retryable: false,
      },
    });
    expect(result.stderr).not.toContain('error:');
    expect(result.exitCodes).toEqual([1]);
  });

  it('keeps plain Commander parser text single-line and control-free', async () => {
    const result = await run(['recommend', '--bad\n\u001B[31moption']);

    expect(result.stdout).toBe('');
    expect(result.stderr.trim().split('\n')).toHaveLength(1);
    expect(result.stderr).not.toMatch(INLINE_CONTROL_CHARACTER);
    expect(result.stderr).not.toContain('\u001B[');
  });

  it.each([
    ['CI', { CI: '1' }],
    ['TERM=dumb', { TERM: 'dumb' }],
  ] as const)('does not prompt for an add title in %s plain mode', async (_scenario, env) => {
    const calls: Call[] = [];
    const result = await run(
      ['add', 'https://open.spotify.com/playlist/abc'],
      fakeService(calls),
      {
        isInteractive: true,
        isStderrInteractive: true,
        env,
        input: Readable.from(['Prompted title\n']),
      },
    );

    expect(result.stdout).not.toContain('Playlist title:');
    expect(calls).toEqual([{
      method: 'addPlaylist',
      input: expect.objectContaining({ title: 'Spotify playlist' }),
    }]);
  });

  it('keeps JSON errors on stderr and stdout empty', async () => {
    const service = fakeService([]);
    service.play = async () => { throw new MeloPulseError('PLAYLIST_NOT_FOUND', "Playlist 'missing' was not found."); };

    const result = await run(['play', 'missing', '--json'], service);

    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toEqual({ error: {
      code: 'PLAYLIST_NOT_FOUND',
      message: "Playlist 'missing' was not found.",
      suggestion: 'Run melopulse list or melopulse recommend to choose a valid playlist ID.',
      retryable: false,
    } });
    expect(result.exitCodes).toEqual([1]);
  });

  it('never adds ANSI when NO_COLOR is present', async () => {
    const result = await run(['recommend', '--no-git'], fakeService([]), {
      isInteractive: true,
      env: { NO_COLOR: '' },
    });

    expect(result.stdout).not.toContain('\u001B[');
  });

  it.each([
    ['NO_COLOR', ['sync'], { isInteractive: true, isStderrInteractive: true, env: { NO_COLOR: '' } }],
    ['--no-color', ['--no-color', 'sync'], { isInteractive: true, isStderrInteractive: true, env: {} }],
    ['redirected stderr', ['sync'], { isInteractive: true, isStderrInteractive: false, env: {} }],
  ] as const)('does not write sync progress controls for %s', async (_scenario, arguments_, suppliedIO) => {
    const result = await run(arguments_, fakeService([]), suppliedIO);

    expect(result.stderr).toBe('');
  });

  it('clears interactive sync progress before durable success output', async () => {
    const events: Array<{ stream: 'stdout' | 'stderr'; text: string }> = [];
    const program = createProgram(fakeService([]), {
      stdout: { write: (text) => { events.push({ stream: 'stdout', text }); } },
      stderr: { write: (text) => { events.push({ stream: 'stderr', text }); } },
      isInteractive: true,
      isStderrInteractive: true,
      env: {},
      setExitCode: () => undefined,
    });

    await program.parseAsync(['sync'], { from: 'user' });

    expect(events.map(({ stream, text }) => ({ stream, control: text.includes('\u001B[2K') }))).toEqual([
      { stream: 'stderr', control: false },
      { stream: 'stderr', control: true },
      { stream: 'stdout', control: false },
    ]);
  });

  it('reports command failures through the injected exit-code setter', async () => {
    const service = fakeService([]);
    service.syncCatalog = async () => { throw new Error('sync unavailable'); };

    const result = await run(['sync', '--json'], service);

    expect(JSON.parse(result.stderr)).toMatchObject({ error: {
      code: 'INTERNAL_ERROR',
      retryable: true,
    } });
    expect(result.exitCodes).toEqual([1]);
  });
});
