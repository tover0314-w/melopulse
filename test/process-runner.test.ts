import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROCESS_TREE_TERMINATION_BUDGET_MS, runProcess } from './helpers/run-process.js';
import { withCleanup } from './helpers/with-cleanup.js';

const STARTUP_TIMEOUT_MS = 5_000;
const OPERATION_TIMEOUT_MS = 100;
const PID_EXIT_TIMEOUT_MS = 2_000;
const CLEANUP_TIMEOUT_BUDGET_MS = 5_000;
const TEST_HARNESS_MARGIN_MS = 23_000;
const INNER_TIMEOUT_BUDGET_MS = STARTUP_TIMEOUT_MS
  + OPERATION_TIMEOUT_MS
  + PROCESS_TREE_TERMINATION_BUDGET_MS
  + PID_EXIT_TIMEOUT_MS
  + CLEANUP_TIMEOUT_BUDGET_MS;
const PROCESS_RUNNER_TEST_TIMEOUT_MS = INNER_TIMEOUT_BUDGET_MS + TEST_HARNESS_MARGIN_MS;

describe('bounded test subprocesses', () => {
  it('starts the operation deadline after readiness and kills the reported grandchild PID', async () => {
    expect(INNER_TIMEOUT_BUDGET_MS).toBeLessThan(PROCESS_RUNNER_TEST_TIMEOUT_MS);
    expect(PROCESS_RUNNER_TEST_TIMEOUT_MS).toBeGreaterThanOrEqual(45_000);
    expect(PROCESS_RUNNER_TEST_TIMEOUT_MS).toBeLessThanOrEqual(60_000);

    const directory = await mkdtemp(join(tmpdir(), 'melopulse timeout & '));
    const grandchildSource = `
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_500);
      process.stdout.write('GRANDCHILD_READY ' + process.pid + '\\n');
      setInterval(() => {}, 1_000);
    `;
    const parentSource = `
      const { spawn } = require('node:child_process');
      const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildSource)}], {
        shell: false,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      grandchild.stdout.pipe(process.stdout);
      process.stderr.write('captured parent stderr\\n');
      setInterval(() => {}, 1_000);
    `;
    let caught: unknown;

    await withCleanup(async () => {
      try {
        await runProcess(process.execPath, ['-e', parentSource], {
          cwd: directory,
          readyPattern: /GRANDCHILD_READY \d+/,
          startupTimeoutMs: STARTUP_TIMEOUT_MS,
          timeoutMs: OPERATION_TIMEOUT_MS,
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      const diagnostics = (caught as Error).message;
      expect(diagnostics).toContain(`timed out after ${OPERATION_TIMEOUT_MS}ms`);
      expect(diagnostics).toContain('captured parent stderr');
      const ready = diagnostics.match(/GRANDCHILD_READY (\d+)/);
      expect(ready).not.toBeNull();
      const grandchildPid = Number(ready?.[1]);
      expect(Number.isSafeInteger(grandchildPid)).toBe(true);

      await waitForProcessExit(grandchildPid, PID_EXIT_TIMEOUT_MS);
      expect(isProcessRunning(grandchildPid)).toBe(false);
    }, async () => {
      await rm(directory, { recursive: true, force: true });
      expect(existsSync(directory)).toBe(false);
    });
  }, PROCESS_RUNNER_TEST_TIMEOUT_MS);
});

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (isProcessRunning(pid)) {
    if (Date.now() >= deadline) throw new Error(`Process ${pid} was still running after ${timeoutMs}ms.`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
}
