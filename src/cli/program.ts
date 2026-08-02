import { createInterface } from 'node:readline/promises';
import { Command, Option, type ParseOptions } from 'commander';
import { serveMcp } from '../mcp/index.js';
import { detectProvider, normalizePlaylistUrl } from '../platform.js';
import type { Activity, AddPlaylistInput, Provider, RecommendationInput } from '../schema.js';
import type { MeloPulseService } from '../service.js';
import { MELOPULSE_VERSION } from '../version.js';
import { resolveCliCapabilities, type CliCapabilities } from './capabilities.js';
import { sanitizeHumanText, toErrorView, toParserErrorView } from './error-view.js';
import { createPresenter, type CliPresenter } from './presenter.js';
import { startProgress, type Writer } from './progress.js';

export interface CliIO {
  stdout?: Writer;
  stderr?: Writer;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  isInteractive?: boolean;
  isStderrInteractive?: boolean;
  env?: NodeJS.ProcessEnv;
  columns?: number;
  setExitCode?: (code: number) => void;
}

type ResolvedCliIO = Required<Omit<CliIO, 'columns'>> & Pick<CliIO, 'columns'>;
type AddOptions = Omit<AddPlaylistInput, 'url' | 'activityTags' | 'moodTags'> & { activity?: Activity; mood?: string; json?: boolean };
type RecommendOptions = Omit<RecommendationInput, 'useGitContext'> & { git?: boolean; json?: boolean };
type JsonOptions = { json?: boolean };

