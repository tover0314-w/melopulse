import { BUNDLED_PLAYLISTS, FOCUS_FALLBACK_ID } from './catalog/bundled.js';
import type { GitContext } from './git-context.js';
import type { Activity, PlaylistRecord, RecommendationInput, RecommendationResult } from './schema.js';

type RecommendationCriteria = Partial<RecommendationInput>;

const ACTIVITY_RULES: readonly [RegExp, Activity][] = [
  [/fix|bug|debug|failing|hotfix/, 'debugging'],
  [/feature|feat|build|create/, 'feature'],
  [/review|audit|inspect|test/, 'reviewing'],
  [/release|ship|deploy|tag/, 'shipping'],
  [/refactor|cleanup|docs|chore/, 'maintenance'],
];

export function classifyActivity(input: RecommendationCriteria, gitContext: GitContext | null): Activity {
  if (input.activity) return input.activity;

  const gitText = `${gitContext?.branch ?? ''} ${gitContext?.latestCommit ?? ''}`.toLowerCase();
  return ACTIVITY_RULES.find(([pattern]) => pattern.test(gitText))?.[1] ?? 'deep_focus';
}

export function recommendPlaylists(
  input: RecommendationCriteria,
  playlists: readonly PlaylistRecord[],
  gitContext: GitContext | null,
): RecommendationResult[] {
  const inferredActivity = input.activity || input.useGitContext === false || !gitContext
    ? undefined
    : classifyActivity({}, gitContext);
  const results = playlists.map((playlist) => scorePlaylist(playlist, input, inferredActivity));
  const hasMatch = results.some((result) => result.score > 0);

  if (!hasMatch) return [focusFallback()];

  return results
    .sort((left, right) => right.score - left.score || left.playlist.id.localeCompare(right.playlist.id))
    .slice(0, input.limit ?? 3);
}

function scorePlaylist(
  playlist: PlaylistRecord,
  input: RecommendationCriteria,
  inferredActivity: Activity | undefined,
): RecommendationResult {
  let score = 0;
  const matches: string[] = [];

  if (input.activity && playlist.activityTags.includes(input.activity)) {
    score += 8;
    matches.push(`${input.activity} work`);
  }
  if (inferredActivity && playlist.activityTags.includes(inferredActivity)) {
    score += 4;
    if (!input.activity) matches.push(`${inferredActivity} work`);
  }
  if (input.mood && playlist.moodTags.some((mood) => mood.toLowerCase() === input.mood!.toLowerCase())) {
    score += 5;
    matches.push(`${input.mood} mood`);
  }
  if (input.energy && playlist.energy === input.energy) {
    score += 3;
    matches.push(`${input.energy} energy`);
  }
  if (input.focus && playlist.focus === input.focus) {
    score += 3;
    matches.push(`${input.focus} focus`);
  }
  if (input.vocals && playlist.vocals === input.vocals) {
    score += 2;
    matches.push(vocalReason(input.vocals));
  }

  return { playlist: clonePlaylist(playlist), score, reasons: matches.length ? [`Fits ${joinReasonParts(matches)}.`] : [] };
}

function focusFallback(): RecommendationResult {
  const playlist = BUNDLED_PLAYLISTS.find((candidate) => candidate.id === FOCUS_FALLBACK_ID);
  if (!playlist) throw new Error('Bundled focus fallback is unavailable');

  return { playlist: clonePlaylist(playlist), score: 0, reasons: ['Focus fallback for a neutral starting point.'] };
}

function clonePlaylist(playlist: PlaylistRecord): PlaylistRecord {
  return { ...playlist, activityTags: [...playlist.activityTags], moodTags: [...playlist.moodTags] };
}

function vocalReason(vocals: RecommendationInput['vocals']): string {
  if (vocals === 'none') return 'no vocal distraction';
  if (vocals === 'low') return 'low vocal distraction';
  return 'vocals';
}

function joinReasonParts(parts: readonly string[]): string {
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} with ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}
