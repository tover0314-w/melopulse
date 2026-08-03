import type { PlaylistRecord, Provider, RecommendationInput, RecommendationResult } from '../schema.js';
import type { CliCapabilities } from './capabilities.js';
import { sanitizeHumanText, type ErrorView } from './error-view.js';
import { createTheme, type CliTheme } from './theme.js';

export interface CliPresenter {
  recommendations(results: readonly RecommendationResult[], context: RecommendationInput): string;
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
    recommendations(results, context) {
      const heading = theme.heading('MeloPulse recommendations');
      const contextText = labeledProse(
        theme,
        'Context',
        recommendationContext(context, separator),
        capabilities.columns,
      );
      const blocks = results.map((result, index) => recommendation(
        result,
        index + 1,
        separator,
        theme,
        capabilities.columns,
      ));
      return [heading, contextText, ...blocks].join('\n\n');
    },
    playlists(records, source) {
      if (records.length === 0) return emptyPlaylists(source);
      const heading = `${records.length} playlist${records.length === 1 ? '' : 's'}`;
      const context = labeledProse(
        theme,
        'Context',
        ['local catalogue', ...(source === undefined ? [] : [`source ${source}`])].join(separator),
        capabilities.columns,
      );
      return [
        theme.heading(heading),
        context,
        ...records.map((playlist) => playlistBlock(playlist, separator, capabilities.columns)),
      ].join('\n\n');
    },
    savedPlaylist(playlist) {
      return [
        labeledProse(theme, 'Saved playlist', playlist.title, capabilities.columns),
        labeledProse(theme, 'Source', providerDisplayName(playlist.source), capabilities.columns),
        `${label(theme, 'ID')}: ${playlist.id}`,
        `${label(theme, 'URL')}: ${playlist.url}`,
        'Next: melopulse recommend',
      ].join('\n');
    },
    syncResult(result) {
      return `${label(theme, 'Synced')} ${result.count} public playlists from MeloLab.\nNext: melopulse recommend`;
    },
    playResult(result) {
      return `${label(theme, 'Opening')} in your default browser or music app:\n${result.url}`;
    },
    error(view) {
      const safeCode = sanitizeHumanText(view.code, 'INTERNAL_ERROR');
      return [
        labeledProse(theme, `Error [${safeCode}]`, view.message, capabilities.columns),
        ...(view.suggestion === undefined
          ? []
          : [labeledProse(theme, 'Try', view.suggestion, capabilities.columns)]),
        ...(view.url === undefined ? [] : [`${label(theme, 'URL')}: ${view.url}`]),
      ].join('\n');
    },
  };
}

function recommendation(
  result: RecommendationResult,
  index: number,
  separator: string,
  theme: CliTheme,
  columns: number,
): string {
  const { playlist } = result;
  return [
    theme.heading(wrapProse(`${index}. ${sanitizeHumanText(playlist.title, 'Untitled playlist')}`, columns)),
    labeledProse(theme, 'Why', reasons(result.reasons), columns),
    labeledProse(theme, 'Fit', [
      providerDisplayName(playlist.source),
      `${playlist.energy} energy`,
      `${playlist.focus} focus`,
      vocals(playlist.vocals),
    ].join(separator), columns),
    `${label(theme, 'URL')}: ${playlist.url}`,
    `${label(theme, 'Play')}: melopulse play ${playlist.id}`,
  ].join('\n');
}

function playlistBlock(playlist: PlaylistRecord, separator: string, columns: number): string {
  const metadata = [
    sanitizeHumanText(playlist.title, 'Untitled playlist'),
    providerDisplayName(playlist.source),
    `${playlist.energy} energy`,
    `${playlist.focus} focus`,
  ].join(separator);
  return `${playlist.id}\n${wrapProse(metadata, columns, '  ')}\n  ${playlist.url}`;
}

function recommendationContext(context: RecommendationInput, separator: string): string {
  return [
    'local catalogue',
    `Git context ${context.useGitContext ? 'on' : 'off'}`,
    `${context.limit} requested`,
    ...(context.activity === undefined ? [] : [`activity ${context.activity}`]),
    ...(context.mood === undefined ? [] : [`mood ${sanitizeHumanText(context.mood, 'unspecified')}`]),
    ...(context.energy === undefined ? [] : [`energy ${context.energy}`]),
    ...(context.focus === undefined ? [] : [`focus ${context.focus}`]),
    ...(context.vocals === undefined ? [] : [`vocals ${context.vocals}`]),
  ].join(separator);
}

function emptyPlaylists(source: Provider | undefined): string {
  const scope = source === undefined ? '' : ` ${source}`;
  return `No${scope} playlists saved.\nAdd one with: melopulse add <playlist-url>`;
}

function reasons(values: readonly string[]): string {
  const unique = [...new Set(values
    .map((value) => sanitizeHumanText(value))
    .filter(Boolean))];
  return unique.join(' ') || 'A local focus recommendation.';
}

function vocals(value: PlaylistRecord['vocals']): string {
  return value === 'none' ? 'no vocals' : `${value} vocals`;
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

function labeledProse(theme: CliTheme, labelText: string, text: string, columns: number): string {
  const safeText = sanitizeHumanText(text);
  const rawPrefix = `${labelText}: `;
  const wrapped = wrapWords(safeText, Math.max(10, columns - rawPrefix.length));
  const first = `${label(theme, labelText)}: ${wrapped[0] ?? ''}`;
  const continuationPrefix = ' '.repeat(rawPrefix.length);
  return [first, ...wrapped.slice(1).map((line) => `${continuationPrefix}${line}`)].join('\n');
}

function wrapProse(text: string, columns: number, indent = ''): string {
  const lines = wrapWords(sanitizeHumanText(text), Math.max(10, columns - indent.length));
  return lines.map((line) => `${indent}${line}`).join('\n');
}

function wrapWords(text: string, width: number): string[] {
  const words = text.split(' ').filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current === '') {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

function label(theme: CliTheme, value: string): string {
  return theme.accent(value);
}
