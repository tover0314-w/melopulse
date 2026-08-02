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
  const installedCli = join(temporaryDirectory, 'node_modules', '@melolab', 'melopulse', 'dist', 'cli', 'index.js');
  const output = run(process.execPath, [
    installedCli,
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

  await verifyPackedMcp(installedCli, configDirectory, temporaryDirectory);
  process.stdout.write(`Packed-install smoke test passed for ${basename(tarballPath)}.\n`);
} finally {
  if (tarballPath) rmSync(tarballPath, { force: true });
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
}
