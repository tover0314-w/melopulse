import { createInterface } from 'node:readline/promises';
import { Command } from 'commander';
import { detectProvider, normalizePlaylistUrl } from '../platform.js';
import type { Activity, AddPlaylistInput, RecommendationInput } from '../schema.js';
import type { MeloPulseService } from '../service.js';

type Writer = { write(text: string): unknown };

export interface CliIO {
  stdout?: Writer;
  stderr?: Writer;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  isInteractive?: boolean;
  setExitCode?: (code: number) => void;
}

type AddOptions = Omit<AddPlaylistInput, 'url' | 'activityTags' | 'moodTags'> & { activity?: Activity; mood?: string; json?: boolean };
type RecommendOptions = Omit<RecommendationInput, 'useGitContext'> & { git?: boolean; json?: boolean };
type JsonOptions = { json?: boolean };

export function createProgram(service: MeloPulseService, suppliedIO: CliIO = {}): Command {
  const io = {
    stdout: suppliedIO.stdout ?? process.stdout,
    stderr: suppliedIO.stderr ?? process.stderr,
    input: suppliedIO.input ?? process.stdin,
    output: suppliedIO.output ?? process.stdout,
    isInteractive: suppliedIO.isInteractive ?? Boolean(process.stdin.isTTY),
    setExitCode: suppliedIO.setExitCode ?? ((code: number) => { process.exitCode = code; }),
  };
  const program = new Command();
  program.name('melopulse').description('Local coding playlists').configureOutput({
    writeOut: (text) => { io.stdout.write(text); },
    writeErr: (text) => { io.stderr.write(text); },
  }).exitOverride((error) => {
    io.setExitCode(error.exitCode);
    throw error;
  });

  program.command('add <playlist-url>')
    .description('Add a local playlist')
    .option('--title <title>', 'playlist title')
    .option('--activity <activity>', 'activity tag')
    .option('--mood <mood>', 'mood tag')
    .option('--energy <energy>', 'energy level')
    .option('--focus <focus>', 'focus level')
    .option('--vocals <vocals>', 'vocal preference')
    .option('--json', 'print JSON')
    .action(async (url: string, options: AddOptions) => {
      await runCommand(io, options, async () => {
        const title = options.title ?? await resolveTitle(url, io);
        const playlist = await service.addPlaylist({
          url,
          ...(title === undefined ? {} : { title }),
          ...(options.activity === undefined ? {} : { activityTags: [options.activity] }),
          ...(options.mood === undefined ? {} : { moodTags: [options.mood] }),
          ...(options.energy === undefined ? {} : { energy: options.energy }),
          ...(options.focus === undefined ? {} : { focus: options.focus }),
          ...(options.vocals === undefined ? {} : { vocals: options.vocals }),
        });
        writeResult(io, options.json, playlist, `${playlist.title}\n${playlist.url}`);
      });
    });

  program.command('sync')
    .description('Synchronize the MeloLab catalogue')
    .option('--json', 'print JSON')
    .action(async (options: JsonOptions) => {
      await runCommand(io, options, async () => {
        const result = await service.syncCatalog();
        writeResult(io, options.json, result, `Synced ${result.count} playlists.`);
      });
    });

  program.command('recommend')
    .description('Recommend coding playlists')
    .option('--activity <activity>', 'activity')
    .option('--mood <mood>', 'mood')
    .option('--energy <energy>', 'energy level')
    .option('--focus <focus>', 'focus level')
    .option('--vocals <vocals>', 'vocal preference')
    .option('--git', 'use Git context', true)
    .option('--no-git', 'do not use Git context')
    .option('--limit <count>', 'maximum recommendations', Number)
    .option('--json', 'print JSON')
    .action(async (options: RecommendOptions) => {
      await runCommand(io, options, async () => {
        const result = await service.recommend({
          ...(options.activity === undefined ? {} : { activity: options.activity }),
          ...(options.mood === undefined ? {} : { mood: options.mood }),
          ...(options.energy === undefined ? {} : { energy: options.energy }),
          ...(options.focus === undefined ? {} : { focus: options.focus }),
          ...(options.vocals === undefined ? {} : { vocals: options.vocals }),
          useGitContext: options.git ?? true,
          limit: options.limit ?? 3,
        });
        writeResult(io, options.json, result, formatRecommendations(result));
      });
    });

  program.command('play <playlist-id>')
    .description('Open a playlist in the default browser')
    .option('--json', 'print JSON')
    .action(async (id: string, options: JsonOptions) => {
      await runCommand(io, options, async () => {
        const result = await service.play(id);
        writeResult(io, options.json, result, `Opening ${result.url}`);
      });
    });

  return program;
}

async function resolveTitle(url: string, io: Required<Pick<CliIO, 'input' | 'output' | 'isInteractive'>>): Promise<string> {
  const fallback = `${providerDisplayName(detectProvider(normalizePlaylistUrl(url)))} playlist`;
  if (!io.isInteractive) return fallback;
  const readline = createInterface({ input: io.input, output: io.output });
  try {
    return (await readline.question('Playlist title: ')).trim() || fallback;
  } finally {
    readline.close();
  }
}

async function runCommand(
  io: Required<Pick<CliIO, 'stderr' | 'setExitCode'>>,
  _options: JsonOptions,
  operation: () => Promise<void>,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const url = playlistUrl(error);
    io.stderr.write(`${message}\n`);
    if (url) io.stderr.write(`${url}\n`);
    io.setExitCode(1);
  }
}

function writeResult(io: Required<Pick<CliIO, 'stdout'>>, json: boolean | undefined, value: unknown, human: string): void {
  io.stdout.write(json ? `${JSON.stringify(value)}\n` : `${human}\n`);
}

function formatRecommendations(results: Awaited<ReturnType<MeloPulseService['recommend']>>): string {
  return results.map((result, index) => {
    const reason = result.reasons[0] ?? 'A local focus recommendation.';
    return `${index + 1}. ${result.playlist.title} — ${reason}\n   ${result.playlist.url}\n   melopulse play ${result.playlist.id}`;
  }).join('\n');
}

function playlistUrl(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('url' in error)) return undefined;
  return typeof error.url === 'string' ? error.url : undefined;
}

function providerDisplayName(provider: ReturnType<typeof detectProvider>): string {
  const names = { melolab: 'MeloLab', spotify: 'Spotify', apple_music: 'Apple Music', youtube_music: 'YouTube Music', generic: 'Generic' };
  return names[provider];
}
