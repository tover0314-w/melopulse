# MeloPulse CLI And MCP UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship MeloPulse 0.2.0 with a clearer adaptive CLI, a discoverable local catalogue, actionable safe errors, and more precise MCP tools while retaining offline-first behavior and exactly four MCP tools.

**Architecture:** Keep domain and persistence APIs stable. Add small pure CLI presentation modules for capability detection, theme, formatting, progress, and error mapping; leave `src/cli/program.ts` responsible for command wiring. Reuse the safe error representation in MCP so human and agent recovery guidance stays consistent without contaminating MCP stdout.

**Tech Stack:** Node.js 20+, TypeScript 6, Commander 14, Zod 4, MCP SDK 2, Vitest 4, ESLint 9.

## Global Constraints

- Add only one public CLI command: `melopulse list`; retain `add`, `sync`, `recommend`, `play`, and `mcp`.
- Retain exactly four MCP tools and the existing flat recommendation fields: `id`, `title`, `source`, `reason`, `url`, and `playCommand`.
- Do not change `MeloPulseService` public method signatures or JSON success shapes.
- Do not add runtime dependencies, a TUI, web UI, OAuth, playback controls, telemetry, background work, or implicit network access.
- Only explicit `sync` may contact MeloLab; `recommend`, `list`, `add`, and `play` remain local except for the operating-system URL handoff performed by `play`.
- TTY output may use restrained ANSI and one transient stderr status; non-TTY, `TERM=dumb`, `NO_COLOR`, JSON, and MCP output must be stable and free of terminal controls.
- JSON success writes one JSON value to stdout; expected JSON command failures write one JSON error object to stderr and leave stdout empty.
- Never expose a stack, local path, Git content, raw Zod issue tree, credential, or source code in a user-facing error.
- Preserve Node.js 20 support, strict TypeScript settings, Windows path safety, package contents, and cleanup guarantees.

## File Map

- Create `src/cli/capabilities.ts`: derive interactive/plain/JSON, color, Unicode, progress, and width from injected terminal state.
- Create `src/cli/theme.ts`: dependency-free ANSI styling that becomes identity functions when color is disabled.
- Create `src/cli/error-view.ts`: map domain, validation, URL, and unknown errors into the safe shared `ErrorView` contract.
- Create `src/cli/presenter.ts`: format recommendation, catalogue, add, sync, play, empty, and error output.
- Create `src/cli/progress.ts`: own the single clearable stderr status line.
- Create `src/version.ts`: one package/server version constant used by CLI and MCP.
- Modify `src/cli/program.ts`: add `list`, root/subcommand help, global no-color/version, adaptive output, and shared error handling.
- Modify `src/mcp/server.ts`: use the shared version and error view; improve tool descriptions, annotations, and structured errors.
- Modify `test/cli/program.test.ts`: cover every command and output contract through injected IO.
- Create `test/cli/capabilities.test.ts`, `test/cli/error-view.test.ts`, `test/cli/presenter.test.ts`, and `test/cli/progress.test.ts`: pure presentation tests.
- Modify `test/cli/index.test.ts`: verify built root help, version, plain output, JSON failure, `NO_COLOR`, and list.
- Modify `test/mcp/server.test.ts` and `test/mcp/stdio.test.ts`: verify descriptions, annotations, structured errors, tool count, and stdout-safe packed behavior.
- Modify `scripts/smoke-pack.mjs` and `test/smoke-pack.test.ts`: extend installed-tarball CLI and MCP acceptance.
- Modify `package.json`, `package-lock.json`, `README.md`, `docs/mcp.md`, and `CHANGELOG.md`: document and version the completed public experience.

---

### Task 1: Terminal Capabilities, Theme, And Safe Errors

**Files:**
- Create: `src/cli/capabilities.ts`
- Create: `src/cli/theme.ts`
- Create: `src/cli/error-view.ts`
- Create: `test/cli/capabilities.test.ts`
- Create: `test/cli/error-view.test.ts`

**Interfaces:**
- Produces: `resolveCliCapabilities(input: CapabilityInput): CliCapabilities`.
- Produces: `createTheme(color: boolean): CliTheme`.
- Produces: `toErrorView(error: unknown): ErrorView` where `ErrorView` is `{ code: string; message: string; suggestion?: string; retryable: boolean; url?: string }`.
- Consumes: `MeloPulseError`, `z.ZodError`, and the existing domain error codes.

