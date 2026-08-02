export type OutputMode = 'interactive' | 'plain' | 'json';

export interface CapabilityInput {
  isTTY: boolean;
  stderrIsTTY?: boolean;
  json: boolean;
  noColor: boolean;
  env: NodeJS.ProcessEnv;
  columns?: number;
}

export interface CliCapabilities {
  mode: OutputMode;
  color: boolean;
  unicode: boolean;
  progress: boolean;
  columns: number;
}

export function resolveCliCapabilities(input: CapabilityInput): CliCapabilities {
  const dumb = input.env.TERM === 'dumb';
  const noColor = input.noColor || Object.hasOwn(input.env, 'NO_COLOR');
  const mode: OutputMode = input.json ? 'json' : input.isTTY && !dumb ? 'interactive' : 'plain';
  return {
    mode,
    color: mode === 'interactive' && !noColor,
    unicode: mode !== 'json' && !dumb,
    progress: mode === 'interactive' && input.stderrIsTTY !== false && !noColor,
    columns: Math.max(40, input.columns ?? 80),
  };
}
