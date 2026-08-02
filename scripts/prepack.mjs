/* global URL, process */

import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const typescriptCli = require.resolve('typescript/bin/tsc');
const repository = resolve(fileURLToPath(new URL('..', import.meta.url)));
const buildOutput = join(repository, 'dist');
if (dirname(buildOutput) !== repository) throw new Error('Refusing to clean build output outside the repository.');
rmSync(buildOutput, { force: true, recursive: true });

const buildConfiguration = join(repository, 'tsconfig.build.json');
const result = spawnSync(process.execPath, [typescriptCli, '-p', buildConfiguration], {
  shell: false,
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
