import { describe, expect, it } from 'vitest';
import type { PlaylistRecord } from '../../src/schema.js';
import { createPresenter } from '../../src/cli/presenter.js';

const plain = { mode: 'plain', color: false, unicode: true, progress: false, columns: 80 } as const;
const INLINE_CONTROL_CHARACTER = new RegExp(String.raw`[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F]`, 'u');
const playlist: PlaylistRecord = {
  id: 'melolab:focus-flow', source: 'melolab', title: 'Focus Flow',
  url: 'https://melolab.ai/playlist/focus-flow', activityTags: ['debugging'], moodTags: ['calm'],
  energy: 'low', focus: 'high', vocals: 'none',
};

describe('CLI presenter', () => {
  it('renders sanitized requested context, metadata, URL, and a copyable play command', () => {
    const text = createPresenter(plain).recommendations(
      [{ playlist, score: 8, reasons: ['Fits debugging work.'] }],
      {
        activity: 'debugging',
        mood: 'calm\n\u001B[31mfocused',
        useGitContext: false,
        limit: 1,
      },
    );

    expect(text).toContain('MeloPulse recommendations');
    expect(text).toContain('Context: local catalogue · Git context off · 1 requested · activity debugging ·');
    expect(text).toContain('mood calm focused');
    expect(text).toContain('1. Focus Flow');
    expect(text).toContain('Why: Fits debugging work.');
    expect(text).toContain('Fit: MeloLab · low energy · high focus · no vocals');
    expect(text).toContain(playlist.url);
    expect(text).toContain('melopulse play melolab:focus-flow');
    expect(text).not.toMatch(INLINE_CONTROL_CHARACTER);
  });

  it('wraps explanatory prose to terminal width but preserves identifiers, URLs, and commands verbatim', () => {
    const narrow = { ...plain, unicode: false, columns: 40 } as const;
    const text = createPresenter(narrow).recommendations(
      [{
        playlist,
        score: 8,
        reasons: ['Fits a deliberately long explanation for debugging work without changing copyable values.'],
      }],
      {
        activity: 'debugging',
        mood: 'deliberately detailed focus request',
        useGitContext: true,
        limit: 3,
      },
    );
    const invariantLines = [
      `URL: ${playlist.url}`,
      `Play: melopulse play ${playlist.id}`,
    ];
    const explanatoryLines = text.split('\n').filter((line) => !invariantLines.includes(line));

    expect(explanatoryLines.every((line) => line.length <= 40)).toBe(true);
    expect(text).toContain(invariantLines[0]);
    expect(text).toContain(invariantLines[1]);
  });

  it('shows source, energy, and focus for each list entry and the requested source context', () => {
    const text = createPresenter(plain).playlists([playlist], 'melolab');

    expect(text).toContain('Context: local catalogue · source melolab');
    expect(text).toContain('Focus Flow · MeloLab · low energy · high focus');
    expect(text).toContain(`\n${playlist.id}\n`);
    expect(text).toContain(playlist.url);
  });

  it('renders an empty filtered catalogue as success with a next action', () => {
    expect(createPresenter(plain).playlists([], 'spotify')).toBe(
      'No spotify playlists saved.\nAdd one with: melopulse add <playlist-url>',
    );
  });

  it('renders an actionable error without terminal controls', () => {
    const text = createPresenter(plain).error({ code: 'PLAYLIST_NOT_FOUND', message: 'Missing.', suggestion: 'Run melopulse list.', retryable: false });
    expect(text).toBe('Error [PLAYLIST_NOT_FOUND]: Missing.\nTry: Run melopulse list.');
    expect(text).not.toContain('\u001B[');
  });

  it('wraps and sanitizes human error prose', () => {
    const narrow = { ...plain, columns: 40 } as const;
    const text = createPresenter(narrow).error({
      code: 'INVALID_INPUT',
      message: 'A deliberately long\nmessage with \u001B[31mterminal controls must remain safe.',
      suggestion: 'Use a deliberately long suggestion that wraps safely.',
      retryable: false,
    });

    expect(text.split('\n').every((line) => line.length <= 40)).toBe(true);
    expect(text).not.toMatch(INLINE_CONTROL_CHARACTER);
  });

  it('shows normalized source and a stable ID for a saved playlist', () => {
    const text = createPresenter(plain).savedPlaylist(playlist);

    expect(text).toContain('Source: MeloLab');
    expect(text).toContain('ID: melolab:focus-flow');
  });
});
