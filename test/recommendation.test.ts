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
});
