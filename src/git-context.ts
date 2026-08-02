import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 16 * 1024;

export type GitContext = {
  branch: string;
  latestCommit: string;
  changedFileCount: number;
  changedAreas: string[];
};

export async function readGitContext(workspacePath: string): Promise<GitContext | null> {
  try {
    if (!(await stat(workspacePath)).isDirectory()) return null;
  } catch {
    return null;
  }

  const options = { cwd: workspacePath, encoding: 'utf8' as const, maxBuffer: MAX_GIT_OUTPUT_BYTES };

  try {
    await executeFile('git', ['rev-parse', '--show-toplevel'], options);
  } catch {
    return null;
  }

  try {
    const [branch, latestCommit, status] = await Promise.all([
      executeFile('git', ['branch', '--show-current'], options),
      executeFile('git', ['log', '-1', '--pretty=%s'], options),
      executeFile('git', ['status', '--short'], options),
    ]);
    const changedPaths = status.stdout.split(/\r?\n/).filter(Boolean);

    return {
      branch: branch.stdout.trim(),
      latestCommit: latestCommit.stdout.trim(),
      changedFileCount: changedPaths.length,
      changedAreas: [...new Set(changedPaths.map(changedArea))].sort((left, right) => left.localeCompare(right)),
    };
  } catch {
    return null;
  }
}

function changedArea(statusLine: string): string {
  const path = statusLine.slice(3).split(' -> ').at(-1)?.trim() ?? '';
  const firstDirectory = path.replaceAll('\\', '/').split('/')[0]?.replace(/^"|"$/g, '');

  return firstDirectory && firstDirectory !== '.' && firstDirectory !== '..' && path.includes('/')
    ? firstDirectory
    : 'root';
}
