import { Readable, Writable } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { CommanderError } from 'commander';
import { describe, expect, it } from 'vitest';
import { createProgram, type CliIO } from '../src/cli/program.js';
import { MeloPulseError } from '../src/errors.js';
import { createMcpServer } from '../src/mcp/server.js';
import type { MeloPulseService } from '../src/service.js';

type ServiceCall = { method: keyof MeloPulseService; input?: unknown };

function matrixService(calls: ServiceCall[]): MeloPulseService {
  return {
    addPlaylist: async (input) => {
      calls.push({ method: 'addPlaylist', input });
      return {
        id: 'spotify:matrix', source: 'spotify', title: input.title ?? 'Spotify playlist', url: input.url,
        activityTags: input.activityTags ?? ['deep_focus'], moodTags: input.moodTags ?? [],
        energy: input.energy ?? 'medium', focus: input.focus ?? 'medium', vocals: input.vocals ?? 'any',
      };
    },
    listPlaylists: async (source) => {
      calls.push({ method: 'listPlaylists', input: source });
      return [];
    },
    recommend: async (input) => {
      calls.push({ method: 'recommend', input });
      return [];
    },
    syncCatalog: async () => {
      calls.push({ method: 'syncCatalog' });
      return { count: 0, playlists: [] };
    },
    play: async (id) => {
      calls.push({ method: 'play', input: id });
      return { id, url: 'https://example.com/matrix' };
    },
  };
}

async function runCliMatrix(
  arguments_: readonly string[],
  configure?: (service: MeloPulseService) => void,
  suppliedIO: Partial<CliIO> = {},
) {
  const calls: ServiceCall[] = [];
  const service = matrixService(calls);
  configure?.(service);
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
    stdout: { write: (text) => { stdout += text; } },
    stderr: { write: (text) => { stderr += text; } },
    output,
    isInteractive: false,
    env: {},
    setExitCode: (code) => { exitCodes.push(code); },
    ...suppliedIO,
  });
  try {
    await program.parseAsync([...arguments_], { from: 'user' });
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
  }
  return { stdout, stderr, calls, exitCodes };
}

describe('command x mode x stream/error-origin contract matrix', () => {
  it.each([
    {
      origin: 'Commander parser', mode: 'JSON', command: 'recommend --json --unknown',
      arguments_: ['recommend', '--json', '--unknown'], expectedStdout: 'empty', expectedStderr: 'json-error',
    },
    {
      origin: 'command action', mode: 'JSON', command: 'play missing --json',
      arguments_: ['play', 'missing', '--json'], expectedStdout: 'empty', expectedStderr: 'json-error',
      configure: (service: MeloPulseService) => {
        service.play = async () => { throw new MeloPulseError('PLAYLIST_NOT_FOUND', 'Playlist was not found.'); };
      },
    },
    {
      origin: 'success', mode: 'JSON', command: 'list --json',
      arguments_: ['list', '--json'], expectedStdout: 'json-success', expectedStderr: 'empty',
    },
    {
      origin: 'success', mode: 'plain CI', command: 'add URL',
      arguments_: ['add', 'https://open.spotify.com/playlist/matrix'], expectedStdout: 'human-success', expectedStderr: 'empty',
      suppliedIO: { isInteractive: true, env: { CI: '1' }, input: Readable.from(['Injected title\n']) },
    },
  ] as const)('$origin | $mode | $command', async (row) => {
    const result = await runCliMatrix(row.arguments_, 'configure' in row ? row.configure : undefined, 'suppliedIO' in row ? row.suppliedIO : undefined);

    if (row.expectedStdout === 'empty') expect(result.stdout).toBe('');
    if (row.expectedStdout === 'json-success') expect(() => JSON.parse(result.stdout)).not.toThrow();
    if (row.expectedStdout === 'human-success') {
      expect(result.stdout).toContain('Saved playlist');
      expect(result.stdout).not.toContain('Playlist title:');
      expect(result.calls).toEqual([{
        method: 'addPlaylist',
        input: expect.objectContaining({ title: 'Spotify playlist' }),
      }]);
    }
    if (row.expectedStderr === 'empty') expect(result.stderr).toBe('');
    if (row.expectedStderr === 'json-error') {
      expect(JSON.parse(result.stderr)).toEqual({ error: expect.objectContaining({ retryable: expect.any(Boolean) }) });
      expect(result.stderr.trim().split('\n')).toHaveLength(1);
    }
  });
});

describe('MCP protocol x error-origin contract matrix', () => {
  it.each([
    {
      origin: 'SDK pre-handler validation',
      request: { name: 'melopulse_recommend', arguments: { activity: 'fixing' } },
      configure: undefined,
      expected: 'structured-error',
    },
    {
      origin: 'tool action',
      request: { name: 'melopulse_sync_catalog', arguments: {} },
      configure: (service: MeloPulseService) => {
        service.syncCatalog = async () => { throw new MeloPulseError('MELOLAB_SYNC_NETWORK_ERROR', 'Unable to retrieve the MeloLab catalogue.'); };
      },
      expected: 'structured-error',
    },
    {
      origin: 'success',
      request: { name: 'melopulse_list_playlists', arguments: {} },
      configure: undefined,
      expected: 'structured-success',
    },
  ] as const)('$origin | protocol result', async ({ request, configure, expected }) => {
    const calls: ServiceCall[] = [];
    const service = matrixService(calls);
    configure?.(service);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer(service);
    const client = new Client({ name: 'matrix-test', version: '1.0.0' });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const result = await client.callTool(request);
      const text = JSON.parse(result.content[0]?.type === 'text' ? result.content[0].text : '');

      if (expected === 'structured-error') {
        expect(result.isError).toBe(true);
        expect(text).toEqual({ error: expect.objectContaining({ code: expect.any(String), suggestion: expect.any(String) }) });
        expect(result.structuredContent).toEqual(text);
      } else {
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toEqual({ playlists: text });
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
});
