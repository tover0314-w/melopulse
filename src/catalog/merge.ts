import type { PlaylistRecord } from '../schema.js';

export function mergeCatalogues(
  bundled: readonly PlaylistRecord[],
  synced: readonly PlaylistRecord[],
  userAdded: readonly PlaylistRecord[],
): PlaylistRecord[] {
  const byId = new Map<string, PlaylistRecord>();

  for (const item of bundled) byId.set(item.id, item);
  for (const item of synced) byId.set(item.id, item);
  for (const item of userAdded) byId.set(item.id, item);

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
