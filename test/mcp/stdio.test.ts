import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'melopulse-mcp-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('melopulse mcp stdio server', () => {
  it('lists four tools and recommends one playlist from the built CLI without network access', async () => {
    const dataDir = await temporaryDirectory();
    const client = new Client({ name: 'melopulse-test', version: '0.1.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['dist/cli/index.js', 'mcp'],
      cwd: process.cwd(),
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
        MELOPULSE_CONFIG_DIR: dataDir,
      },
    });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      const result = await client.callTool({
        name: 'melopulse_recommend',
        arguments: { useGitContext: false, limit: 1 },
      });

      expect(tools.tools).toHaveLength(4);
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        'melopulse_add_playlist',
        'melopulse_list_playlists',
        'melopulse_recommend',
        'melopulse_sync_catalog',
      ]);
      expect(JSON.parse(result.content[0]?.type === 'text' ? result.content[0].text : '')).toHaveLength(1);
    } finally {
      await client.close();
    }
  });
});
