import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { toErrorView } from '../cli/error-view.js';
import { AddPlaylistInputSchema, ProviderSchema, RecommendationInputSchema } from '../schema.js';
import type { MeloPulseService } from '../service.js';
import { MELOPULSE_VERSION } from '../version.js';
import { adaptMcpRecommendations, McpRecommendationOutputSchema } from './recommendation-output.js';

const RecommendInputSchema = RecommendationInputSchema.extend({
  workspacePath: z.string().min(1).optional(),
});

const ListPlaylistsInputSchema = z.object({
  source: ProviderSchema.optional(),
});

const SyncCatalogInputSchema = z.object({});

type ToolSuccess = {
  text: unknown;
  structuredContent: Record<string, unknown>;
};

export function createMcpServer(service: MeloPulseService): McpServer {
  const server = new McpServer({ name: 'melopulse', version: MELOPULSE_VERSION });

  server.registerTool('melopulse_recommend', {
    title: 'Recommend coding playlists',
    description: 'Local-only recommendations for an activity or workspace. Optionally uses safe Git context, does not upload code, and has a default limit of 3.',
    inputSchema: RecommendInputSchema,
    outputSchema: McpRecommendationOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ workspacePath = process.cwd(), ...input }) => execute(async () => {
    const recommendations = adaptMcpRecommendations(await service.recommend(input, { workspacePath }));
    return { text: recommendations, structuredContent: { recommendations } };
  }));

  server.registerTool('melopulse_add_playlist', {
    title: 'Add a local playlist',
    description: 'Locally saves one HTTPS link and supplied tags, fetches no provider metadata, and updates duplicate URLs idempotently.',
    inputSchema: AddPlaylistInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => execute(async () => {
    const playlist = await service.addPlaylist(input);
    return { text: playlist, structuredContent: { playlist } };
  }));

  server.registerTool('melopulse_list_playlists', {
    title: 'List local playlists',
    description: 'Local-only catalogue listing with an optional source filter.',
    inputSchema: ListPlaylistsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ source }) => execute(async () => {
    const playlists = await service.listPlaylists(source);
    return { text: playlists, structuredContent: { playlists } };
  }));

  server.registerTool('melopulse_sync_catalog', {
    title: 'Sync the MeloLab catalogue',
    description: 'The only network tool: contacts MeloLab to update the local cache and preserves the prior cache on failure.',
    inputSchema: SyncCatalogInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async () => execute(async () => {
    const result = await service.syncCatalog();
    return { text: result, structuredContent: result };
  }));

  return server;
}

async function execute(operation: () => Promise<ToolSuccess>) {
  try {
    const result = await operation();
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result.text) }],
      structuredContent: result.structuredContent,
    };
  } catch (error) {
    return toolError(error);
  }
}

function toolError(error: unknown) {
  const details = { error: toErrorView(error) };
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify(details) }],
    structuredContent: details,
  };
}