- [ ] **Step 1: Write failing capability tests**

```ts
import { describe, expect, it } from 'vitest';
import { resolveCliCapabilities } from '../../src/cli/capabilities.js';

describe('CLI capabilities', () => {
  it.each([
    [{ isTTY: false, json: false, noColor: false, env: {}, columns: 90 }, { mode: 'plain', color: false, unicode: true, progress: false, columns: 90 }],
    [{ isTTY: true, json: true, noColor: false, env: {}, columns: 90 }, { mode: 'json', color: false, unicode: false, progress: false, columns: 90 }],
    [{ isTTY: true, json: false, noColor: false, env: {}, columns: 90 }, { mode: 'interactive', color: true, unicode: true, progress: true, columns: 90 }],
    [{ isTTY: true, json: false, noColor: false, env: { NO_COLOR: '1' }, columns: 90 }, { mode: 'interactive', color: false, unicode: true, progress: true, columns: 90 }],
    [{ isTTY: true, json: false, noColor: false, env: { TERM: 'dumb' }, columns: 90 }, { mode: 'plain', color: false, unicode: false, progress: false, columns: 90 }],
  ] as const)('resolves %#', (input, expected) => {
    expect(resolveCliCapabilities(input)).toEqual(expected);
  });
});
```

- [ ] **Step 2: Run the capability test and verify it fails**

Run: `npx vitest run test/cli/capabilities.test.ts --no-file-parallelism`

Expected: FAIL because `src/cli/capabilities.ts` does not exist.

- [ ] **Step 3: Implement capability selection and the identity-capable theme**

```ts
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
```

In `theme.ts`, expose `heading`, `accent`, `muted`, `success`, and `error` functions. Each returns its input unchanged when `color` is false; when true it wraps with one ANSI code and `\u001B[0m`.

- [ ] **Step 4: Write failing safe-error tests**

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MeloPulseError } from '../../src/errors.js';
import { toErrorView } from '../../src/cli/error-view.js';

describe('safe CLI error views', () => {
  it('gives a missing playlist a concrete local recovery action', () => {
    expect(toErrorView(new MeloPulseError('PLAYLIST_NOT_FOUND', "Playlist 'missing' was not found."))).toEqual({
      code: 'PLAYLIST_NOT_FOUND',
      message: "Playlist 'missing' was not found.",
      suggestion: 'Run melopulse list or melopulse recommend to choose a valid playlist ID.',
      retryable: false,
    });
  });

  it('collapses Zod details into a safe invalid-input response', () => {
    const error = z.object({ energy: z.enum(['low', 'medium', 'high']) }).safeParse({ energy: 'max' }).error;
    expect(toErrorView(error)).toMatchObject({ code: 'INVALID_INPUT', retryable: false });
    expect(JSON.stringify(toErrorView(error))).not.toContain('invalid_value');
  });

  it('does not expose unknown messages, paths, or stacks', () => {
    const view = toErrorView(new Error('D:\\secret\\catalog.json failed'));
    expect(view).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected internal error occurred.',
      suggestion: 'Retry the command. If it continues, report the error code.',
      retryable: true,
    });
  });
});
```

- [ ] **Step 5: Run the safe-error test and verify it fails**

Run: `npx vitest run test/cli/error-view.test.ts --no-file-parallelism`

Expected: FAIL because `toErrorView` does not exist.

- [ ] **Step 6: Implement the safe error map**

Map these codes exactly:

```ts
const RECOVERY = {
  PLAYLIST_NOT_FOUND: { suggestion: 'Run melopulse list or melopulse recommend to choose a valid playlist ID.', retryable: false },
  PLAYLIST_OPEN_ERROR: { suggestion: 'Open the playlist URL shown below in a browser or music app.', retryable: true },
  MELOLAB_SYNC_TIMEOUT_ERROR: { suggestion: 'Check your connection and run melopulse sync again.', retryable: true },
  MELOLAB_SYNC_NETWORK_ERROR: { suggestion: 'Check your connection and run melopulse sync again. Your previous cache is unchanged.', retryable: true },
  MELOLAB_SYNC_HTTP_ERROR: { suggestion: 'Try melopulse sync again later. Your previous cache is unchanged.', retryable: true },
  MELOLAB_SYNC_INVALID_RESPONSE: { suggestion: 'Try melopulse sync again later. Your previous cache is unchanged.', retryable: true },
} as const;
```

Recognize existing URL validation messages as `INVALID_PLAYLIST_URL`, Zod failures as `INVALID_INPUT`, known `MeloPulseError` instances by code, and everything else as the generic `INTERNAL_ERROR`. Copy an error `url` only when it is a credential-free HTTPS URL.

- [ ] **Step 7: Run focused tests, typecheck, and commit**

Run: `npx vitest run test/cli/capabilities.test.ts test/cli/error-view.test.ts --no-file-parallelism && npm run typecheck`

Expected: all focused tests PASS and TypeScript reports no errors.

Commit:

```bash
git add src/cli/capabilities.ts src/cli/theme.ts src/cli/error-view.ts test/cli/capabilities.test.ts test/cli/error-view.test.ts
git commit -m "feat: add adaptive cli presentation primitives"
```

### Task 2: Presenter And Progress Components

**Files:**
- Create: `src/cli/presenter.ts`
- Create: `src/cli/progress.ts`
- Create: `test/cli/presenter.test.ts`
- Create: `test/cli/progress.test.ts`

**Interfaces:**
- Consumes: `CliCapabilities`, `CliTheme`, `ErrorView`, `PlaylistRecord`, and `RecommendationResult`.
- Produces: `createPresenter(capabilities: CliCapabilities): CliPresenter` with `recommendations`, `playlists`, `savedPlaylist`, `syncResult`, `playResult`, and `error` methods.
- Produces: `startProgress(writer: Writer, capabilities: CliCapabilities, label: string): ProgressHandle` where `ProgressHandle.stop(): void` is idempotent.

- [ ] **Step 1: Write failing presenter tests**

```ts
import { describe, expect, it } from 'vitest';
import type { PlaylistRecord } from '../../src/schema.js';
import { createPresenter } from '../../src/cli/presenter.js';

