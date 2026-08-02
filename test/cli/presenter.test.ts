import { describe, expect, it } from 'vitest';
import type { PlaylistRecord } from '../../src/schema.js';
import { createPresenter } from '../../src/cli/presenter.js';

const plain = { mode: 'plain', color: false, unicode: true, progress: false, columns: 80 } as const;
const playlist: PlaylistRecord = {
  id: 'melolab:focus-flow', source: 'melolab', title: 'Focus Flow',
  url: 'https://melolab.ai/playlist/focus-flow', activityTags: ['debugging'], moodTags: ['calm'],
  energy: 'low', focus: 'high', vocals: 'none',
};

describe('CLI presenter', () => {
  it('renders a recommendation with reason, fit, URL, and copyable play command', () => {
    const text = createPresenter(plain).recommendations([{ playlist, score: 8, reasons: ['Fits debugging work.'] }]);
    expect(text).toContain('1. Focus Flow');
    expect(text).toContain('Why: Fits debugging work.');
    expect(text).toContain('Fit: low energy · high focus · no vocals');
    expect(text).toContain(playlist.url);
    expect(text).toContain('melopulse play melolab:focus-flow');
  });

  it('renders an empty filtered catalogue as success with a next action', () => {
    expect(createPresenter(plain).playlists([], 'spotify')).toBe(
      'No spotify playlists saved.\nAdd one with: melopulse add <playlist-url>',
    );
  });

  it('renders an actionable error without terminal controls', () => {
    const text = createPresenter(plain).error({ code: 'PLAYLIST_NOT_FOUND', message: 'Missing.', suggestion: 'Run melopulse list.', retryable: false });
    expect(text).toBe('Error [PLAYLIST_NOT_FOUND]: Missing.\nTry: Run melopulse list.');
    expect(text).not.toMatch(/\u001B\[/u);
  });
});
