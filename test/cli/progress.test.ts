import { expect, it } from 'vitest';
import { startProgress } from '../../src/cli/progress.js';

it('writes and clears one interactive stderr status exactly once', () => {
  let output = '';
  const progress = startProgress({ write: (text: string) => { output += text; } }, {
    mode: 'interactive', color: false, unicode: true, progress: true, columns: 80,
  }, 'Syncing MeloLab catalogue…');
  progress.stop();
  progress.stop();
  expect(output).toBe('Syncing MeloLab catalogue…\r\u001B[2K');
});

it('is silent in plain mode', () => {
  let output = '';
  startProgress({ write: (text: string) => { output += text; } }, {
    mode: 'plain', color: false, unicode: true, progress: false, columns: 80,
  }, 'Syncing').stop();
  expect(output).toBe('');
});
