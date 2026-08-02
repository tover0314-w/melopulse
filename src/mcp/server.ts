import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { MeloPulseError } from '../errors.js';
import { AddPlaylistInputSchema, ProviderSchema, RecommendationInputSchema } from '../schema.js';
import type { MeloPulseService } from '../service.js';

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
  const server = new McpServer({ name: 'melopulse', version: '0.1.0' });

  server.registerTool('melopulse_recommend', {
    title: 'Recommend coding playlists',
    description: 'Recommend local coding playlists for an activity or workspace.',
    inputSchema: RecommendInputSchema,
    annotations: { readOnlyHint: true },
  }, async ({ workspacePath = process.cwd(), ...input }) => execute(async () => {
    const recommendations = await service.recommend(input, { workspacePath });
    return { text: recommendations, structuredContent: { recommendations } };
  }));

  server.registerTool('melopulse_add_playlist', {
    title: 'Add a local playlist',
    description: 'Add a playlist to the local MeloPulse catalogue.',
    inputSchema: AddPlaylistInputSchema,
  }, async (input) => execute(async () => {
    const playlist = await service.addPlaylist(input);
    return { text: playlist, structuredContent: { playlist } };
  }));

  server.registerTool('melopulse_list_playlists', {
    title: 'List local playlists',
    description: 'List playlists available in the local MeloPulse catalogue.',
    inputSchema: ListPlaylistsInputSchema,
    annotations: { readOnlyHint: true },
  }, async ({ source }) => execute(async () => {
    const playlists = await service.listPlaylists(source);
    return { text: playlists, structuredContent: { playlists } };
  }));

  server.registerTool('melopulse_sync_catalog', {
    title: 'Sync the MeloLab catalogue',
    description: 'Contacts MeloLab and updates the local cache with the latest catalogue.',
    inputSchema: SyncCatalogInputSchema,
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
  const details = error instanceof MeloPulseError
    ? { code: error.code, message: error.message }
    : { code: 'INTERNAL_ERROR', message: 'An unexpected internal error occurred.' };
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({ error: details }) }],
  };
}
