import { createHash } from 'node:crypto';
import type { Provider } from './schema.js';

export function normalizePlaylistUrl(raw: string): URL {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new Error('Playlist URL must be a valid URL');
  }

  if (url.protocol !== 'https:') {
    throw new Error('Playlist URL must use HTTPS');
  }

  if (url.username || url.password) {
    throw new Error('Playlist URL must not include credentials');
  }

  url.hash = '';
  return url;
}

export function detectProvider(url: URL): Provider {
  const hostname = url.hostname.toLowerCase();

  if (hostname === 'open.spotify.com') return 'spotify';
  if (hostname === 'music.apple.com') return 'apple_music';
  if (hostname === 'music.youtube.com' || hostname === 'youtube.com' || hostname === 'www.youtube.com') return 'youtube_music';
  if (hostname === 'melolab.ai' || hostname.endsWith('.melolab.ai')) return 'melolab';
  return 'generic';
}

export function createPlaylistId(provider: Provider, url: URL): string {
  return createHash('sha256').update(`${provider}:${url.href}`).digest('hex').slice(0, 12);
}
