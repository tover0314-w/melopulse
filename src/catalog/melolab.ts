import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { MeloPulseError } from '../errors.js';
import { PlaylistIdSchema, type PlaylistRecord } from '../schema.js';
import type { CatalogStorage } from './storage.js';

export const MELOLAB_CATALOG_ENDPOINT = 'https://melolab.ai/api/playlists/public/featured';

const MELOLAB_ORIGIN = 'https://melolab.ai';
const ENCODED_MELOLAB_ID_PREFIX = 'b64.';
const AbsoluteHttpsUrlSchema = z.url().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}).transform((value) => new URL(value).href);
const MeloLabRootRelativeUrlSchema = z.string()
  .regex(/^\/(?!\/)[^\\]*$/)
  .transform((value) => new URL(value, MELOLAB_ORIGIN))
  .refine((url) => url.origin === MELOLAB_ORIGIN && url.username === '' && url.password === '')
  .transform((url) => url.href);

const MeloLabPlaylistSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  cover_url: z.union([AbsoluteHttpsUrlSchema, MeloLabRootRelativeUrlSchema]).nullable().optional(),
  is_public: z.boolean().optional().default(false),
  song_count: z.number().int().nonnegative().optional(),
});

const MeloLabCatalogueSchema = z.object({ playlists: z.array(MeloLabPlaylistSchema) });

type FetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;

export interface SyncMeloLabCatalogueOptions {
  storage: CatalogStorage;
  fetchImpl?: FetchImplementation;
  endpoint?: string;
  timeoutMs?: number;
}

function inferTags(value: string): Pick<PlaylistRecord, 'activityTags' | 'energy' | 'focus' | 'vocals'> {
  if (/focus|study|ambient|lo-fi|downtempo/.test(value)) {
    return { activityTags: ['deep_focus', 'debugging', 'reviewing'], energy: 'low', focus: 'high', vocals: 'none' };
  }
  if (/neon|run|dance|spotlight/.test(value)) {
    return { activityTags: ['feature', 'shipping'], energy: 'high', focus: 'medium', vocals: 'any' };
  }
  if (/cinema|road|folk/.test(value)) {
    return { activityTags: ['reviewing', 'maintenance'], energy: 'medium', focus: 'high', vocals: 'low' };
  }
  if (/after dark|r&b|soul/.test(value)) {
    return { activityTags: ['maintenance', 'deep_focus'], energy: 'low', focus: 'medium', vocals: 'any' };
  }
  return { activityTags: ['deep_focus'], energy: 'medium', focus: 'medium', vocals: 'any' };
}

export function normalizeMeloLabCatalogue(payload: unknown): PlaylistRecord[] {
  const catalogue = MeloLabCatalogueSchema.parse(payload);

  return catalogue.playlists
    .filter((playlist) => playlist.is_public)
    .map((playlist) => {
      const tags = inferTags(`${playlist.id} ${playlist.name} ${playlist.description ?? ''}`.toLowerCase());
      return {
        id: normalizeMeloLabPlaylistId(playlist.id),
        source: 'melolab',
        title: playlist.name,
        url: `https://melolab.ai/playlist/${encodeURIComponent(playlist.id)}`,
        ...(playlist.cover_url === null || playlist.cover_url === undefined ? {} : { coverUrl: playlist.cover_url }),
        moodTags: [],
        ...tags,
      };
    });
}

function normalizeMeloLabPlaylistId(remoteId: string): string {
  const unchanged = `melolab:${remoteId}`;
  if (!remoteId.startsWith(ENCODED_MELOLAB_ID_PREFIX) && PlaylistIdSchema.safeParse(unchanged).success) {
    return unchanged;
  }

  const encoded = Buffer.from(remoteId, 'utf8').toString('base64url');
  return PlaylistIdSchema.parse(`melolab:${ENCODED_MELOLAB_ID_PREFIX}${encoded}`);
}

export async function syncMeloLabCatalogue(options: SyncMeloLabCatalogueOptions): Promise<{ count: number; playlists: PlaylistRecord[] }> {
  const controller = new AbortController();
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutError = new MeloPulseError('MELOLAB_SYNC_TIMEOUT_ERROR', 'MeloLab catalogue synchronization timed out.');
  let timedOut = false;
  let rejectTimeout: (error: MeloPulseError) => void;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(timeoutError);
    rejectTimeout(timeoutError);
  }, options.timeoutMs ?? 10_000);

  const throwIfTimedOut = (): void => {
    if (timedOut) throw timeoutError;
  };

  const fetchAndNormalize = async (): Promise<PlaylistRecord[]> => {
    let response: Response;
    try {
      response = await fetchImpl(options.endpoint ?? MELOLAB_CATALOG_ENDPOINT, { signal: controller.signal });
    } catch (error) {
      if (timedOut) throw timeoutError;
      throw new MeloPulseError('MELOLAB_SYNC_NETWORK_ERROR', 'Unable to retrieve the MeloLab catalogue.', { cause: error });
    }

    throwIfTimedOut();
    if (!response.ok) {
      throw new MeloPulseError('MELOLAB_SYNC_HTTP_ERROR', `MeloLab catalogue request failed with status ${response.status}.`);
    }

    let playlists: PlaylistRecord[];
    try {
      const payload = await response.json();
      throwIfTimedOut();
      playlists = normalizeMeloLabCatalogue(payload);
    } catch (error) {
      if (timedOut) throw timeoutError;
      throw new MeloPulseError('MELOLAB_SYNC_INVALID_RESPONSE', 'MeloLab returned an invalid catalogue response.', { cause: error });
    }

    throwIfTimedOut();
    return playlists;
  };

  let playlists: PlaylistRecord[];
  try {
    playlists = await Promise.race([fetchAndNormalize(), deadline]);
  } finally {
    clearTimeout(timeout);
  }

  await options.storage.saveMeloLabCache(playlists);
  return { count: playlists.length, playlists };
}
