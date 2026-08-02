import type { CliCapabilities } from './capabilities.js';
import type { ErrorView } from './error-view.js';
import { createTheme, type CliTheme } from './theme.js';
import type { PlaylistRecord, Provider, RecommendationResult } from '../schema.js';

export interface CliPresenter {
  recommendations(results: readonly RecommendationResult[]): string;
  playlists(playlists: readonly PlaylistRecord[], source?: Provider): string;
  savedPlaylist(playlist: PlaylistRecord): string;
  syncResult(result: { count: number }): string;
  playResult(result: { id: string; url: string }): string;
  error(view: ErrorView): string;
}

export function createPresenter(capabilities: CliCapabilities): CliPresenter {
  const theme = createTheme(capabilities.color);
  const separator = capabilities.unicode ? ' · ' : ' | ';

  return {
    recommendations(results) {
      return results.map((result, index) => recommendation(result, index + 1, separator, theme)).join('\n\n');
    },
    playlists(records, source) {
      if (records.length === 0) return emptyPlaylists(source);
      const heading = `${records.length} playlist${records.length === 1 ? '' : 's'}`;
      return [theme.heading(heading), ...records.map((playlist) => playlistBlock(playlist))].join('\n\n');
    },
    savedPlaylist(playlist) {
      return `${label(theme, 'Saved playlist')}: ${playlist.title}\n${label(theme, 'URL')}: ${playlist.url}\n${playlist.id}\nNext: melopulse recommend`;
    },
    syncResult(result) {
      return `${label(theme, 'Synced')} ${result.count} public playlists from MeloLab.\nNext: melopulse recommend`;
    },
    playResult(result) {
      return `${label(theme, 'Opening')} in your default browser or music app:\n${result.url}`;
    },
    error(view) {
      return [
        `${label(theme, 'Error')} [${view.code}]: ${view.message}`,
        ...(view.suggestion === undefined ? [] : [`${label(theme, 'Try')}: ${view.suggestion}`]),
        ...(view.url === undefined ? [] : [`${label(theme, 'URL')}: ${view.url}`]),
      ].join('\n');
    },
  };
}

function recommendation(result: RecommendationResult, index: number, separator: string, theme: CliTheme): string {
  const { playlist } = result;
  return [
    theme.heading(`${index}. ${playlist.title}`),
    `${label(theme, 'Why')}: ${reasons(result.reasons)}`,
    `${label(theme, 'Fit')}: ${[`${playlist.energy} energy`, `${playlist.focus} focus`, vocals(playlist.vocals)].join(separator)}`,
    `${label(theme, 'URL')}: ${playlist.url}`,
    `${label(theme, 'Play')}: melopulse play ${playlist.id}`,
  ].join('\n');
}

function playlistBlock(playlist: PlaylistRecord): string {
  return `${playlist.id}\n  ${playlist.title}\n  ${playlist.url}`;
}

function emptyPlaylists(source: Provider | undefined): string {
  const scope = source === undefined ? '' : ` ${source}`;
  return `No${scope} playlists saved.\nAdd one with: melopulse add <playlist-url>`;
}

function reasons(values: readonly string[]): string {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  return unique.join(' ') || 'A local focus recommendation.';
}

function vocals(value: PlaylistRecord['vocals']): string {
  return value === 'none' ? 'no vocals' : `${value} vocals`;
}

function label(theme: CliTheme, value: string): string {
  return theme.accent(value);
}
