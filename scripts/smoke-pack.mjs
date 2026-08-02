/* global URL, process */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repository = resolve(fileURLToPath(new URL('..', import.meta.url)));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let temporaryDirectory;
let tarballPath;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repository,
    encoding: 'utf8',
    shell: process.platform === 'win32' && command === npm,
    ...options,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}\n${result.stderr}`);
  }
  return result.stdout;
}

try {
  const packed = JSON.parse(run(npm, ['pack', '--json']));
  const filename = packed[0]?.filename;
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error('npm pack did not return a tarball filename.');
  }

  tarballPath = join(repository, filename);
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'melopulse-pack-'));
  run(npm, ['init', '-y'], { cwd: temporaryDirectory });
  run(npm, ['install', tarballPath], { cwd: temporaryDirectory });

  const configDirectory = join(temporaryDirectory, 'config');
  const output = run(process.execPath, [
    join(temporaryDirectory, 'node_modules', '@melolab', 'melopulse', 'dist', 'cli', 'index.js'),
    'recommend',
    '--no-git',
    '--json',
  ], {
    cwd: temporaryDirectory,
    env: { ...process.env, MELOPULSE_CONFIG_DIR: configDirectory },
  });
  const recommendations = JSON.parse(output);

  if (!Array.isArray(recommendations) || recommendations.length === 0) {
    throw new Error('The packed CLI returned no recommendations.');
  }

  process.stdout.write(`Packed-install smoke test passed for ${basename(tarballPath)}.\n`);
} finally {
  if (tarballPath) rmSync(tarballPath, { force: true });
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
}