export function createProgram(service: MeloPulseService, suppliedIO: CliIO = {}): Command {
  const io: ResolvedCliIO = {
    stdout: suppliedIO.stdout ?? process.stdout,
    stderr: suppliedIO.stderr ?? process.stderr,
    input: suppliedIO.input ?? process.stdin,
    output: suppliedIO.output ?? process.stdout,
    isInteractive: suppliedIO.isInteractive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY),
    isStderrInteractive: suppliedIO.isStderrInteractive ?? (suppliedIO.isInteractive ?? Boolean(process.stderr.isTTY)),
    env: suppliedIO.env ?? process.env,
    ...(suppliedIO.columns === undefined ? {} : { columns: suppliedIO.columns }),
    setExitCode: suppliedIO.setExitCode ?? ((code: number) => { process.exitCode = code; }),
  };
  const program = new CliCommand();
  const capabilitiesFor = (json: boolean | undefined): CliCapabilities => resolveCliCapabilities({
    isTTY: io.isInteractive,
    stderrIsTTY: io.isStderrInteractive,
    json: json ?? false,
    noColor: program.opts().color === false,
    env: io.env,
    ...(io.columns === undefined ? {} : { columns: io.columns }),
  });

  program
    .name('melopulse')
    .description('Local coding playlists for people and agents')
    .version(MELOPULSE_VERSION)
    .option('--no-color', 'disable terminal colors')
    .addHelpText('after', '\nQuick start:\n  melopulse recommend\n  melopulse play <playlist-id>\n\nOffline by default. Only sync contacts MeloLab.\n')
    .configureOutput({
      writeOut: (text) => { io.stdout.write(text); },
      writeErr: (text) => {
        if (!program.parserJsonRequested) {
          const safeText = sanitizeHumanText(text);
          if (safeText) io.stderr.write(`${safeText}\n`);
        }
      },
    })
    .exitOverride((error) => {
      io.setExitCode(error.exitCode);
      if (program.parserJsonRequested && error.exitCode !== 0) {
        io.stderr.write(`${JSON.stringify({ error: toParserErrorView(error) })}\n`);
      }
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
    .addHelpText('after', '\nExample:\n  melopulse add https://open.spotify.com/playlist/abc --title "Deep Work"\n')
    .action(async (url: string, options: AddOptions) => {
      const capabilities = capabilitiesFor(options.json);
      await runCommand(io, capabilities, async (presenter) => {
        const title = options.title ?? await resolveTitle(url, io, capabilities.mode === 'interactive');
        const playlist = await service.addPlaylist({
          url,
          ...(title === undefined ? {} : { title }),
          ...(options.activity === undefined ? {} : { activityTags: [options.activity] }),
          ...(options.mood === undefined ? {} : { moodTags: [options.mood] }),
          ...(options.energy === undefined ? {} : { energy: options.energy }),
          ...(options.focus === undefined ? {} : { focus: options.focus }),
          ...(options.vocals === undefined ? {} : { vocals: options.vocals }),
        });
        writeResult(io, options.json, playlist, presenter.savedPlaylist(playlist));
      });
    });

  program.command('list')
    .description('List playlists in the local catalogue')
    .option('--source <source>', 'filter by melolab, spotify, apple_music, youtube_music, or generic')
    .option('--json', 'print JSON')
    .addHelpText('after', '\nExample:\n  melopulse list --source spotify\n')
    .action(async (options: { source?: Provider; json?: boolean }) => {
      await runCommand(io, capabilitiesFor(options.json), async (presenter) => {
        const playlists = await service.listPlaylists(options.source);
        writeResult(io, options.json, playlists, presenter.playlists(playlists, options.source));
      });
    });

  program.command('sync')
    .description('Synchronize the MeloLab catalogue')
    .option('--json', 'print JSON')
    .addHelpText('after', '\nExample:\n  melopulse sync\n')
    .action(async (options: JsonOptions) => {
      const capabilities = capabilitiesFor(options.json);
      await runCommand(io, capabilities, async (presenter) => {
        const progress = startProgress(io.stderr, capabilities, 'Syncing MeloLab catalogue...');
        try {
          const result = await service.syncCatalog();
          progress.stop();
          writeResult(io, options.json, result, presenter.syncResult(result));
        } finally {
          progress.stop();
        }
      });
    });

  program.command('recommend')
    .description('Recommend coding playlists')
    .option('--activity <activity>', 'activity')
    .option('--mood <mood>', 'mood')
    .option('--energy <energy>', 'energy level')
    .option('--focus <focus>', 'focus level')
    .option('--vocals <vocals>', 'vocal preference')
    .addOption(new NamedOption('--git', 'use Git context', 'gitEnabled').conflicts('git'))
    .addOption(new Option('--no-git', 'do not use Git context').conflicts('gitEnabled'))
    .option('--limit <count>', 'maximum recommendations', Number)
    .option('--json', 'print JSON')
    .addHelpText('after', '\nExample:\n  melopulse recommend --activity debugging --no-git\n')
    .action(async (options: RecommendOptions) => {
      await runCommand(io, capabilitiesFor(options.json), async (presenter) => {
        const input: RecommendationInput = {
          ...(options.activity === undefined ? {} : { activity: options.activity }),
          ...(options.mood === undefined ? {} : { mood: options.mood }),
          ...(options.energy === undefined ? {} : { energy: options.energy }),
          ...(options.focus === undefined ? {} : { focus: options.focus }),
          ...(options.vocals === undefined ? {} : { vocals: options.vocals }),
          useGitContext: options.git ?? true,
          limit: options.limit ?? 3,
        };
        const result = await service.recommend(input);
        writeResult(io, options.json, result, presenter.recommendations(result, input));
      });
    });

  program.command('play <playlist-id>')
    .description('Open a playlist in the default browser')
    .option('--json', 'print JSON')
    .addHelpText('after', '\nExample:\n  melopulse play spotify:abc\n')
    .action(async (id: string, options: JsonOptions) => {
      await runCommand(io, capabilitiesFor(options.json), async (presenter) => {
        const result = await service.play(id);
        writeResult(io, options.json, result, presenter.playResult(result));
      });
    });

  program.command('mcp')
    .description('Serve MeloPulse tools over MCP stdio')
    .addHelpText('after', '\nExample:\n  melopulse mcp\n')
    .action(() => {
      serveMcp(service);
    });

  return program;
}

async function resolveTitle(
  url: string,
  io: Pick<ResolvedCliIO, 'input' | 'output'>,
  allowPrompt: boolean,
): Promise<string> {
  const fallback = `${providerDisplayName(detectProvider(normalizePlaylistUrl(url)))} playlist`;
  if (!allowPrompt) return fallback;
  const readline = createInterface({ input: io.input, output: io.output });
  try {
    return (await readline.question('Playlist title: ')).trim() || fallback;
  } finally {
    readline.close();
  }
}

async function runCommand(
  io: Pick<ResolvedCliIO, 'stderr' | 'setExitCode'>,
  capabilities: CliCapabilities,
  operation: (presenter: CliPresenter) => Promise<void>,
): Promise<void> {
  const presenter = createPresenter(capabilities);
  try {
    await operation(presenter);
  } catch (error) {
    const view = toErrorView(error);
    io.stderr.write(capabilities.mode === 'json' ? `${JSON.stringify({ error: view })}\n` : `${presenter.error(view)}\n`);
    io.setExitCode(1);
  }
}

function writeResult(io: Pick<ResolvedCliIO, 'stdout'>, json: boolean | undefined, value: unknown, human: string): void {
  io.stdout.write(json ? `${JSON.stringify(value)}\n` : `${human}\n`);
}

function providerDisplayName(provider: ReturnType<typeof detectProvider>): string {
  const names = { melolab: 'MeloLab', spotify: 'Spotify', apple_music: 'Apple Music', youtube_music: 'YouTube Music', generic: 'Generic' };
  return names[provider];
}

class CliCommand extends Command {
  parserJsonRequested = false;

  override async parseAsync(argv?: readonly string[], parseOptions?: ParseOptions): Promise<this> {
    this.parserJsonRequested = (argv ?? process.argv).includes('--json');
    try {
      return await super.parseAsync(argv, parseOptions);
    } finally {
      this.parserJsonRequested = false;
    }
  }
}

class NamedOption extends Option {
  constructor(flags: string, description: string, private readonly propertyName: string) {
    super(flags, description);
  }

  override attributeName(): string {
    return this.propertyName;
  }
}
