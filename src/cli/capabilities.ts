export type OutputMode = 'interactive' | 'plain' | 'json';

export interface CapabilityInput {
  isTTY: boolean;
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
  const mode: OutputMode = input.json ? 'json' : input.isTTY && !dumb ? 'interactive' : 'plain';
  return {
    mode,
    color: mode === 'interactive' && !input.noColor && !Object.hasOwn(input.env, 'NO_COLOR'),
    unicode: mode !== 'json' && !dumb,
    progress: mode === 'interactive',
    columns: Math.max(40, input.columns ?? 80),
  };
}
