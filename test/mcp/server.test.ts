import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import { MeloPulseError } from '../../src/errors.js';
import { createMcpServer } from '../../src/mcp/server.js';
import type { RecommendationResult } from '../../src/schema.js';
import type { MeloPulseService } from '../../src/service.js';

type ServiceCall = { method: keyof MeloPulseService; input?: unknown };

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

function fakeService(calls: ServiceCall[] = []): MeloPulseService {
  return {
    addPlaylist: async (input) => {
      calls.push({ method: 'addPlaylist', input });
      return {
        id: 'spotify:debug',
        source: 'spotify',
        title: input.title ?? 'Spotify playlist',
        url: input.url,
        activityTags: input.activityTags ?? ['deep_focus'],
        moodTags: input.moodTags ?? [],
        energy: input.energy ?? 'medium',
        focus: input.focus ?? 'medium',
        vocals: input.vocals ?? 'any',
      };
    },
    listPlaylists: async (source) => {
      calls.push({ method: 'listPlaylists', input: source });
      return [recommendation.playlist];
    },
    recommend: async (input) => {
      calls.push({ method: 'recommend', input });
      return [recommendation];
    },
    syncCatalog: async () => {
      calls.push({ method: 'syncCatalog' });
      return { count: 1, playlists: [recommendation.playlist] };
    },
    play: async (id) => {
      calls.push({ method: 'play', input: id });
      return { id, url: 'https://melolab.ai/playlist/focus-flow' };
    },
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

  it("describes each tool's locality and side effects with complete annotations", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = createMcpServer(fakeService());
    client = new Client({ name: 'melopulse-test', version: '0.1.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    const byName = Object.fromEntries(tools.tools.map((tool) => [tool.name, tool]));

    expect(Object.fromEntries(tools.tools.map((tool) => [tool.name, tool.annotations]))).toMatchObject({
      melopulse_recommend: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      melopulse_add_playlist: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      melopulse_list_playlists: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      melopulse_sync_catalog: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    });
    expect(byName.melopulse_recommend?.description).toMatch(/local-only.*Git context.*does not upload code.*default limit of 3/i);
    expect(byName.melopulse_add_playlist?.description).toMatch(/locally.*HTTPS link.*tags.*no provider metadata.*duplicate URLs.*idempotently/i);
    expect(byName.melopulse_list_playlists?.description).toMatch(/local-only.*optional.*source.*filter/i);
    expect(byName.melopulse_sync_catalog?.description).toMatch(/only network.*contacts MeloLab.*prior cache.*failure/i);
    expect(byName.melopulse_recommend?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        activity: { enum: ['debugging', 'feature', 'reviewing', 'shipping', 'maintenance', 'deep_focus'] },
        limit: { minimum: 1, maximum: 5 },
      },
    });
    expect(byName.melopulse_add_playlist?.inputSchema).toMatchObject({
      type: 'object',
      properties: { energy: { enum: ['low', 'medium', 'high'] } },
    });
    expect(byName.melopulse_list_playlists?.inputSchema).toMatchObject({
      type: 'object',
      properties: { source: { enum: ['melolab', 'spotify', 'apple_music', 'youtube_music', 'generic'] } },
    });
  });

  it.each([
    {
      toolName: 'melopulse_recommend',
      arguments: { activity: 'fixing' },
      code: 'INVALID_ACTIVITY',
      suggestion: 'Call melopulse_recommend with activity set to one of: debugging, feature, reviewing, shipping, maintenance, or deep_focus.',
    },
    {
      toolName: 'melopulse_add_playlist',
      arguments: { url: 'https://open.spotify.com/playlist/test', energy: 'max' },
      code: 'INVALID_ENERGY',
      suggestion: 'Call melopulse_add_playlist with energy set to one of: low, medium, or high.',
    },
    {
      toolName: 'melopulse_list_playlists',
      arguments: { source: 'bandcamp' },
      code: 'INVALID_SOURCE',
      suggestion: 'Call melopulse_list_playlists with source set to one of: melolab, spotify, apple_music, youtube_music, or generic.',
    },
  ])('returns a structured ErrorView for malformed $toolName arguments before service work', async ({ toolName, arguments: arguments_, code, suggestion }) => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const calls: ServiceCall[] = [];
    server = createMcpServer(fakeService(calls));
    client = new Client({ name: 'melopulse-test', version: '0.1.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({ name: toolName, arguments: arguments_ });
    const errorText = JSON.parse(result.content[0]?.type === 'text' ? result.content[0].text : '');

    expect(result.isError).toBe(true);
    expect(errorText).toEqual({
      error: {
        code,
        message: expect.any(String),
        suggestion,
        retryable: false,
      },
    });
    expect(result.structuredContent).toEqual(errorText);
    expect(calls).toEqual([]);
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
    const errorText = JSON.parse(result.content[0]?.type === 'text' ? result.content[0].text : '');
    expect(result.structuredContent).toEqual(errorText);
    expect(errorText).toEqual({
      error: {
        code: 'MELOLAB_SYNC_NETWORK_ERROR',
        message: 'Unable to retrieve the MeloLab catalogue.',
        suggestion: 'Check the connection and call melopulse_sync_catalog again. The previous cache is unchanged.',
        retryable: true,
      },
    });
  });

  it.each([
    'playlist with spaces',
    'playlist;shutdown',
    'playlist$HOME',
    'playlist`command`',
    'playlist"quoted"',
    "playlist'quoted'",
    '-option-like',
  ])('rejects unsafe recommendation ID %j without emitting a play command', async (unsafeId) => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const service = fakeService();
    service.recommend = async () => [{
      ...recommendation,
      playlist: { ...recommendation.playlist, id: unsafeId },
    }];
    server = createMcpServer(service);
    client = new Client({ name: 'melopulse-test', version: '0.1.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: 'melopulse_recommend',
      arguments: { useGitContext: false },
    });
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';

    expect(result.isError).toBe(true);
    expect(JSON.parse(text)).toEqual({
      error: {
        code: 'INVALID_INPUT',
        message: 'The tool input is invalid.',
        suggestion: 'Call melopulse_recommend again with valid arguments.',
        retryable: false,
      },
    });
    expect(text).not.toContain('melopulse play');
    expect(result.structuredContent).toEqual(JSON.parse(text));
  });
});
