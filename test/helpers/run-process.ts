import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

export type ProcessResult = { code: number | null; stdout: string; stderr: string };

export interface RunProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export class ProcessTimeoutError extends Error {
  constructor(command: string, arguments_: string[], timeoutMs: number, stdout: string, stderr: string, terminationError?: unknown) {
    const termination = terminationError === undefined
      ? ''
      : `\nProcess-tree termination error: ${terminationError instanceof Error ? terminationError.message : String(terminationError)}`;
    super(`${command} ${arguments_.join(' ')} timed out after ${timeoutMs}ms\nstdout:\n${stdout}\nstderr:\n${stderr}${termination}`);
    this.name = 'ProcessTimeoutError';
  }
}

export function runProcess(command: string, arguments_: string[], options: RunProcessOptions): Promise<ProcessResult> {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new RangeError('timeoutMs must be a positive safe integer.');
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
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      void terminateProcessTree(child).then(
        () => finishTimeout(),
        (error: unknown) => finishTimeout(error),
      );
    }, options.timeoutMs);

    const finishTimeout = (terminationError?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new ProcessTimeoutError(command, arguments_, options.timeoutMs, stdout, stderr, terminationError));
    };

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', (error) => {
      if (timedOut || settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      if (timedOut || settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return;

  if (process.platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      shell: false,
      stdio: 'ignore',
      timeout: 10_000,
      windowsHide: true,
    });
    if (result.error && !isNoSuchProcess(result.error)) throw result.error;
    if (!await waitForClose(child, 5_000)) {
      throw new Error(`taskkill did not terminate process tree ${pid}.`);
    }
    return;
  }

  signalProcessGroup(pid, 'SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
  signalProcessGroup(pid, 'SIGKILL');
  if (!await waitForClose(child, 5_000)) {
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
