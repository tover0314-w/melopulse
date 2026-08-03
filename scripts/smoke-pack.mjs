/* global URL, process */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const repository = resolve(fileURLToPath(new URL('..', import.meta.url)));
const npmCli = resolveNpmCli();
let installationDirectory;
let configDirectory;
let tarballPath;
let cleanupError;

function runResult(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repository,
    encoding: 'utf8',
    ...options,
    shell: false,
  });

  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function run(command, args, options = {}) {
  const result = runResult(command, args, options);
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

async function verifyPackedMcp(cliPath, configDirectory, workingDirectory) {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliPath, 'mcp'],
    cwd: workingDirectory,
    env: { ...environment, MELOPULSE_CONFIG_DIR: configDirectory },
  });
  const client = new Client({ name: 'melopulse-pack-smoke', version: '0.1.0' });

  try {
    await client.connect(transport, { timeout: 10_000 });
    const tools = await client.listTools(undefined, { timeout: 10_000 });
    const names = tools.tools.map((tool) => tool.name).sort();
    const expectedNames = [
      'melopulse_add_playlist',
      'melopulse_list_playlists',
      'melopulse_recommend',
      'melopulse_sync_catalog',
    ];
    if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
      throw new Error(`The packed MCP server exposed unexpected tools: ${names.join(', ')}`);
    }

    const result = await client.callTool({
      name: 'melopulse_recommend',
      arguments: { useGitContext: false, limit: 1 },
    }, { timeout: 10_000 });
    if (result.isError) throw new Error('The packed MCP recommendation call returned an error.');
    const text = result.content[0];
    if (text?.type !== 'text') throw new Error('The packed MCP recommendation did not return text content.');
    const recommendations = JSON.parse(text.text);
    if (!Array.isArray(recommendations) || recommendations.length !== 1) {
      throw new Error('The packed MCP server returned an invalid recommendation list.');
    }
    const recommendation = recommendations[0];
    if (typeof recommendation !== 'object' || recommendation === null) {
      throw new Error('The packed MCP server returned an invalid recommendation.');
    }

    const fields = Object.keys(recommendation).sort();
    const expectedFields = ['id', 'playCommand', 'reason', 'source', 'title', 'url'];
    if (JSON.stringify(fields) !== JSON.stringify(expectedFields)) {
      throw new Error(`The packed MCP recommendation had unexpected fields: ${fields.join(', ')}`);
    }
    for (const field of expectedFields) {
      if (typeof recommendation[field] !== 'string' || recommendation[field].length === 0) {
        throw new Error(`The packed MCP recommendation field '${field}' was invalid.`);
      }
    }
    if (recommendation.playCommand !== `melopulse play ${recommendation.id}`) {
      throw new Error('The packed MCP recommendation returned an invalid playCommand.');
    }
    if (JSON.stringify(result.structuredContent) !== JSON.stringify({ recommendations })) {
      throw new Error('The packed MCP structured recommendation did not match its text content.');
    }

    process.stdout.write('Packed MCP smoke test passed with exactly four tools.\n');
  } finally {
    try {
      await client.close();
    } finally {
      await transport.close();
    }
  }
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJson(value, description) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${description} was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function cleanTemporaryLocation(location) {
  if (!location) return;
  rmSync(location, { recursive: true, force: true });
  if (existsSync(location)) throw new Error(`Temporary location was not removed: ${location}`);
}

