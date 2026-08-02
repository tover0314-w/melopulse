import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runProcess } from './helpers/run-process.js';

describe('bounded test subprocesses', () => {
  it('kills the exact child tree on timeout and preserves diagnostic output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'melopulse timeout & '));
    const marker = join(directory, 'grandchild-survived.txt');
    const grandchildSource = `
      const { writeFileSync } = require('node:fs');
      setTimeout(() => writeFileSync(${JSON.stringify(marker)}, 'survived'), 750);
      setTimeout(() => process.exit(0), 800);
    `;
    const parentSource = `
      const { spawn } = require('node:child_process');
      spawn(process.execPath, ['-e', ${JSON.stringify(grandchildSource)}], { shell: false, stdio: 'ignore' });
      process.stdout.write('captured parent stdout\\n');
      process.stderr.write('captured parent stderr\\n');
      setTimeout(() => process.exit(0), 900);
    `;
    let caught: unknown;

    try {
      try {
        await runProcess(process.execPath, ['-e', parentSource], { cwd: directory, timeoutMs: 100 });
      } catch (error) {
        caught = error;
      }

      await new Promise((resolve) => setTimeout(resolve, 900));
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toContain('timed out after 100ms');
      expect((caught as Error).message).toContain('captured parent stdout');
      expect((caught as Error).message).toContain('captured parent stderr');
      expect(existsSync(marker)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
      expect(existsSync(directory)).toBe(false);
    }
  }, 5_000);
});
