import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type ProcessResult = { code: number | null; stdout: string; stderr: string };

function runProcess(command: string, arguments_: string[], environment: NodeJS.ProcessEnv): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => { resolve({ code, stdout, stderr }); });
  });
}

describe('packed-install smoke test', () => {
  it('runs directly from a repository path with spaces and an ampersand', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'melopulse smoke & '));
    const replica = join(parent, 'release package');
    const source = process.cwd();
    const environment = { ...process.env };
    delete environment.npm_execpath;

    try {
      await Promise.all([
        ...['dist', 'src', 'docs', 'examples', 'scripts'].map((directory) => cp(join(source, directory), join(replica, directory), { recursive: true })),
        ...[
          'package.json',
          'package-lock.json',
          'tsconfig.json',
          'tsconfig.build.json',
          'README.md',
          'LICENSE',
          'CHANGELOG.md',
        ].map((file) => cp(join(source, file), join(replica, file))),
      ]);
      await symlink(join(source, 'node_modules'), join(replica, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');

      const result = await runProcess(process.execPath, [join(replica, 'scripts', 'smoke-pack.mjs')], environment);

      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toContain('Packed-install smoke test passed');
      expect(result.stdout).toContain('Packed MCP smoke test passed');
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  }, 30_000);
});
