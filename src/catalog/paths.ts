import envPaths from 'env-paths';

export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.MELOPULSE_CONFIG_DIR || envPaths('melopulse', { suffix: '' }).config;
}
