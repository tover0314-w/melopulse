export interface CliTheme {
  heading(value: string): string;
  accent(value: string): string;
  muted(value: string): string;
  success(value: string): string;
  error(value: string): string;
}

function style(color: boolean, code: number): (value: string) => string {
  return (value) => color ? `\u001B[${code}m${value}\u001B[0m` : value;
}

export function createTheme(color: boolean): CliTheme {
  return {
    heading: style(color, 1),
    accent: style(color, 36),
    muted: style(color, 90),
    success: style(color, 32),
    error: style(color, 31),
  };
}
