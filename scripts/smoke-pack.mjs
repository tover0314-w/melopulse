/* global URL, process */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repository = resolve(fileURLToPath(new URL('..', import.meta.url)));
const npmCli = resolveNpmCli();
let temporaryDirectory;
let tarballPath;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repository,
    encoding: 'utf8',
    ...options,
    shell: false,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}\n${result.stderr}`);
  }
  return result.stdout;
}

function runNpm(args, options) {
  return run(process.execPath, [npmCli, ...args], options);
}

function resolveNpmCli() {
  const fromNpm = process.env.npm_execpath;
  if (fromNpm && existsSync(fromNpm)) return fromNpm;

  const nodeDirectory = dirname(process.execPath);
  const candidates = [
    join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resolve(nodeDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resolve(nodeDirectory, '..', '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const fallback = candidates.find((candidate) => existsSync(candidate));

  if (fallback) return fallback;
  throw new Error('Unable to locate npm-cli.js. Run this script with npm or install npm alongside Node.js.');
}

try {
  const packed = JSON.parse(runNpm(['pack', '--json']));
  const filename = packed[0]?.filename;
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error('npm pack did not return a tarball filename.');
  }

  tarballPath = join(repository, filename);
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'melopulse-pack-'));
  runNpm(['init', '-y'], { cwd: temporaryDirectory });
  runNpm(['install', tarballPath], { cwd: temporaryDirectory });

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
