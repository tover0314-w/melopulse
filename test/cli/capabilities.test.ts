import { describe, expect, it } from 'vitest';
import { resolveCliCapabilities } from '../../src/cli/capabilities.js';
import { createTheme } from '../../src/cli/theme.js';

describe('CLI capabilities', () => {
  it.each([
    [{ isTTY: false, json: false, noColor: false, env: {}, columns: 90 }, { mode: 'plain', color: false, unicode: true, progress: false, columns: 90 }],
    [{ isTTY: true, json: true, noColor: false, env: {}, columns: 90 }, { mode: 'json', color: false, unicode: false, progress: false, columns: 90 }],
    [{ isTTY: true, json: false, noColor: false, env: {}, columns: 90 }, { mode: 'interactive', color: true, unicode: true, progress: true, columns: 90 }],
    [{ isTTY: true, json: false, noColor: false, env: { NO_COLOR: '1' }, columns: 90 }, { mode: 'interactive', color: false, unicode: true, progress: false, columns: 90 }],
    [{ isTTY: true, stderrIsTTY: false, json: false, noColor: false, env: {}, columns: 90 }, { mode: 'interactive', color: true, unicode: true, progress: false, columns: 90 }],
    [{ isTTY: true, json: false, noColor: false, env: { TERM: 'dumb' }, columns: 90 }, { mode: 'plain', color: false, unicode: false, progress: false, columns: 90 }],
  ] as const)('resolves %#', (input, expected) => {
    expect(resolveCliCapabilities(input)).toEqual(expected);
  });

  it.each([
    ['true', 'plain'],
    ['1', 'plain'],
    ['yes', 'plain'],
    [undefined, 'interactive'],
    ['', 'interactive'],
    ['0', 'interactive'],
    ['false', 'interactive'],
  ] as const)('treats CI=%j as %s output', (ci, mode) => {
    const capabilities = resolveCliCapabilities({
      isTTY: true,
      stderrIsTTY: true,
      json: false,
      noColor: false,
      env: ci === undefined ? {} : { CI: ci },
      columns: 90,
    });

    expect(capabilities).toMatchObject({
      mode,
      color: mode === 'interactive',
      progress: mode === 'interactive',
    });
  });
});

describe('CLI theme', () => {
  it('leaves every semantic style unchanged when color is disabled', () => {
    const theme = createTheme(false);

    expect([
      theme.heading('Heading'),
      theme.accent('Accent'),
      theme.muted('Muted'),
      theme.success('Success'),
      theme.error('Error'),
    ]).toEqual(['Heading', 'Accent', 'Muted', 'Success', 'Error']);
  });

  it('adds ANSI styling to every semantic style when color is enabled', () => {
    const theme = createTheme(true);

    expect([
      theme.heading('Heading'),
      theme.accent('Accent'),
      theme.muted('Muted'),
      theme.success('Success'),
      theme.error('Error'),
    ]).toEqual([
      '\u001B[1mHeading\u001B[0m',
      '\u001B[36mAccent\u001B[0m',
      '\u001B[90mMuted\u001B[0m',
      '\u001B[32mSuccess\u001B[0m',
      '\u001B[31mError\u001B[0m',
    ]);
  });
});
