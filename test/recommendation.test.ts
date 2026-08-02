import { describe, expect, it } from 'vitest';
import { BUNDLED_PLAYLISTS, FOCUS_FALLBACK_ID } from '../src/catalog/bundled.js';
import { classifyActivity, recommendPlaylists } from '../src/recommendation.js';
import type { GitContext } from '../src/git-context.js';
import type { PlaylistRecord } from '../src/schema.js';

const debuggingGit: GitContext = {
  branch: 'fix/auth-bug',
  latestCommit: '',
  changedFileCount: 0,
  changedAreas: [],
};

const catalogue: readonly PlaylistRecord[] = BUNDLED_PLAYLISTS;

describe('recommendations', () => {
  it('infers debugging from Git text unless an explicit activity is provided', () => {
    expect(classifyActivity({}, debuggingGit)).toBe('debugging');
    expect(classifyActivity({ activity: 'shipping' }, debuggingGit)).toBe('shipping');
  });

  it('uses the bundled focus fallback when no explicit criteria match', () => {
    expect(recommendPlaylists({ activity: 'debugging', limit: 3, useGitContext: false }, catalogue, null)[0]?.playlist.id)
      .toBe(FOCUS_FALLBACK_ID);
  });

  it('returns the requested number of deterministically scored matches', () => {
    expect(recommendPlaylists({ activity: 'shipping', energy: 'high', limit: 2, useGitContext: false }, catalogue, null))
      .toHaveLength(2);
  });

  it('does not score or explain a conflicting Git activity when activity is explicit', () => {
    const candidates: readonly PlaylistRecord[] = [
      { ...BUNDLED_PLAYLISTS[1]!, id: 'shipping-match', activityTags: ['shipping'] },
      { ...BUNDLED_PLAYLISTS[0]!, id: 'debugging-only', activityTags: ['debugging'] },
    ];

    const results = recommendPlaylists({ activity: 'shipping', limit: 2, useGitContext: true }, candidates, debuggingGit);

    expect(results.find((result) => result.playlist.id === 'shipping-match')).toMatchObject({ score: 8 });
    expect(results.find((result) => result.playlist.id === 'debugging-only')).toMatchObject({ score: 0, reasons: [] });
  });

  it('sorts equally scored results by ID', () => {
    const ties: readonly PlaylistRecord[] = [
      { ...BUNDLED_PLAYLISTS[1]!, id: 'zeta' },
      { ...BUNDLED_PLAYLISTS[1]!, id: 'alpha' },
    ];

    expect(recommendPlaylists({ activity: 'shipping', limit: 2, useGitContext: false }, ties, null)
      .map((result) => result.playlist.id)).toEqual(['alpha', 'zeta']);
  });

  it('returns the bundled focus record when the catalogue has no matching record', () => {
    const noMatches: readonly PlaylistRecord[] = [{
      ...BUNDLED_PLAYLISTS[0]!,
      id: 'quiet-only',
      activityTags: ['deep_focus'],
      moodTags: ['calm'],
    }];

    expect(recommendPlaylists({ activity: 'shipping', limit: 3, useGitContext: false }, noMatches, null)[0]?.playlist.id)
      .toBe(FOCUS_FALLBACK_ID);
  });

  it('returns independent playlist records for matches and the bundled fallback', () => {
    const supplied: PlaylistRecord[] = [{
      ...BUNDLED_PLAYLISTS[1]!,
      id: 'supplied-shipping',
      activityTags: ['shipping'],
      moodTags: ['bold'],
    }];
    const matched = recommendPlaylists({ activity: 'shipping', limit: 1, useGitContext: false }, supplied, null)[0]!;
    matched.playlist.activityTags.push('debugging');
    matched.playlist.moodTags[0] = 'mutated';

    expect(supplied[0]!.activityTags).toEqual(['shipping']);
    expect(supplied[0]!.moodTags).toEqual(['bold']);
    expect(recommendPlaylists({ activity: 'shipping', limit: 1, useGitContext: false }, supplied, null)[0]?.playlist)
      .toMatchObject({ activityTags: ['shipping'], moodTags: ['bold'] });

    const noMatches: readonly PlaylistRecord[] = [{ ...BUNDLED_PLAYLISTS[1]!, activityTags: ['feature'] }];
    const fallback = recommendPlaylists({ activity: 'shipping', limit: 1, useGitContext: false }, noMatches, null)[0]!;
    fallback.playlist.activityTags.push('shipping');
    fallback.playlist.moodTags[0] = 'mutated';

    expect(BUNDLED_PLAYLISTS[0]!.activityTags).toEqual(['debugging', 'reviewing', 'deep_focus']);
    expect(BUNDLED_PLAYLISTS[0]!.moodTags).toEqual(['calm', 'concentrated']);
    expect(recommendPlaylists({ activity: 'shipping', limit: 1, useGitContext: false }, noMatches, null)[0]?.playlist)
      .toMatchObject({ activityTags: ['debugging', 'reviewing', 'deep_focus'], moodTags: ['calm', 'concentrated'] });
  });
});
