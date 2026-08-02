import { describe, expect, it } from 'vitest';
import { withCleanup } from './helpers/with-cleanup.js';

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
});
