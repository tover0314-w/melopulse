import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MeloPulseError } from '../../src/errors.js';
import { toErrorView } from '../../src/cli/error-view.js';
import {
  AddPlaylistInputSchema,
  ActivitySchema,
  EnergySchema,
  FocusSchema,
  PlaylistIdSchema,
  ProviderSchema,
  VocalsSchema,
} from '../../src/schema.js';

const CONTROL_CHARACTER = new RegExp(String.raw`[\u0000-\u001F\u007F-\u009F]`, 'u');

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
    expect(toErrorView(error)).toMatchObject({ code: 'INVALID_ENERGY', retryable: false });
    expect(JSON.stringify(toErrorView(error))).not.toContain('invalid_value');
  });

  it.each([
    ['activity', ActivitySchema, 'fixing', 'INVALID_ACTIVITY', 'debugging, feature, reviewing, shipping, maintenance, or deep_focus'],
    ['energy', EnergySchema, 'max', 'INVALID_ENERGY', 'low, medium, or high'],
    ['focus', FocusSchema, 'max', 'INVALID_FOCUS', 'low, medium, or high'],
    ['vocals', VocalsSchema, 'lots', 'INVALID_VOCALS', 'none, low, or any'],
    ['source', ProviderSchema, 'bandcamp', 'INVALID_SOURCE', 'melolab, spotify, apple_music, youtube_music, or generic'],
  ] as const)('identifies invalid %s values and lists allowed choices', (field, schema, value, code, choices) => {
    const error = z.object({ [field]: schema }).safeParse({ [field]: value }).error;
    const view = toErrorView(error);

    expect(view).toEqual({
      code,
      message: `Invalid ${field} value.`,
      suggestion: `Set --${field} to one of: ${choices}.`,
      retryable: false,
    });
    expect(JSON.stringify(view)).not.toMatch(/invalid_value|issues|expected one of/u);
  });

  it.each([0, 6, 1.5])('gives the complete integer range for invalid limit %s', (limit) => {
    const error = z.object({ limit: z.number().int().min(1).max(5) }).safeParse({ limit }).error;

    expect(toErrorView(error)).toEqual({
      code: 'INVALID_LIMIT',
      message: 'Invalid limit value.',
      suggestion: 'Set --limit to an integer from 1 to 5.',
      retryable: false,
    });
  });

  it('maps nested add-playlist activityTags validation back to the --activity option', () => {
    const error = AddPlaylistInputSchema.safeParse({
      url: 'https://example.com/playlist',
      activityTags: ['fixing'],
    }).error;

    expect(toErrorView(error)).toEqual({
      code: 'INVALID_ACTIVITY',
      message: 'Invalid activity value.',
      suggestion: 'Set --activity to one of: debugging, feature, reviewing, shipping, maintenance, or deep_focus.',
      retryable: false,
    });
    expect(toErrorView(error, {
      surface: 'mcp',
      toolName: 'melopulse_add_playlist',
    })).toEqual({
      code: 'INVALID_ACTIVITY',
      message: 'Invalid activityTags value.',
      suggestion: 'Call melopulse_add_playlist with activityTags set to one of: debugging, feature, reviewing, shipping, maintenance, or deep_focus.',
      retryable: false,
    });
  });

  it('uses MCP tool names instead of CLI shell commands for recovery', () => {
    const invalidActivity = z.object({ activity: ActivitySchema }).safeParse({ activity: 'fixing' }).error;

    expect(toErrorView(invalidActivity, {
      surface: 'mcp',
      toolName: 'melopulse_recommend',
    })).toMatchObject({
      code: 'INVALID_ACTIVITY',
      suggestion: 'Call melopulse_recommend with activity set to one of: debugging, feature, reviewing, shipping, maintenance, or deep_focus.',
    });
    expect(toErrorView(
      new MeloPulseError('MELOLAB_SYNC_NETWORK_ERROR', 'Unable to retrieve the MeloLab catalogue.'),
      { surface: 'mcp', toolName: 'melopulse_sync_catalog' },
    )).toMatchObject({
      suggestion: 'Check the connection and call melopulse_sync_catalog again. The previous cache is unchanged.',
    });
  });

  it('maps an unsafe playlist ID to actionable safe guidance', () => {
    const error = z.object({ playlistId: PlaylistIdSchema }).safeParse({ playlistId: "bad\n\u001B[31mvalue" }).error;

    expect(toErrorView(error)).toEqual({
      code: 'INVALID_PLAYLIST_ID',
      message: 'Invalid playlist ID.',
      suggestion: 'Use a shell-safe playlist ID shown by melopulse list or melopulse recommend.',
      retryable: false,
    });
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
    expect(toErrorView(Object.assign(error, { url: 'https://example.com/\nINJECTED' }))).not.toHaveProperty('url');
  });

  it('keeps trusted domain messages and suggestions single-line and control-free', () => {
    const error = new MeloPulseError(
      'PLAYLIST_NOT_FOUND',
      "Playlist 'missing\n\u001B[31mINJECTED\u0000' was not found.",
    );
    const view = toErrorView(error);

    expect(view.message).toBe("Playlist 'missing INJECTED' was not found.");
    expect([view.message, view.suggestion].every((value) => !CONTROL_CHARACTER.test(value ?? ''))).toBe(true);
    expect(view.message.split('\n')).toHaveLength(1);
  });
});
