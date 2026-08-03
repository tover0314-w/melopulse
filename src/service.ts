import open from 'open';
import { z } from 'zod';
import { BUNDLED_PLAYLISTS } from './catalog/bundled.js';
import { mergeCatalogues } from './catalog/merge.js';
import { resolveDataDir } from './catalog/paths.js';
import { syncMeloLabCatalogue } from './catalog/melolab.js';
import { CatalogStorage } from './catalog/storage.js';
import { MeloPulseError } from './errors.js';
import { readGitContext } from './git-context.js';
import { createPlaylistId, detectProvider, normalizePlaylistUrl } from './platform.js';
import { recommendPlaylists } from './recommendation.js';
import {
  AddPlaylistInputSchema,
  PlaylistIdSchema,
  ProviderSchema,
  RecommendationInputSchema,
  type AddPlaylistInput,
  type PlaylistRecord,
  type Provider,
  type RecommendationInput,
  type RecommendationResult,
} from './schema.js';

type FetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;
type OpenUrl = (url: string) => Promise<unknown>;

const PlayInputSchema = z.object({ playlistId: PlaylistIdSchema });

export interface MeloPulseService {
  addPlaylist(input: AddPlaylistInput): Promise<PlaylistRecord>;
  listPlaylists(source?: Provider): Promise<PlaylistRecord[]>;
  recommend(input: RecommendationInput, options?: { workspacePath?: string }): Promise<RecommendationResult[]>;
  syncCatalog(): Promise<{ count: number; playlists: PlaylistRecord[] }>;
  play(id: string): Promise<{ id: string; url: string }>;
}

export interface CreateMeloPulseServiceOptions {
  dataDir?: string;
  cwd?: string;
  fetchImpl?: FetchImplementation;
  openUrl?: OpenUrl;
}

class PlaylistOpenError extends MeloPulseError {
  constructor(readonly url: string, cause: unknown) {
    super('PLAYLIST_OPEN_ERROR', 'Unable to open the playlist URL.', { cause });
  }
}

export function createMeloPulseService(options: CreateMeloPulseServiceOptions = {}): MeloPulseService {
  const storage = new CatalogStorage(options.dataDir ?? resolveDataDir());
  const cwd = options.cwd ?? process.cwd();
  const openUrl: OpenUrl = options.openUrl ?? ((url) => open(url));

  const allPlaylists = async (): Promise<PlaylistRecord[]> => mergeCatalogues(
    BUNDLED_PLAYLISTS,
    await storage.loadMeloLabCache(),
    await storage.loadUserPlaylists(),
  );

  return {
    async addPlaylist(input) {
      const parsed = AddPlaylistInputSchema.parse(input);
      const url = normalizePlaylistUrl(parsed.url);
      const source = detectProvider(url);
      const record: PlaylistRecord = {
        id: `${source}:${createPlaylistId(source, url)}`,
        source,
        title: parsed.title ?? `${providerDisplayName(source)} playlist`,
        url: url.href,
        activityTags: parsed.activityTags ?? ['deep_focus'],
        moodTags: parsed.moodTags ?? [],
        energy: parsed.energy ?? 'medium',
        focus: parsed.focus ?? 'medium',
        vocals: parsed.vocals ?? 'any',
      };
      const existing = await storage.loadUserPlaylists();
      const index = existing.findIndex((playlist) => playlist.id === record.id);
      if (index === -1) existing.push(record);
      else existing[index] = record;
      await storage.saveUserPlaylists(existing);
      return record;
    },

    async listPlaylists(source) {
      const playlists = await allPlaylists();
      return source === undefined ? playlists : playlists.filter((playlist) => playlist.source === ProviderSchema.parse(source));
    },

    async recommend(input, recommendOptions) {
      const parsed = RecommendationInputSchema.parse(input);
      const gitContext = parsed.useGitContext ? await readGitContext(recommendOptions?.workspacePath ?? cwd) : null;
      return recommendPlaylists(parsed, await allPlaylists(), gitContext);
    },

    async syncCatalog() {
      const syncOptions = options.fetchImpl === undefined ? { storage } : { storage, fetchImpl: options.fetchImpl };
      return syncMeloLabCatalogue(syncOptions);
    },

    async play(id) {
      const { playlistId } = PlayInputSchema.parse({ playlistId: id });
      const playlist = (await allPlaylists()).find((candidate) => candidate.id === playlistId);
      if (!playlist) throw new MeloPulseError('PLAYLIST_NOT_FOUND', `Playlist '${playlistId}' was not found.`);
      try {
        await openUrl(playlist.url);
      } catch (error) {
        throw new PlaylistOpenError(playlist.url, error);
      }
      return { id: playlist.id, url: playlist.url };
    },
  };
}

function providerDisplayName(provider: Provider): string {
  const names: Record<Provider, string> = {
    melolab: 'MeloLab',
    spotify: 'Spotify',
    apple_music: 'Apple Music',
    youtube_music: 'YouTube Music',
    generic: 'Generic',
  };
  return names[provider];
}