const plain = { mode: 'plain', color: false, unicode: true, progress: false, columns: 80 } as const;
const playlist: PlaylistRecord = {
  id: 'melolab:focus-flow', source: 'melolab', title: 'Focus Flow',
  url: 'https://melolab.ai/playlist/focus-flow', activityTags: ['debugging'], moodTags: ['calm'],
  energy: 'low', focus: 'high', vocals: 'none',
};

describe('CLI presenter', () => {
  it('renders a recommendation with reason, fit, URL, and copyable play command', () => {
    const text = createPresenter(plain).recommendations([{ playlist, score: 8, reasons: ['Fits debugging work.'] }]);
    expect(text).toContain('1. Focus Flow');
    expect(text).toContain('Why: Fits debugging work.');
    expect(text).toContain('Fit: low energy · high focus · no vocals');
    expect(text).toContain(playlist.url);
    expect(text).toContain('melopulse play melolab:focus-flow');
  });

  it('renders an empty filtered catalogue as success with a next action', () => {
    expect(createPresenter(plain).playlists([], 'spotify')).toBe(
      'No spotify playlists saved.\nAdd one with: melopulse add <playlist-url>',
    );
  });

  it('renders an actionable error without terminal controls', () => {
    const text = createPresenter(plain).error({ code: 'PLAYLIST_NOT_FOUND', message: 'Missing.', suggestion: 'Run melopulse list.', retryable: false });
    expect(text).toBe('Error [PLAYLIST_NOT_FOUND]: Missing.\nTry: Run melopulse list.');
    expect(text).not.toMatch(/\u001B\[/u);
  });
});
```

- [ ] **Step 2: Run presenter tests and verify they fail**

Run: `npx vitest run test/cli/presenter.test.ts --no-file-parallelism`

Expected: FAIL because `createPresenter` does not exist.

- [ ] **Step 3: Implement compact output formatting**

Use these durable human labels: `Why`, `Fit`, `URL`, `Play`, `Saved playlist`, `Synced`, `Opening`, `Error`, `Try`. Return strings without a trailing newline because command wiring owns exactly one final newline. Never truncate IDs, URLs, or commands. Use `·` only when `capabilities.unicode` is true and ` | ` otherwise.

The plain list shape is:

```text
2 playlists

melolab:focus-flow
  Focus Flow
  https://melolab.ai/playlist/focus-flow
```

The interactive formatter may style labels and headings but must preserve the same words and information after ANSI is removed.

- [ ] **Step 4: Write failing progress tests**

```ts
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
```

- [ ] **Step 5: Implement the progress handle and run focused tests**

The handle writes the label and `\r` only when `capabilities.progress` is true. Its idempotent `stop` writes `\u001B[2K` once to clear the transient line. It never starts timers, spinners, or background work.

Run: `npx vitest run test/cli/presenter.test.ts test/cli/progress.test.ts --no-file-parallelism && npm run typecheck`

Expected: focused tests PASS and TypeScript reports no errors.

- [ ] **Step 6: Commit the presenter components**

```bash
git add src/cli/presenter.ts src/cli/progress.ts test/cli/presenter.test.ts test/cli/progress.test.ts
git commit -m "feat: add clear cli results and progress"
```

### Task 3: Command Wiring, Help, List, And Adaptive Output

**Files:**
- Modify: `src/cli/program.ts`
- Modify: `src/cli/index.ts`
- Create: `src/version.ts`
- Modify: `test/cli/program.test.ts`
- Modify: `test/cli/index.test.ts`

**Interfaces:**
- Consumes: all Task 1 and Task 2 interfaces plus the unchanged `MeloPulseService`.
- Produces: `createProgram(service, suppliedIO)` with `CliIO.env?: NodeJS.ProcessEnv`, `CliIO.columns?: number`, global `--no-color`, `--version`, and `list [--source] [--json]`.
- Preserves: JSON success values returned by service methods.

- [ ] **Step 1: Expand the fake service and write failing command tests**

Add call recording for `listPlaylists(source)`, then add assertions covering:

```ts
it('lists local playlists by source without calling sync', async () => {
  const calls: Call[] = [];
  const result = await run(['list', '--source', 'spotify'], fakeService(calls));
  expect(result.stdout).toContain('spotify:abc');
  expect(calls).toEqual([{ method: 'listPlaylists', input: 'spotify' }]);
});

it('keeps JSON errors on stderr and stdout empty', async () => {
  const service = fakeService([]);
  service.play = async () => { throw new MeloPulseError('PLAYLIST_NOT_FOUND', "Playlist 'missing' was not found."); };
  const result = await run(['play', 'missing', '--json'], service);
  expect(result.stdout).toBe('');
  expect(JSON.parse(result.stderr)).toEqual({ error: {
    code: 'PLAYLIST_NOT_FOUND',
    message: "Playlist 'missing' was not found.",
    suggestion: 'Run melopulse list or melopulse recommend to choose a valid playlist ID.',
    retryable: false,
  } });
  expect(result.exitCodes).toEqual([1]);
});

it('never adds ANSI when NO_COLOR is present', async () => {
  const result = await run(['recommend', '--no-git'], fakeService([]), { isInteractive: true, env: { NO_COLOR: '' } });
  expect(result.stdout).not.toMatch(/\u001B\[/u);
});
```

Update the local `run` helper to accept an optional partial `CliIO`, including `isInteractive`, `env`, and `columns`.

- [ ] **Step 2: Run command tests and verify the new cases fail**

Run: `npx vitest run test/cli/program.test.ts --no-file-parallelism`

Expected: FAIL because `list`, adaptive presentation, and JSON error objects are absent.

- [ ] **Step 3: Wire global capabilities and root help**

Set the shared version in `src/version.ts`:

```ts
export const MELOPULSE_VERSION = '0.2.0';
```

Configure the program with:

```ts
program
  .name('melopulse')
  .description('Local coding playlists for people and agents')
  .version(MELOPULSE_VERSION)
  .option('--no-color', 'disable terminal colors')
  .addHelpText('after', `\nQuick start:\n  melopulse recommend\n  melopulse play <playlist-id>\n\nOffline by default. Only sync contacts MeloLab.\n`);
```

Each action resolves capabilities from command JSON state, injected `isInteractive`, `env`, `columns`, and `program.opts().color === false`. Keep MCP action outside human presentation and progress code.

- [ ] **Step 4: Add list and replace inline formatting**

Register:

```ts
program.command('list')
  .description('List playlists in the local catalogue')
  .option('--source <source>', 'filter by melolab, spotify, apple_music, youtube_music, or generic')
  .option('--json', 'print JSON')
  .addHelpText('after', '\nExample:\n  melopulse list --source spotify\n')
  .action(async (options: { source?: Provider; json?: boolean }) => {
    await runCommand(io, capabilitiesFor(options.json), async (presenter) => {
      const playlists = await service.listPlaylists(options.source);
      writeResult(io, options.json, playlists, presenter.playlists(playlists, options.source));
    });
  });
```

Replace every inline human string with presenter calls. Start and stop progress around `service.syncCatalog()` in `try/finally`. Keep `add` prompting only when interactive and no title is provided. `runCommand` must use `toErrorView`, emit presenter text in human modes, emit `{ error: view }` in JSON mode, and set exit code 1.

- [ ] **Step 5: Add realistic subcommand examples and built-CLI assertions**

Add examples to `add`, `sync`, `recommend`, `play`, and `mcp` help. Extend `test/cli/index.test.ts` with built-process checks for `--version`, root quick start, `list --json`, invalid input JSON purity, and absence of ANSI when stdout is piped or `NO_COLOR` is set.

- [ ] **Step 6: Run CLI tests and the complete verification command**

Run: `npx vitest run test/cli --no-file-parallelism && npm run verify`

Expected: all CLI and repository checks PASS; built plain output contains no ANSI/cursor sequences; invalid JSON command output has empty stdout and one parseable stderr object.

- [ ] **Step 7: Commit the CLI experience**

```bash
git add src/cli/program.ts src/cli/index.ts src/version.ts test/cli/program.test.ts test/cli/index.test.ts
git commit -m "feat: polish cli journeys and add catalogue list"
```

### Task 4: Agent-Facing MCP Descriptions, Annotations, And Errors

**Files:**
- Modify: `src/mcp/server.ts`
- Modify: `test/mcp/server.test.ts`
- Modify: `test/mcp/stdio.test.ts`

**Interfaces:**
- Consumes: `MELOPULSE_VERSION` and `toErrorView`.
- Preserves: exactly four tool names, success schemas, and flat recommendation output.
- Produces: error results whose text and `structuredContent` both contain `{ error: ErrorView }`.

- [ ] **Step 1: Write failing tool metadata and structured-error tests**

```ts
expect(Object.fromEntries(tools.tools.map((tool) => [tool.name, tool.annotations]))).toMatchObject({
  melopulse_recommend: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  melopulse_add_playlist: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  melopulse_list_playlists: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  melopulse_sync_catalog: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
});

const errorText = JSON.parse(result.content[0]?.type === 'text' ? result.content[0].text : '');
expect(result.structuredContent).toEqual(errorText);
expect(errorText).toEqual({ error: {
  code: 'MELOLAB_SYNC_NETWORK_ERROR',
  message: 'Unable to retrieve the MeloLab catalogue.',
  suggestion: 'Check your connection and run melopulse sync again. Your previous cache is unchanged.',
  retryable: true,
} });
```

Also assert each description states whether it is local-only or contacts MeloLab, and that the list tool mentions its optional source filter.

- [ ] **Step 2: Run MCP tests and verify the metadata/error cases fail**

Run: `npx vitest run test/mcp/server.test.ts --no-file-parallelism`

Expected: FAIL because complete annotations, recovery guidance, and structured error content are absent.

- [ ] **Step 3: Implement exact agent guidance**

Use descriptions with these facts:

- `melopulse_recommend`: local-only, optional safe Git context, no code upload, default limit 3.
- `melopulse_add_playlist`: saves one HTTPS link and supplied tags locally, fetches no provider metadata, duplicate URLs update idempotently.
- `melopulse_list_playlists`: local-only catalogue listing with optional `source` filter.
- `melopulse_sync_catalog`: the only network tool, explicitly contacts MeloLab and preserves the prior cache on failure.

Set all four annotation booleans explicitly. Replace MCP-local error mapping with `toErrorView(error)` and return:

```ts
const details = { error: toErrorView(error) };
return {
  isError: true,
  content: [{ type: 'text' as const, text: JSON.stringify(details) }],
  structuredContent: details,
};
```

Use `MELOPULSE_VERSION` for the server version. Do not log, color, or write directly to stdout.

- [ ] **Step 4: Verify in-memory and stdio behavior**

Run: `npx vitest run test/mcp/server.test.ts test/mcp/stdio.test.ts --no-file-parallelism && npm run typecheck`

Expected: all MCP tests PASS; stdio still lists exactly four tools and returns a recommendation without network access.

- [ ] **Step 5: Commit the MCP polish**

```bash
git add src/mcp/server.ts test/mcp/server.test.ts test/mcp/stdio.test.ts
git commit -m "feat: improve mcp agent guidance and recovery"
```

### Task 5: Versioned Documentation And Installed-Package UX

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `docs/mcp.md`
- Modify: `CHANGELOG.md`
- Modify: `scripts/smoke-pack.mjs`
- Modify: `test/smoke-pack.test.ts`

**Interfaces:**
- Consumes: the finished CLI and MCP behavior.
- Produces: 0.2.0 package metadata, user-first docs, and installed-tarball smoke coverage for the public journeys.

- [ ] **Step 1: Extend the packed-install smoke test before changing the script**

Require the smoke output to include all milestones:

```ts
expect(result.stdout).toContain('Packed CLI help smoke passed');
expect(result.stdout).toContain('Packed CLI catalogue smoke passed');
expect(result.stdout).toContain('Packed CLI JSON error smoke passed');
expect(result.stdout).toContain('Packed MCP smoke test passed');
expect(result.stdout).toContain('Packed-install smoke test passed');
```

- [ ] **Step 2: Run the packed smoke test and verify it fails**

Run: `npx vitest run test/smoke-pack.test.ts --no-file-parallelism`

Expected: FAIL because the script does not emit the new CLI milestones.

- [ ] **Step 3: Expand the installed-tarball script**

After installing the tarball into an isolated directory:

1. Run `--help`; assert quick start, `list`, and the offline/network statement.
2. Run `--version`; assert exactly `0.2.0` plus a newline.
3. Run `recommend --no-git --json`; validate a non-empty array.
4. Run `add https://open.spotify.com/playlist/pack-smoke --title "Pack Smoke" --json`; validate the saved ID.
5. Run `list --source spotify --json`; validate exactly the saved record.
6. Run `play missing --json`; allow exit code 1, require empty stdout and one safe JSON error on stderr.
7. Run the existing MCP tool list and recommendation checks.
8. Remove the tarball and both temporary locations in `finally`.

Add a `runResult` helper that returns status/stdout/stderr for the expected failure case; keep all child execution shell-free.

- [ ] **Step 4: Update public docs and package version**

Run `npm version 0.2.0 --no-git-tag-version` to update both package files. Rewrite the README journey in this order:

1. `melopulse recommend`
2. `melopulse play <playlist-id>`
3. `melopulse list`
4. `melopulse add <playlist-url>`
5. `melopulse sync`
6. MCP setup

Keep the package-unpublished notice. Add terminal examples with the finalized labels, document `--no-color`, `NO_COLOR`, JSON stdout/stderr behavior, local imports for Spotify/Apple Music/YouTube Music/generic HTTPS, and the rule that only sync contacts MeloLab. Update `docs/mcp.md` with selection/recovery guidance and annotations. Add a 0.2.0 changelog section dated 2026-08-02.

- [ ] **Step 5: Run documentation/package checks and commit**

Run: `npx vitest run test/smoke-pack.test.ts test/packaging.test.ts --no-file-parallelism && npm run verify && npm pack --dry-run`

Expected: smoke and packaging tests PASS, full verification PASS, dry-run includes documentation and compiled presentation modules but excludes source/tests/secrets.

Commit:

```bash
git add package.json package-lock.json README.md docs/mcp.md CHANGELOG.md scripts/smoke-pack.mjs test/smoke-pack.test.ts
git commit -m "docs: prepare melopulse 0.2.0 ux release"
```

### Task 6: Whole-Product Local Acceptance And Cleanup

**Files:**
- Modify only if a failing acceptance check exposes a defect; pair every defect fix with its smallest regression test.
- Record commands and results in the final task handoff, not in a generated repository artifact.

**Interfaces:**
- Consumes: the complete 0.2.0 branch.
- Produces: evidence that source, built files, installed tarball, MCP stdio, real MeloLab sync, cleanup, and supported runtimes behave as designed.

- [ ] **Step 1: Verify a clean reproducible source build**

Run from a clean worktree after removing only generated `dist`:

```bash
npm ci
npm run verify
npm run smoke:pack
npm pack --dry-run
```

Expected: dependency install succeeds; typecheck, lint, all tests, and build pass; installed tarball smoke passes every CLI/MCP milestone; pack dry-run lists only intended release files.

- [ ] **Step 2: Run mode and command matrix checks**

Exercise root help/version and every public CLI command through built code. For `add`, `list`, `recommend`, `sync`, and `play`, cover supported human/plain/JSON modes; cover `--no-color`, `NO_COLOR`, `TERM=dumb`, redirected stdout/stderr, invalid enums, invalid URL, missing ID, duplicate add, empty source filter, and sync failure with cache preservation.

Expected: no ANSI or cursor controls outside eligible TTY output; JSON is exactly one value; failures are actionable and do not leak internals; all commands use correct exit codes.

- [ ] **Step 3: Run MCP behavior and network-isolation checks**

Run in-memory and built stdio tests, then execute the installed-tarball MCP smoke. Confirm exactly four tools, accurate annotations/descriptions, text/structured success agreement, text/structured error agreement, and no non-protocol stdout. Inject a fetch function that throws into service-level `recommend`, `list`, and `add` tests to prove they never use it.

Expected: all checks PASS and only explicit sync reaches fetch.

- [ ] **Step 4: Run isolated live MeloLab sync**

Create an OS temporary configuration directory, run `node dist/cli/index.js sync --json` with `MELOPULSE_CONFIG_DIR` pointing there, parse the returned count and playlist array, then run `list --source melolab --json` against the same directory. Validate each returned URL is credential-free HTTPS and each ID is shell-safe. Remove the exact resolved temporary directory in `finally` and confirm it no longer exists.

Expected: current public MeloLab catalogue syncs, the same records list locally, and cleanup is complete. If the external endpoint is unavailable, retain the full local simulated-sync evidence and report the external condition separately rather than weakening tests.

- [ ] **Step 5: Verify runtime and filesystem portability**

Run the full test suite under the current Node version and Node 20 when a local Node 20 runtime is available. Run the packed smoke from a repository path containing spaces and `&`. Compile a tiny strict TypeScript consumer importing `createMeloPulseService` from the installed tarball.

Expected: current and available Node 20 runs pass, Windows special-character paths remain shell-safe, and public declarations compile for a consumer.

- [ ] **Step 6: Detect leaks and flaky behavior**

Run `npm test` three consecutive times with cold Vitest processes. Before and after, enumerate OS temporary directories matching only the exact `melopulse-*` test prefixes. Confirm tests remove everything they created and no MCP or child Node process remains.

Expected: all three runs pass, temporary-directory delta is zero, and no child process remains.

- [ ] **Step 7: Audit the release diff and package**

Run `git diff --check`, inspect `git status --short`, review every changed file, search tracked/release files for credential-like values, and inspect `npm pack --json`. Compare the result against every acceptance criterion in the design spec.

Expected: no whitespace errors, unrelated files, secrets, placeholders, missing tests, accidental source files, or API compatibility changes.

- [ ] **Step 8: Request independent review and address findings**

Use `superpowers:requesting-code-review` against the complete branch. For each actionable finding, use `superpowers:receiving-code-review`, reproduce the concern, write a failing regression test, make the smallest fix, and rerun the relevant focused and full checks.

Expected: reviewer approves with no unresolved P1/P2 findings.

- [ ] **Step 9: Create the final verification commit if acceptance produced fixes**

If acceptance changed files, commit only the verified fixes and regression tests:

```bash
git add -u
git commit -m "test: complete cli and mcp ux acceptance"
```

If no files changed, do not create an empty commit.

## Completion Gate

- [ ] All six task deliverables have passed their focused review gates.
- [ ] `npm run verify` passes from clean dependencies and generated output.
- [ ] Installed-tarball CLI and MCP smoke tests pass.
- [ ] Real sync is verified or its external unavailability is reported with simulated coverage intact.
- [ ] Repeated test runs leave no processes or temporary directories.
- [ ] The package remains unpublished and no GitHub billing workaround is attempted.
- [ ] The branch is pushed only after the independent final review is approved.
