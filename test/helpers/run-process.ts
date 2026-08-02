import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

const WINDOWS_TASKKILL_TIMEOUT_MS = 10_000;
const PROCESS_CLOSE_TIMEOUT_MS = 5_000;
const POSIX_TERMINATION_GRACE_MS = 500;

export const PROCESS_TREE_TERMINATION_BUDGET_MS = Math.max(
  WINDOWS_TASKKILL_TIMEOUT_MS + PROCESS_CLOSE_TIMEOUT_MS,
  POSIX_TERMINATION_GRACE_MS + PROCESS_CLOSE_TIMEOUT_MS,
);

export type ProcessResult = { code: number | null; stdout: string; stderr: string };

export interface RunProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  readyPattern?: RegExp;
  startupTimeoutMs?: number;
  timeoutMs: number;
}

export class ProcessTimeoutError extends Error {
  constructor(
    command: string,
    arguments_: string[],
    timeoutMs: number,
    phase: 'startup' | 'operation',
    stdout: string,
    stderr: string,
    terminationError?: unknown,
  ) {
    const termination = terminationError === undefined
      ? ''
      : `\nProcess-tree termination error: ${terminationError instanceof Error ? terminationError.message : String(terminationError)}`;
    const label = phase === 'startup' ? 'startup timed out' : 'operation timed out';
    super(`${command} ${arguments_.join(' ')} ${label} after ${timeoutMs}ms\nstdout:\n${stdout}\nstderr:\n${stderr}${termination}`);
    this.name = 'ProcessTimeoutError';
  }
}

export function runProcess(command: string, arguments_: string[], options: RunProcessOptions): Promise<ProcessResult> {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new RangeError('timeoutMs must be a positive safe integer.');
  }
  if (options.readyPattern !== undefined && (!Number.isSafeInteger(options.startupTimeoutMs) || (options.startupTimeoutMs ?? 0) <= 0)) {
    throw new RangeError('startupTimeoutMs must be a positive safe integer when readyPattern is provided.');
  }
  if (options.readyPattern === undefined && options.startupTimeoutMs !== undefined) {
    throw new RangeError('startupTimeoutMs requires readyPattern.');
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: options.cwd,
      detached: process.platform !== 'win32',
      env: options.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let phase: 'startup' | 'operation' = options.readyPattern === undefined ? 'operation' : 'startup';
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

    const startDeadline = (timeoutMs: number): void => {
      deadlineTimer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        const timedOutPhase = phase;
        void terminateProcessTree(child).then(
          () => finishTimeout(timeoutMs, timedOutPhase),
          (error: unknown) => finishTimeout(timeoutMs, timedOutPhase, error),
        );
      }, timeoutMs);
    };

    const finishTimeout = (timeoutMs: number, timedOutPhase: 'startup' | 'operation', terminationError?: unknown): void => {
      if (settled) return;
      settled = true;
      if (deadlineTimer) clearTimeout(deadlineTimer);
      reject(new ProcessTimeoutError(command, arguments_, timeoutMs, timedOutPhase, stdout, stderr, terminationError));
    };

    const checkReadiness = (): void => {
      if (phase !== 'startup' || timedOut || settled || options.readyPattern === undefined) return;
      options.readyPattern.lastIndex = 0;
      if (!options.readyPattern.test(`${stdout}\n${stderr}`)) return;
      if (deadlineTimer) clearTimeout(deadlineTimer);
      phase = 'operation';
      startDeadline(options.timeoutMs);
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      checkReadiness();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      checkReadiness();
    });
    child.once('error', (error) => {
      if (timedOut || settled) return;
      settled = true;
      if (deadlineTimer) clearTimeout(deadlineTimer);
      reject(error);
    });
    child.once('close', (code) => {
      if (timedOut || settled) return;
      settled = true;
      if (deadlineTimer) clearTimeout(deadlineTimer);
      resolve({ code, stdout, stderr });
    });

    startDeadline(phase === 'startup' ? options.startupTimeoutMs ?? options.timeoutMs : options.timeoutMs);
  });
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return;

  if (process.platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      shell: false,
      stdio: 'ignore',
      timeout: WINDOWS_TASKKILL_TIMEOUT_MS,
      windowsHide: true,
    });
    if (result.error && !isNoSuchProcess(result.error)) throw result.error;
    if (!await waitForClose(child, PROCESS_CLOSE_TIMEOUT_MS)) {
      throw new Error(`taskkill did not terminate process tree ${pid}.`);
    }
    return;
  }

  signalProcessGroup(pid, 'SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, POSIX_TERMINATION_GRACE_MS));
  signalProcessGroup(pid, 'SIGKILL');
  if (!await waitForClose(child, PROCESS_CLOSE_TIMEOUT_MS)) {
    throw new Error(`Signals did not terminate process group ${pid}.`);
  }
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (!isNoSuchProcess(error)) throw error;
  }
}

function waitForClose(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);

  return new Promise((resolve) => {
    const onClose = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off('close', onClose);
      resolve(false);
    }, timeoutMs);
    child.once('close', onClose);
  });
}

function isNoSuchProcess(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH';
}
