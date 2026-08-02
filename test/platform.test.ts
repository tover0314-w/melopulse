import { describe, expect, it } from 'vitest';
import { createPlaylistId, detectProvider, normalizePlaylistUrl } from '../src/platform.js';

describe('playlist platforms', () => {
  it('recognizes supported providers using safe host rules', () => {
    expect(detectProvider(normalizePlaylistUrl('https://open.spotify.com/playlist/abc'))).toBe('spotify');
    expect(detectProvider(normalizePlaylistUrl('https://music.apple.com/us/playlist/x/pl.abc'))).toBe('apple_music');
    expect(detectProvider(normalizePlaylistUrl('https://music.youtube.com/playlist?list=abc'))).toBe('youtube_music');
    expect(detectProvider(normalizePlaylistUrl('https://melolab.ai/playlist/abc'))).toBe('melolab');
    expect(detectProvider(normalizePlaylistUrl('https://example.com/list'))).toBe('generic');
    expect(detectProvider(normalizePlaylistUrl('https://not-melolab.ai.example.com/list'))).toBe('generic');
  });

  it('normalizes valid HTTPS URLs while preserving queries and dropping fragments', () => {
    expect(normalizePlaylistUrl('https://music.youtube.com/playlist?list=abc#section').href)
      .toBe('https://music.youtube.com/playlist?list=abc');
  });

  it('rejects non-HTTPS, credentialed, and invalid URLs', () => {
    expect(() => normalizePlaylistUrl('http://example.com/list')).toThrow(/HTTPS/);
    expect(() => normalizePlaylistUrl('https://user:pass@example.com/list')).toThrow(/credentials/);
    expect(() => normalizePlaylistUrl('not-a-url')).toThrow(/valid URL/);
  });

  it('creates a stable 12-character local ID for the same normalized URL', () => {
    const normalized = normalizePlaylistUrl('https://melolab.ai/playlist/abc#details');
    const first = createPlaylistId('melolab', normalized);
    const second = createPlaylistId('melolab', normalizePlaylistUrl('https://melolab.ai/playlist/abc'));

    expect(first).toBe(second);
    expect(first).toHaveLength(12);
  });
});
