import type { CliCapabilities } from './capabilities.js';

export interface Writer {
  write(text: string): unknown;
}

export interface ProgressHandle {
  stop(): void;
}

export function startProgress(writer: Writer, capabilities: CliCapabilities, label: string): ProgressHandle {
  const active = capabilities.progress;
  let stopped = false;

  if (active) writer.write(`${label}\r`);

  return {
    stop() {
      if (!active || stopped) return;
      stopped = true;
      writer.write('\u001B[2K');
    },
  };
}
