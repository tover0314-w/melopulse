import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MeloPulseError } from '../../src/errors.js';
import { toErrorView } from '../../src/cli/error-view.js';

describe('safe CLI error views', () => {
  it('gives a missing playlist a concrete local recovery action', () => {
    expect(toErrorView(new MeloPulseError('PLAYLIST_NOT_FOUND', "Playlist 'missing' was not found."))).toEqual({
      code: 'PLAYLIST_NOT_FOUND',
      message: "Playlist 'missing' was not found.",
      suggestion: 'Run melopulse list or melopulse recommend to choose a valid playlist ID.',
      retryable: false,
    });
  });

  it('collapses Zod details into a safe invalid-input response', () => {
    const error = z.object({ energy: z.enum(['low', 'medium', 'high']) }).safeParse({ energy: 'max' }).error;
    expect(toErrorView(error)).toMatchObject({ code: 'INVALID_INPUT', retryable: false });
    expect(JSON.stringify(toErrorView(error))).not.toContain('invalid_value');
  });

  it('does not expose unknown messages, paths, or stacks', () => {
    const view = toErrorView(new Error('D:\\secret\\catalog.json failed'));
    expect(view).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected internal error occurred.',
      suggestion: 'Retry the command. If it continues, report the error code.',
      retryable: true,
    });
  });

  it('includes only a credential-free HTTPS fallback URL', () => {
    const error = Object.assign(
      new MeloPulseError('PLAYLIST_OPEN_ERROR', 'Unable to open the playlist URL.'),
      { url: 'https://open.spotify.com/playlist/abc' },
    );

    expect(toErrorView(error)).toMatchObject({
      code: 'PLAYLIST_OPEN_ERROR',
      url: 'https://open.spotify.com/playlist/abc',
    });
    expect(toErrorView(Object.assign(error, { url: 'https://token@open.spotify.com/playlist/abc' }))).not.toHaveProperty('url');
  });
});
