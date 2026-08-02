import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { PlaylistRecordSchema, type PlaylistRecord } from '../schema.js';

const USER_PLAYLISTS_FILE = 'playlists.json';
const MELOLAB_CACHE_FILE = 'melolab-catalog-cache.json';

export class CatalogStorage {
  constructor(private readonly dataDir: string) {}

  async loadUserPlaylists(): Promise<PlaylistRecord[]> {
    return this.loadCatalogue(USER_PLAYLISTS_FILE);
  }

  async saveUserPlaylists(records: PlaylistRecord[]): Promise<void> {
    await this.saveCatalogue(USER_PLAYLISTS_FILE, records);
  }

  async loadMeloLabCache(): Promise<PlaylistRecord[]> {
    return this.loadCatalogue(MELOLAB_CACHE_FILE);
  }

  async saveMeloLabCache(records: PlaylistRecord[]): Promise<void> {
    await this.saveCatalogue(MELOLAB_CACHE_FILE, records);
  }

  private async loadCatalogue(filename: string): Promise<PlaylistRecord[]> {
    try {
      const contents = await readFile(join(this.dataDir, filename), 'utf8');
      return PlaylistRecordSchema.array().parse(JSON.parse(contents));
    } catch {
      return [];
    }
  }

  private async saveCatalogue(filename: string, records: PlaylistRecord[]): Promise<void> {
    const validatedRecords = PlaylistRecordSchema.array().parse(records);
    await mkdir(this.dataDir, { recursive: true });

    const destination = join(this.dataDir, filename);
    const temporary = join(this.dataDir, `.${filename}.${randomUUID()}.tmp`);

    try {
      await writeFile(temporary, JSON.stringify(validatedRecords), 'utf8');
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}
