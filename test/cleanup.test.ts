import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withAcquisitionCleanup, withCleanup } from './helpers/with-cleanup.js';

describe('test cleanup error handling', () => {
  it('preserves both the primary diagnostic and a cleanup failure', async () => {
    const primary = new Error('primary assertion diagnostic');
    const cleanup = new Error('cleanup diagnostic');
    let caught: unknown;

    try {
      await withCleanup(
        async () => { throw primary; },
        async () => { throw cleanup; },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([primary, cleanup]);
    expect((caught as Error).message).toContain('operation and cleanup both failed');
  });

  it('surfaces a lone cleanup failure unchanged', async () => {
    const cleanup = new Error('cleanup only');

    await expect(withCleanup(
      async () => 'result',
      async () => { throw cleanup; },
    )).rejects.toBe(cleanup);
  });

  it('removes a partially acquired root and preserves acquisition and cleanup failures', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'melopulse failed acquisition & '));
    const acquisitionError = new Error('acquisition diagnostic');
    const cleanupError = new Error('acquisition cleanup diagnostic');
    let caught: unknown;

    try {
      try {
        await withAcquisitionCleanup(async () => {
          await writeFile(join(parent, 'partial-copy'), 'partial');
          throw acquisitionError;
        }, async () => {
          await rm(parent, { recursive: true, force: true });
          throw cleanupError;
        });
      } catch (error) {
        caught = error;
      }

      expect(existsSync(parent)).toBe(false);
      expect(caught).toBeInstanceOf(AggregateError);
      expect((caught as AggregateError).errors).toEqual([acquisitionError, cleanupError]);
      expect((caught as Error).message).toContain('acquisition and cleanup both failed');
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
