import { existsSync } from 'node:fs';
import { cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runProcess } from './helpers/run-process.js';
import { withCleanup } from './helpers/with-cleanup.js';

describe('packed-install smoke test', () => {
  it('runs directly from a repository path with spaces and an ampersand', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'melopulse smoke & '));
    const replica = join(parent, 'release package');
    const source = process.cwd();
    const environment = { ...process.env };
    delete environment.npm_execpath;

    await withCleanup(async () => {
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

      const result = await runProcess(process.execPath, [join(replica, 'scripts', 'smoke-pack.mjs')], {
        env: environment,
        timeoutMs: 90_000,
      });

      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toContain('Packed CLI help smoke passed');
      expect(result.stdout).toContain('Packed CLI catalogue smoke passed');
      expect(result.stdout).toContain('Packed CLI JSON error smoke passed');
      expect(result.stdout).toContain('Packed-install smoke test passed');
      expect(result.stdout).toContain('Packed MCP smoke test passed');
    }, async () => {
      await rm(parent, { recursive: true, force: true });
      expect(existsSync(parent)).toBe(false);
    });
  }, 120_000);
});