try {
  const packed = JSON.parse(runNpm(['pack', '--json']));
  const filename = packed[0]?.filename;
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error('npm pack did not return a tarball filename.');
  }

  tarballPath = join(repository, filename);
  installationDirectory = mkdtempSync(join(tmpdir(), 'melopulse-pack-install-'));
  configDirectory = mkdtempSync(join(tmpdir(), 'melopulse-pack-config-'));
  runNpm(['init', '-y'], { cwd: installationDirectory });
  runNpm(['install', tarballPath], { cwd: installationDirectory });

  const installedCli = join(installationDirectory, 'node_modules', '@melolab', 'melopulse', 'dist', 'cli', 'index.js');
  const environment = { ...process.env, MELOPULSE_CONFIG_DIR: configDirectory };

  const help = run(process.execPath, [installedCli, '--help'], {
    cwd: installationDirectory,
    env: environment,
  });
  requireCondition(help.includes('Quick start:'), 'The packed CLI help did not include a quick start.');
  requireCondition(help.includes('list [options]'), 'The packed CLI help did not include the list command.');
  requireCondition(help.includes('Offline by default. Only sync contacts MeloLab.'), 'The packed CLI help did not state the network boundary.');

  const version = run(process.execPath, [installedCli, '--version'], {
    cwd: installationDirectory,
    env: environment,
  });
  requireCondition(version === '0.2.0\n', `The packed CLI version was ${JSON.stringify(version)} instead of "0.2.0\\n".`);
  process.stdout.write('Packed CLI help smoke passed.\n');

  const output = run(process.execPath, [
    installedCli,
    'recommend',
    '--no-git',
    '--json',
  ], {
    cwd: installationDirectory,
    env: environment,
  });
  const recommendations = parseJson(output, 'The packed CLI recommendation output');

  requireCondition(Array.isArray(recommendations) && recommendations.length > 0, 'The packed CLI returned no recommendations.');

  const saved = parseJson(run(process.execPath, [
    installedCli,
    'add',
    'https://open.spotify.com/playlist/pack-smoke',
    '--title',
    'Pack Smoke',
    '--json',
  ], {
    cwd: installationDirectory,
    env: environment,
  }), 'The packed CLI add output');
  requireCondition(typeof saved === 'object' && saved !== null && typeof saved.id === 'string' && saved.id.length > 0, 'The packed CLI add output did not include a saved playlist ID.');

  const listed = parseJson(run(process.execPath, [installedCli, 'list', '--source', 'spotify', '--json'], {
    cwd: installationDirectory,
    env: environment,
  }), 'The packed CLI list output');
  requireCondition(JSON.stringify(listed) === JSON.stringify([saved]), 'The packed CLI list output did not contain exactly the saved Spotify playlist.');
  process.stdout.write('Packed CLI catalogue smoke passed.\n');

  const missing = runResult(process.execPath, [installedCli, 'play', 'missing', '--json'], {
    cwd: installationDirectory,
    env: environment,
  });
  requireCondition(missing.status === 1, `The packed CLI missing-playlist command exited with ${missing.status ?? 'unknown'} instead of 1.`);
  requireCondition(missing.stdout === '', 'The packed CLI JSON error wrote to stdout.');
  requireCondition(missing.stderr.endsWith('\n') && missing.stderr.trim().split(/\r?\n/).length === 1, 'The packed CLI JSON error was not exactly one line.');
  const missingError = parseJson(missing.stderr, 'The packed CLI missing-playlist error');
  requireCondition(
    typeof missingError === 'object'
      && missingError !== null
      && typeof missingError.error === 'object'
      && missingError.error !== null
      && missingError.error.code === 'PLAYLIST_NOT_FOUND'
      && typeof missingError.error.message === 'string'
      && typeof missingError.error.suggestion === 'string'
      && missingError.error.retryable === false,
    'The packed CLI missing-playlist error was not a safe JSON error.',
  );
  process.stdout.write('Packed CLI JSON error smoke passed.\n');

  await verifyPackedMcp(installedCli, configDirectory, installationDirectory);
  process.stdout.write(`Packed-install smoke test passed for ${basename(tarballPath)}.\n`);
} finally {
  const cleanupErrors = [];
  for (const location of [tarballPath, installationDirectory, configDirectory]) {
    try {
      cleanTemporaryLocation(location);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length > 0) cleanupError = new AggregateError(cleanupErrors, 'Packed smoke cleanup failed.');
}

if (cleanupError) throw cleanupError;
