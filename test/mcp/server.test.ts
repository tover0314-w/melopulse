import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import { MeloPulseError } from '../../src/errors.js';
import { createMcpServer } from '../../src/mcp/server.js';
import type { RecommendationResult } from '../../src/schema.js';
import type { MeloPulseService } from '../../src/service.js';

const recommendation: RecommendationResult = {
  playlist: {
    id: 'melolab:focus-flow',
    source: 'melolab',
    title: 'Focus Flow',
    url: 'https://melolab.ai/playlist/focus-flow',
    activityTags: ['debugging'],
    moodTags: [],
    energy: 'low',
    focus: 'high',
    vocals: 'none',
  },
  score: 8,
  reasons: [
    'Fits debugging work with high focus.',
    'Keeps vocal distraction low.',
  ],
};

function fakeService(): MeloPulseService {
  return {
    addPlaylist: async (input) => ({
      id: 'spotify:debug',
      source: 'spotify',
      title: input.title ?? 'Spotify playlist',
      url: input.url,
      activityTags: input.activityTags ?? ['deep_focus'],
      moodTags: input.moodTags ?? [],
      energy: input.energy ?? 'medium',
      focus: input.focus ?? 'medium',
      vocals: input.vocals ?? 'any',
    }),
    listPlaylists: async () => [recommendation.playlist],
    recommend: async () => [recommendation],
    syncCatalog: async () => ({ count: 1, playlists: [recommendation.playlist] }),
    play: async (id) => ({ id, url: 'https://melolab.ai/playlist/focus-flow' }),
  };
}

describe('MeloPulse MCP server', () => {
  let client: Client | undefined;
  let server: ReturnType<typeof createMcpServer> | undefined;

  afterEach(async () => {
    await client?.close();
    await server?.close();
  });

  it('lists the four public tools and returns flat recommendation JSON with matching structured content', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = createMcpServer(fakeService());
    client = new Client({ name: 'melopulse-test', version: '0.1.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    const result = await client.callTool({
      name: 'melopulse_recommend',
      arguments: { activity: 'debugging', useGitContext: false },
    });

    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      'melopulse_add_playlist',
      'melopulse_list_playlists',
      'melopulse_recommend',
      'melopulse_sync_catalog',
    ]);
    const textRecommendations = JSON.parse(result.content[0]?.type === 'text' ? result.content[0].text : '');
    const expectedRecommendations = [{
      id: 'melolab:focus-flow',
      title: 'Focus Flow',
      source: 'melolab',
      reason: 'Fits debugging work with high focus. Keeps vocal distraction low.',
      url: 'https://melolab.ai/playlist/focus-flow',
      playCommand: 'melopulse play melolab:focus-flow',
    }];

    expect(textRecommendations).toEqual(expectedRecommendations);
    expect(result.structuredContent).toEqual({ recommendations: textRecommendations });
  });

  it('returns a stable structured error when the service rejects a tool call', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const service = fakeService();
    service.syncCatalog = async () => { throw new MeloPulseError('MELOLAB_SYNC_NETWORK_ERROR', 'Unable to retrieve the MeloLab catalogue.'); };
    server = createMcpServer(service);
    client = new Client({ name: 'melopulse-test', version: '0.1.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({ name: 'melopulse_sync_catalog', arguments: {} });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.type === 'text' ? result.content[0].text : '')).toEqual({
      error: {
        code: 'MELOLAB_SYNC_NETWORK_ERROR',
        message: 'Unable to retrieve the MeloLab catalogue.',
      },
    });
  });
});
