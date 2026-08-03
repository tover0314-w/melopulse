import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

type CliResult = { code: number | null; stdout: string; stderr: string };
const INLINE_CONTROL_CHARACTER = new RegExp(String.raw`[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F]`, 'u');

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

function runProcess(command: string, arguments_: string[], env?: NodeJS.ProcessEnv): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(env === undefined ? {} : { env }),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => { resolve({ code, stdout, stderr }); });
  });
}

async function runBuiltCli(arguments_: readonly string[]): Promise<CliResult> {
  const dataDir = await mkdtemp(join(tmpdir(), 'melopulse-built-cli-'));
  temporaryDirectories.push(dataDir);
  return runProcess(process.execPath, [join(process.cwd(), 'dist', 'cli', 'index.js'), ...arguments_], {
    ...process.env,
    MELOPULSE_CONFIG_DIR: dataDir,
  });
}

describe('built melopulse executable', () => {
  beforeAll(async () => {
    const result = await runProcess(process.execPath, [join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.build.json']);
    if (result.code !== 0) throw new Error(result.stderr);
  });

  it('exits successfully for root help', async () => {
    const result = await runBuiltCli(['--help']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage: melopulse');
    expect(result.stdout).toContain('Quick start:');
    expect(result.stdout).toContain('melopulse recommend');
  });

  it('prints the shared CLI version', async () => {
    const result = await runBuiltCli(['--version']);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('0.2.0\n');
  });

  it('exits successfully for subcommand help', async () => {
    const result = await runBuiltCli(['recommend', '--help']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage: melopulse recommend');
  });

  it.each([
    ['unknown option', ['recommend', '--json', '--unknown'], 'UNKNOWN_OPTION'],
    ['missing argument', ['play', '--json'], 'MISSING_ARGUMENT'],
    ['conflicting options', ['recommend', '--json', '--git', '--no-git'], 'CONFLICTING_OPTIONS'],
  ] as const)('renders built %s failures as JSON on stderr only', async (_scenario, arguments_, code) => {
    const result = await runBuiltCli(arguments_);

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        code,
        message: expect.any(String),
        suggestion: expect.any(String),
        retryable: false,
      },
    });
    expect(result.stderr.trim().split('\n')).toHaveLength(1);
  });

  it('keeps invalid user input nonzero without opening a URL', async () => {
    const result = await runBuiltCli(['add', 'not-a-url', '--json']);

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchObject({ error: {
      code: 'INVALID_PLAYLIST_URL',
      message: 'Playlist URL must be a valid URL',
    } });
  });

  it('prints JSON lists without ANSI when stdout is piped', async () => {
    const result = await runBuiltCli(['list', '--json']);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(expect.any(Array));
    expect(result.stdout).not.toContain('\u001B[');
    expect(result.stderr).toBe('');
  });

  it('keeps plain piped output free of ANSI', async () => {
    const result = await runBuiltCli(['recommend', '--no-git']);

    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain('\u001B[');
    expect(result.stdout).toContain('Context: local catalogue | Git context off | 3 requested');
    expect(result.stdout).toContain('Fit: MeloLab | low energy | high focus');
  });

  it.each([
    "missing\nINJECTED",
    'missing\u001B[31mINJECTED',
  ])('keeps unsafe playlist ID %j out of human error text', async (id) => {
    const result = await runBuiltCli(['play', id]);

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('INVALID_PLAYLIST_ID');
    expect(result.stderr).not.toContain(id);
    expect(result.stderr).not.toMatch(INLINE_CONTROL_CHARACTER);
  });
});
