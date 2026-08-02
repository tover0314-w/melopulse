import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

type CliResult = { code: number | null; stdout: string; stderr: string };

function runProcess(command: string, arguments_: string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => { resolve({ code, stdout, stderr }); });
  });
}

function runBuiltCli(arguments_: string[]): Promise<CliResult> {
  return runProcess(process.execPath, [join(process.cwd(), 'dist', 'cli', 'index.js'), ...arguments_]);
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

  it('keeps parse errors nonzero', async () => {
    const result = await runBuiltCli(['recommend', '--unknown']);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('unknown option');
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
  });
});
