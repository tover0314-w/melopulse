import { McpServer, type StandardSchemaWithJSON } from '@modelcontextprotocol/server';
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
    inputSchema: deferToolInputValidation(RecommendInputSchema),
    outputSchema: McpRecommendationOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => executeValidatedToolInput(
    'melopulse_recommend',
    RecommendInputSchema,
    input,
    async ({ workspacePath = process.cwd(), ...recommendInput }) => {
      const recommendations = adaptMcpRecommendations(await service.recommend(recommendInput, { workspacePath }));
      return { text: recommendations, structuredContent: { recommendations } };
    },
  ));

  server.registerTool('melopulse_add_playlist', {
    title: 'Add a local playlist',
    description: 'Locally saves one HTTPS link and supplied tags, fetches no provider metadata, and updates duplicate URLs idempotently.',
    inputSchema: deferToolInputValidation(AddPlaylistInputSchema),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => executeValidatedToolInput(
    'melopulse_add_playlist',
    AddPlaylistInputSchema,
    input,
    async (addInput) => {
      const playlist = await service.addPlaylist(addInput);
      return { text: playlist, structuredContent: { playlist } };
    },
  ));

  server.registerTool('melopulse_list_playlists', {
    title: 'List local playlists',
    description: 'Local-only catalogue listing with an optional source filter.',
    inputSchema: deferToolInputValidation(ListPlaylistsInputSchema),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => executeValidatedToolInput(
    'melopulse_list_playlists',
    ListPlaylistsInputSchema,
    input,
    async ({ source }) => {
      const playlists = await service.listPlaylists(source);
      return { text: playlists, structuredContent: { playlists } };
    },
  ));

  server.registerTool('melopulse_sync_catalog', {
    title: 'Sync the MeloLab catalogue',
    description: 'The only network tool: contacts MeloLab to update the local cache and preserves the prior cache on failure.',
    inputSchema: deferToolInputValidation(SyncCatalogInputSchema),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (input) => executeValidatedToolInput(
    'melopulse_sync_catalog',
    SyncCatalogInputSchema,
    input,
    async () => {
      const result = await service.syncCatalog();
      return { text: result, structuredContent: result };
    },
  ));

  return server;
}

async function executeValidatedToolInput<Schema extends z.ZodType>(
  toolName: string,
  schema: Schema,
  input: unknown,
  operation: (input: z.output<Schema>) => Promise<ToolSuccess>,
) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return toolError(parsed.error, toolName);
  return execute(() => operation(parsed.data), toolName);
}

async function execute(operation: () => Promise<ToolSuccess>, toolName: string) {
  try {
    const result = await operation();
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result.text) }],
      structuredContent: result.structuredContent,
    };
  } catch (error) {
    return toolError(error, toolName);
  }
}

function toolError(error: unknown, toolName: string) {
  const details = { error: toErrorView(error, { surface: 'mcp', toolName }) };
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify(details) }],
    structuredContent: details,
  };
}

/**
 * MCP SDK 2 validates a registered Standard Schema before invoking its tool
 * callback and flattens failures to plain text. Keep the original JSON Schema
 * converter for tools/list, but defer only runtime validation so the callback
 * can immediately parse with the same Zod schema and return a stable ErrorView.
 */
function deferToolInputValidation(schema: StandardSchemaWithJSON): StandardSchemaWithJSON {
  const standard = schema['~standard'];
  return {
    '~standard': {
      ...standard,
      validate: (value: unknown) => ({ value }),
    },
  };
}
