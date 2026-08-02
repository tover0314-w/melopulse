import { describe, expect, it } from 'vitest';
import { mergeCatalogues } from '../../src/catalog/merge.js';
import type { PlaylistRecord } from '../../src/schema.js';

function playlist(id: string, title: string): PlaylistRecord {
  return {
    id,
    source: 'generic',
    title,
    url: `https://example.com/${id}`,
    activityTags: ['deep_focus'],
    moodTags: ['calm'],
    energy: 'medium',
    focus: 'medium',
    vocals: 'none',
  };
}

describe('catalogue merge', () => {
  it('prefers user records over synced and bundled records with the same ID', () => {
    const bundled = playlist('same-id', 'Bundled');
    const synced = playlist('same-id', 'Synced');
    const user = playlist('same-id', 'User');

    expect(mergeCatalogues([bundled], [synced], [user])[0]?.title).toBe('User');
  });

  it('sorts the merged records by ID', () => {
    expect(mergeCatalogues([playlist('z', 'Z')], [], [playlist('a', 'A')]).map(({ id }) => id))
      .toEqual(['a', 'z']);
  });
});
