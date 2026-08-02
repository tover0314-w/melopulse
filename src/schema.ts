import { z } from 'zod';

export const ProviderSchema = z.enum(['melolab', 'spotify', 'apple_music', 'youtube_music', 'generic']);
export const ActivitySchema = z.enum(['debugging', 'feature', 'reviewing', 'shipping', 'maintenance', 'deep_focus']);
export const EnergySchema = z.enum(['low', 'medium', 'high']);
export const FocusSchema = z.enum(['low', 'medium', 'high']);
export const VocalsSchema = z.enum(['none', 'low', 'any']);
export const PlaylistIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]*$/, {
  message: 'Playlist ID must be a shell-safe token',
});

const HttpsUrlSchema = z.url().refine((value) => value.startsWith('https://'), {
  message: 'URL must use HTTPS',
});

export const PlaylistRecordSchema = z.object({
  id: PlaylistIdSchema,
  source: ProviderSchema,
  title: z.string().min(1),
  url: HttpsUrlSchema,
  coverUrl: HttpsUrlSchema.optional(),
  activityTags: z.array(ActivitySchema),
  moodTags: z.array(z.string().min(1)),
  energy: EnergySchema,
  focus: FocusSchema,
  vocals: VocalsSchema,
});

export const AddPlaylistInputSchema = z.object({
  url: HttpsUrlSchema,
  title: z.string().min(1).optional(),
  activityTags: z.array(ActivitySchema).optional(),
  moodTags: z.array(z.string().min(1)).optional(),
  energy: EnergySchema.optional(),
  focus: FocusSchema.optional(),
  vocals: VocalsSchema.optional(),
});

export const RecommendationInputSchema = z.object({
  activity: ActivitySchema.optional(),
  mood: z.string().min(1).optional(),
  energy: EnergySchema.optional(),
  focus: FocusSchema.optional(),
  vocals: VocalsSchema.optional(),
  useGitContext: z.boolean().default(true),
  limit: z.number().int().min(1).max(5).default(3),
});

export const RecommendationResultSchema = z.object({
  playlist: PlaylistRecordSchema,
  score: z.number(),
  reasons: z.array(z.string()),
});

export type Provider = z.infer<typeof ProviderSchema>;
export type Activity = z.infer<typeof ActivitySchema>;
export type Energy = z.infer<typeof EnergySchema>;
export type Focus = z.infer<typeof FocusSchema>;
export type Vocals = z.infer<typeof VocalsSchema>;
export type PlaylistRecord = z.infer<typeof PlaylistRecordSchema>;
export type AddPlaylistInput = z.infer<typeof AddPlaylistInputSchema>;
export type RecommendationInput = z.infer<typeof RecommendationInputSchema>;
export type RecommendationResult = z.infer<typeof RecommendationResultSchema>;
