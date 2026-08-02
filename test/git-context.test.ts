import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { readGitContext } from '../src/git-context.js';

const execFile = promisify(execFileCallback);
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('Git context', () => {
  it('derives only the current branch, latest subject, and changed-file summary from a repository', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'melopulse-git-context-'));
    tempDirectories.push(repository);
    await execFile('git', ['init', '--initial-branch=feature/music-flow'], { cwd: repository });
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: repository });
    await execFile('git', ['config', 'user.name', 'MeloPulse Test'], { cwd: repository });
    await writeFile(join(repository, 'README.md'), '# Player shell\n', 'utf8');
    await execFile('git', ['add', 'README.md'], { cwd: repository });
    await execFile('git', ['commit', '-m', 'feat: add player shell'], { cwd: repository });
    await writeFile(join(repository, 'src-player.ts'), 'export {};\n', 'utf8');

    expect(await readGitContext(repository)).toMatchObject({
      branch: 'feature/music-flow',
      latestCommit: 'feat: add player shell',
      changedFileCount: 1,
    });
  });

  it('returns null for a normal directory that is not a repository', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'melopulse-not-a-repository-'));
    tempDirectories.push(directory);

    await expect(readGitContext(directory)).resolves.toBeNull();
  });
});
