import * as z from 'zod/v4';
import { PlaylistIdSchema, ProviderSchema, type RecommendationResult } from '../schema.js';

export const McpRecommendationSchema = z.object({
  id: PlaylistIdSchema,
  title: z.string().min(1),
  source: ProviderSchema,
  reason: z.string().min(1),
  url: z.url(),
  playCommand: z.string().min(1),
});

export const McpRecommendationOutputSchema = z.object({
  recommendations: z.array(McpRecommendationSchema),
});

export type McpRecommendation = z.infer<typeof McpRecommendationSchema>;

export function adaptMcpRecommendations(results: readonly RecommendationResult[]): McpRecommendation[] {
  return results.map(({ playlist, reasons }) => {
    const id = PlaylistIdSchema.parse(playlist.id);
    return {
      id,
      title: playlist.title,
      source: playlist.source,
      reason: combineReasons(reasons),
      url: playlist.url,
      playCommand: `melopulse play ${id}`,
    };
  });
}

function combineReasons(reasons: readonly string[]): string {
  return reasons.map((reason) => reason.trim()).filter(Boolean).join(' ') || 'A local focus recommendation.';
}
