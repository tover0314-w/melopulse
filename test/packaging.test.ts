import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runProcess, type ProcessResult } from './helpers/run-process.js';

const repository = process.cwd();

function npmCliPath(): string {
  const configured = process.env.npm_execpath;
  if (configured && existsSync(configured)) return configured;

  const nodeDirectory = dirname(process.execPath);
  const candidates = [
    join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resolve(nodeDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resolve(nodeDirectory, '..', '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const fallback = candidates.find((candidate) => existsSync(candidate));
  if (!fallback) throw new Error('Unable to locate npm-cli.js for packaging tests.');
  return fallback;
}

function run(command: string, arguments_: string[], cwd: string): Promise<ProcessResult> {
  return runProcess(command, arguments_, { cwd, timeoutMs: 90_000 });
}

async function cleanSourceCopy(): Promise<{ parent: string; source: string }> {
  const parent = await mkdtemp(join(tmpdir(), 'melopulse clean pack & '));
  const source = join(parent, 'source with spaces');
  await Promise.all([
    ...['src', 'docs', 'examples', 'scripts'].map((directory) => cp(join(repository, directory), join(source, directory), { recursive: true })),
    ...[
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'tsconfig.build.json',
      'README.md',
      'LICENSE',
      'CHANGELOG.md',
    ].map((file) => cp(join(repository, file), join(source, file))),
  ]);
  await symlink(join(repository, 'node_modules'), join(source, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  return { parent, source };
}

describe('release packaging', () => {
  it('builds runtime files when packing a clean source checkout without dist', async () => {
    const copy = await cleanSourceCopy();
    let tarball: string | undefined;

    try {
      expect(existsSync(join(copy.source, 'dist'))).toBe(false);

      const result = await run(process.execPath, [npmCliPath(), 'pack', '--json'], copy.source);
      expect(result.code, result.stderr).toBe(0);
      const pack = JSON.parse(result.stdout)[0] as { filename: string; files: Array<{ path: string }> };
      tarball = join(copy.source, pack.filename);
      const files = pack.files.map((file) => file.path);

      expect(files).toEqual(expect.arrayContaining([
        'dist/cli/index.js',
        'dist/index.js',
        'dist/mcp/index.js',
        'dist/mcp/recommendation-output.js',
        'dist/mcp/server.js',
      ]));
    } finally {
      if (tarball) await rm(tarball, { force: true });
      await rm(copy.parent, { recursive: true, force: true });
      expect(existsSync(copy.parent)).toBe(false);
    }
  }, 120_000);

  it('removes stale generated files before creating the tarball', async () => {
    const copy = await cleanSourceCopy();
    let tarball: string | undefined;

    try {
      await mkdir(join(copy.source, 'dist'));
      await writeFile(join(copy.source, 'dist', 'stale.js'), 'throw new Error("stale output");\n', 'utf8');

      const result = await run(process.execPath, [npmCliPath(), 'pack', '--json'], copy.source);
      expect(result.code, result.stderr).toBe(0);
      const pack = JSON.parse(result.stdout)[0] as { filename: string; files: Array<{ path: string }> };
      tarball = join(copy.source, pack.filename);

      expect(pack.files.map((file) => file.path)).not.toContain('dist/stale.js');
    } finally {
      if (tarball) await rm(tarball, { force: true });
      await rm(copy.parent, { recursive: true, force: true });
      expect(existsSync(copy.parent)).toBe(false);
    }
  }, 120_000);

  it('provides public declarations to an installed TypeScript consumer without exporting internals', async () => {
    const copy = await cleanSourceCopy();
    let tarball: string | undefined;

    try {
      const packResult = await run(process.execPath, [npmCliPath(), 'pack', '--json'], copy.source);
      expect(packResult.code, packResult.stderr).toBe(0);
      const pack = JSON.parse(packResult.stdout)[0] as { filename: string; files: Array<{ path: string }> };
      tarball = join(copy.source, pack.filename);
      const files = pack.files.map((file) => file.path);

      expect(files).toEqual(expect.arrayContaining([
        'dist/index.d.ts',
        'dist/schema.d.ts',
        'dist/service.d.ts',
      ]));

      const consumer = join(copy.parent, 'typed consumer');
      await mkdir(consumer);
      const initialize = await run(process.execPath, [npmCliPath(), 'init', '-y'], consumer);
      expect(initialize.code, initialize.stderr).toBe(0);
      const install = await run(process.execPath, [npmCliPath(), 'install', '--ignore-scripts', tarball], consumer);
      expect(install.code, install.stderr).toBe(0);

      const installedPackageDirectory = join(consumer, 'node_modules', '@melolab', 'melopulse');
      const metadata = JSON.parse(await readFile(join(installedPackageDirectory, 'package.json'), 'utf8')) as {
        types?: string;
        exports?: unknown;
      };
      expect(metadata.types).toBe('./dist/index.d.ts');
      expect(metadata.exports).toEqual({
        '.': {
          types: './dist/index.d.ts',
          import: './dist/index.js',
          default: './dist/index.js',
        },
      });
      expect(await readFile(join(installedPackageDirectory, 'dist', 'index.d.ts'), 'utf8')).not.toContain('catalog/storage');

      await writeFile(join(consumer, 'consumer.ts'), `
import { ActivitySchema, PlaylistRecordSchema, createMeloPulseService } from '@melolab/melopulse';
import type { Activity, MeloPulseService, PlaylistRecord, RecommendationInput } from '@melolab/melopulse';

const activity: Activity = ActivitySchema.parse('debugging');
const playlist: PlaylistRecord = PlaylistRecordSchema.parse({
  id: 'melolab:focus-flow',
  source: 'melolab',
  title: 'Focus Flow',
  url: 'https://melolab.ai/playlist/focus-flow',
  activityTags: [activity],
  moodTags: [],
  energy: 'low',
  focus: 'high',
  vocals: 'none',
});
const input: RecommendationInput = { activity, useGitContext: false, limit: 1 };
const service: MeloPulseService = createMeloPulseService();
void [playlist, input, service];
`, 'utf8');
      await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          target: 'ES2023',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
        },
        include: ['consumer.ts'],
      }), 'utf8');

      const typecheck = await run(process.execPath, [
        join(repository, 'node_modules', 'typescript', 'bin', 'tsc'),
        '-p',
        join(consumer, 'tsconfig.json'),
      ], consumer);
      expect(typecheck.code, `${typecheck.stdout}\n${typecheck.stderr}`).toBe(0);
    } finally {
      if (tarball) await rm(tarball, { force: true });
      await rm(copy.parent, { recursive: true, force: true });
      expect(existsSync(copy.parent)).toBe(false);
    }
  }, 120_000);
});
