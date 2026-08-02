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
    expect(result.stderr).toContain('Playlist URL must be a valid URL');
  });
});
