import { describe, expect, it } from 'vitest';
import { BUNDLED_PLAYLISTS, FOCUS_FALLBACK_ID } from '../src/catalog/bundled.js';
import { MeloPulseError } from '../src/errors.js';
import { PlaylistRecordSchema, RecommendationInputSchema } from '../src/schema.js';

describe('playlist schema', () => {
  it('accepts every bundled playlist and includes the focus fallback', () => {
    expect(BUNDLED_PLAYLISTS.map((item) => PlaylistRecordSchema.parse(item))).toHaveLength(6);
    expect(BUNDLED_PLAYLISTS.some((item) => item.id === FOCUS_FALLBACK_ID)).toBe(true);
  });

  it('applies safe recommendation defaults', () => {
    expect(RecommendationInputSchema.parse({})).toMatchObject({
      useGitContext: true,
      limit: 3,
    });
  });

  it('rejects non-HTTPS playlist URLs', () => {
    expect(() => PlaylistRecordSchema.parse({
      id: 'bad',
      source: 'generic',
      title: 'Bad',
      url: 'http://example.com/list',
      activityTags: ['deep_focus'],
      moodTags: [],
      energy: 'medium',
      focus: 'medium',
      vocals: 'any',
    })).toThrow();
  });

  it.each([
    'playlist with spaces',
    'playlist;shutdown',
    'playlist$HOME',
    'playlist`command`',
    'playlist"quoted"',
    "playlist'quoted'",
    '-option-like',
  ])('rejects unsafe playlist ID %j', (id) => {
    expect(() => PlaylistRecordSchema.parse({
      id,
      source: 'generic',
      title: 'Unsafe ID',
      url: 'https://example.com/list',
      activityTags: ['deep_focus'],
      moodTags: [],
      energy: 'medium',
      focus: 'medium',
      vocals: 'any',
    })).toThrow();
  });
});

describe('MeloPulseError', () => {
  it('preserves a stable code and user-facing message', () => {
    const error = new MeloPulseError('INVALID_PLAYLIST', 'Playlist URL must use HTTPS');

    expect(error).toMatchObject({
      name: 'MeloPulseError',
      code: 'INVALID_PLAYLIST',
      message: 'Playlist URL must use HTTPS',
    });
  });
});
