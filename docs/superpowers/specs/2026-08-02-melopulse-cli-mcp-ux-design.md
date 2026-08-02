# MeloPulse CLI And MCP UX Polish Design

**Date:** 2026-08-02  
**Status:** Approved by delegated user direction  
**Target release:** 0.2.0  
**Repository:** `tover0314-w/melopulse`

## Summary

MeloPulse 0.2.0 will polish the existing CLI and MCP experience without adding a TUI, web application, account system, player controller, background process, or new implicit network behavior.

The experience will adapt to its caller:

- Interactive terminals receive concise color, readable hierarchy, progress state, examples, and next-step guidance.
- Non-interactive terminals receive stable plain text without cursor control or decoration.
- `--json` receives machine-stable JSON with no ANSI sequences or progress output.
- MCP clients receive stable schemas, precise descriptions, actionable structured errors, and no protocol-contaminating stdout.

The design serves three journeys with one presentation system:

1. A first-time user reaches a useful recommendation and understands how to open it in under one minute.
2. A returning user can discover, filter, recommend, and open playlists with minimal command repetition.
3. An agent can select tools, interpret results, and recover from expected errors without guessing.

## Design Decision

Three approaches were considered:

1. **Copy-only polish.** Improve help and messages without changing command structure. This has low risk but leaves playlist discovery, validation, and agent recovery weak.
2. **Layered adaptive UX.** Add a reusable presentation layer, one missing discovery command, adaptive terminal behavior, and structured MCP guidance. This is the selected approach because it improves all three journeys while preserving a small local-first product.
3. **Guided terminal application.** Add a wizard or TUI with menus and persistent sessions. This offers more visible interaction but creates a second application model and is outside the desired simplicity.

## Product Principles

### Useful with zero configuration

`melopulse recommend` must continue to return a bundled recommendation without an account, prior sync, imported playlists, or network access.

### Human-friendly and automation-safe

Human presentation is an adapter over stable domain results. It must not change recommendation scoring, catalogue persistence, provider detection, network boundaries, or MCP domain behavior.

### Explicit side effects

Only `sync` contacts MeloLab. Only `play` asks the operating system to open a URL. Progress text must never hide those boundaries.

### Guidance without ceremony

Every successful command may show one useful next action. MeloPulse will not introduce multi-step setup, onboarding state, mandatory prompts, or a full-screen interface.

### Color is optional decoration

Labels, wording, spacing, and ordering carry meaning. Color never becomes the only success, warning, source, or error signal.

## Adaptive Output Contract

MeloPulse will classify output into three modes.

### Interactive mode

Interactive mode is enabled only when the relevant output stream is a TTY and all of the following are true:

- `--json` is not active.
- `--no-color` is not active for color behavior.
- `NO_COLOR` is not present for color behavior.
- `TERM` is not `dumb` for cursor behavior.
- The process is not the MCP stdio server.

Interactive mode may use restrained ANSI color, bold headings, a single transient progress line on stderr, and Unicode punctuation. All information remains understandable with ANSI removed.

### Plain mode

Plain mode is used for redirected output, pipelines, CI, dumb terminals, and explicit no-color operation. It uses complete text labels, ASCII-safe layout, no cursor movement, and no progress animation.

### JSON mode

JSON mode is enabled per command with `--json`.

- Success writes exactly one JSON value followed by a newline to stdout.
- Expected command errors write exactly one JSON error object followed by a newline to stderr and leave stdout empty.
- JSON never contains ANSI control sequences.
- Progress output is disabled.
- Exit status remains `0` for success and non-zero for failure.

The JSON error shape is:

```json
{
  "error": {
    "code": "INVALID_ACTIVITY",
    "message": "Unknown activity 'fixing'.",
    "suggestion": "Choose debugging, feature, reviewing, shipping, maintenance, or deep_focus.",
    "retryable": false
  }
}
```

## CLI Information Architecture

The CLI will expose six user-facing commands:

```text
add
list
sync
recommend
play
mcp
```

`list` is the only new command. It exposes the catalogue discovery capability already present in the service and MCP API.

Global options:

```text
--version
--no-color
--help
```

Command-specific `--json` flags remain explicit so normal MCP stdio behavior cannot inherit presentation flags accidentally.

### Root help

Root help begins with a one-sentence value statement, shows the shortest successful journey, then lists commands.

```text
MeloPulse — local coding playlists for people and agents

Start here:
  melopulse recommend
  melopulse play <playlist-id>

No account required. Recommendation stays local; only sync contacts MeloLab.
```

Each subcommand includes at least one realistic example and calls out side effects where relevant.

## Command Experience

### `recommend`

Default invocation remains the primary first-run experience:

```text
MeloPulse recommendations
Context: local catalogue · Git context on · 3 requested

1. Focus Flow
   Why: Focus fallback for a neutral starting point.
   Fit: MeloLab · low energy · high focus · no vocals
   URL: https://melolab.ai/playlist/launch-showcase-playlist-focus-flow
   Play: melopulse play melolab:launch-showcase-playlist-focus-flow
```

Rules:

- Show the selected context without revealing raw branch names, commit messages, or file paths.
- Show source and focus attributes using text, not color alone.
- Use all recommendation reasons when useful, deduplicated and joined into one readable sentence.
- Keep `--json` domain-compatible unless a versioned contract change is explicitly required.
- Keep ordering deterministic.
- For narrow terminals, wrap explanatory text but never alter playlist IDs, URLs, or copyable commands.

### `list`

Syntax:

```text
melopulse list [--source <source>] [--json]
```

Human output shows catalogue count and one compact block per playlist:

```text
12 playlists

melolab:launch-showcase-playlist-focus-flow
  Focus Flow · MeloLab · low energy · high focus
  https://melolab.ai/playlist/launch-showcase-playlist-focus-flow
```

Rules:

- Source values are the existing provider enum.
- Empty filtered results are a successful state with a suggestion to add or sync.
- JSON output is the existing array of playlist records.
- The command performs no network access.

### `add`

Interactive title prompting remains optional and happens only when stdin is interactive and no title was supplied.

Success output includes:

- The normalized provider.
- The final local title.
- The stable playlist ID.
- The stored HTTPS URL.
- One next action: `melopulse recommend`.

Duplicate imports remain idempotent. Both first-time and repeated imports use the neutral confirmation `Saved playlist`, avoiding a public service API change or an extra catalogue read solely for presentation.

Invalid URLs, tags, or enum values receive concise option-specific errors and allowed values.

### `sync`

Interactive mode writes a transient status to stderr:

```text
Syncing MeloLab's public catalogue…
```

Success replaces it with a durable result:

```text
Synced 20 public playlists from MeloLab.
Next: melopulse recommend
```

Plain mode emits only the durable result. JSON mode emits only the sync result. Failure states explain that the previous local cache was preserved.

### `play`

Success output states the explicit handoff:

```text
Opening in your default browser or music app:
https://melolab.ai/playlist/launch-showcase-playlist-focus-flow
```

If the operating system rejects the handoff, the URL remains visible and copyable. A missing ID suggests `melopulse list` and `melopulse recommend`.

### `mcp`

`mcp` remains silent on stdout except for MCP protocol messages. It receives no color, progress, banner, or onboarding output.

## Error Experience

The presentation layer converts known failures into a common error view:

```ts
type ErrorView = {
  code: string;
  message: string;
  suggestion?: string;
  retryable: boolean;
  url?: string;
};
```

Known error families include:

- Schema and CLI input validation.
- Missing playlist IDs.
- Local catalogue read/write failures.
- Corrupted local files that were safely ignored.
- MeloLab timeout, network, HTTP, and response errors.
- Operating-system URL handoff failures.

Human errors use this order:

```text
Error: <message>
Try: <suggestion>
URL: <fallback URL, when relevant>
```

No stack trace, source path, Git detail, credential, or raw Zod issue array is shown by default.

## MCP Agent Experience

The MCP server keeps exactly four tools. No presentation-only CLI command becomes an MCP tool.

### Tool descriptions

Descriptions will state:

- Whether the tool is local-only.
- Whether it reads optional safe Git context.
- Whether it changes local catalogue state.
- Whether it contacts MeloLab.
- Important defaults such as recommendation limit and Git-context behavior.

### Tool annotations

Annotations will reflect actual behavior:

- Recommend and list are read-only and closed-world/local.
- Add is local, non-destructive, and idempotent for the same URL.
- Sync is explicit, non-destructive to the previous cache on failure, idempotent, and open-world because it contacts MeloLab.

### Structured errors

Known MCP failures return:

```json
{
  "error": {
    "code": "PLAYLIST_NOT_FOUND",
    "message": "Playlist 'melolab:missing' was not found.",
    "suggestion": "Call melopulse_list_playlists or melopulse_recommend to choose a valid playlist ID.",
    "retryable": false
  }
}
```

The same error object is present in text content and `structuredContent`. Unknown errors remain `INTERNAL_ERROR` without stack traces. MCP output never includes ANSI sequences.

### Recommendation contract

The existing flat MCP recommendation contract remains unchanged:

```text
id, title, source, reason, url, playCommand
```

## Architecture

The domain and presentation layers remain separate.

### New CLI modules

```text
src/cli/capabilities.ts
src/cli/theme.ts
src/cli/presenter.ts
src/cli/progress.ts
src/cli/error-view.ts
```

- `capabilities.ts` decides interactive, plain, and JSON behavior from injected IO and environment state.
- `theme.ts` applies optional ANSI styling and exposes a zero-ANSI plain theme.
- `presenter.ts` formats help-adjacent success output, playlist lists, recommendations, and next actions.
- `progress.ts` owns the single transient stderr line and is a no-op outside eligible interactive terminals.
- `error-view.ts` maps domain, validation, and unknown failures to safe actionable errors.

All modules are dependency-light and testable with injected streams, TTY flags, environment variables, and terminal widths. No production formatter reads global process state directly when it can be injected.

### Existing module changes

- `src/cli/program.ts` becomes command wiring rather than owning formatting rules.
- `src/service.ts` keeps its current public return types and persistence behavior.
- `src/mcp/server.ts` enriches descriptions, annotations, and known error output.
- `src/errors.ts` remains the stable domain error boundary and may gain safe metadata fields.
- `src/schema.ts` continues to own public enum and input constraints.

### Dependency policy

Prefer Node APIs and small pure local helpers. Do not add a TUI framework, logging framework, analytics SDK, prompt framework, or general styling library unless implementation proves the local helper would be less reliable.

## Accessibility And Terminal Compatibility

- Honor `NO_COLOR`, `--no-color`, non-TTY output, `TERM=dumb`, and JSON mode.
- Never encode meaning with color alone.
- Avoid continuous animation; at most one transient progress line is active.
- Clear transient lines before durable errors or results.
- Keep URLs, IDs, and commands untruncated and copyable.
- Use readable text labels rather than icon-only status.
- Keep output useful in PowerShell, cmd.exe, bash, CI logs, redirected files, and screen readers.
- Ensure output remains valid UTF-8; plain-mode tests cover ASCII-safe punctuation where terminal capability is limited.

## Documentation Experience

README will be reorganized around outcomes:

1. Get a recommendation.
2. Open it.
3. Add an existing playlist link.
4. Optionally sync MeloLab.
5. Configure MCP.

README and MCP examples will show both local-checkout and future-published-package commands without implying npm has already been published.

Command help, README, examples, and MCP descriptions must use the same command names, defaults, network wording, and privacy boundary.

## Testing Strategy

Testing is part of the UX contract, not a final visual check.

### Pure unit tests

- Capability selection for TTY, non-TTY, JSON, `NO_COLOR`, `TERM=dumb`, and explicit no-color.
- Theme output with and without ANSI.
- Recommendation, list, add, sync, play, empty-state, and error formatting.
- Width-aware wrapping with copyable IDs, URLs, and commands.
- Domain-to-error mapping for every known MeloPulse error code and representative Zod issues.

### CLI integration tests

- Root and subcommand help examples.
- `--version` and `--no-color`.
- Every command in human, plain, and JSON modes where supported.
- New `list` filtering and empty state.
- First-time and duplicate add output using the same truthful `Saved playlist` confirmation.
- Sync progress only on eligible stderr.
- JSON errors on stderr with empty stdout.
- Exit codes for help, validation, domain failures, and unknown failures.
- No ANSI or cursor-control sequences in non-TTY, JSON, and `NO_COLOR` output.

### MCP tests

- Exactly four tools.
- Descriptions and annotations match local/network behavior.
- Success text and `structuredContent` agree.
- Known errors include code, message, suggestion, and retryability.
- Unknown errors expose no stack or local path.
- Recommend, add, and list cannot reach the network.
- Packed stdio server emits no non-protocol stdout.

### Domain and persistence regression

- Deterministic recommendation ordering and fallback.
- Git context inside a repository, outside a repository, with Git disabled, and with bounded command failures.
- Provider recognition for MeloLab, Spotify, Apple Music, YouTube Music, and generic HTTPS URLs.
- Duplicate add behavior.
- Catalogue precedence.
- Missing and malformed catalogue files.
- Atomic writes and cache preservation on sync failure.
- Live relative MeloLab cover normalization and unsafe URL rejection.

### End-to-end local acceptance

- Fresh `npm ci`.
- Typecheck, lint, tests, and declaration build.
- Installed-tarball CLI smoke for help, recommend, list, add, and JSON errors.
- Installed-tarball MCP list/call/error smoke.
- Isolated real MeloLab sync using an OS-temp configuration directory with verified cleanup.
- Manual URL handoff check.
- Secret scan and package-content audit.
- Clean-source pack with `dist` absent.
- TypeScript consumer compile against the installed tarball.
- Node 20 and current Node validation when the local environment can provide both runtimes.
- Repeated cold full-suite runs to detect timing flakes and leaked processes or temp files.

## Acceptance Criteria

The UX polish is complete when all of the following are true:

1. A new user can run `melopulse --help`, `melopulse recommend`, and the shown `play` command without consulting external documentation.
2. A returning user can run `melopulse list`, filter by source, and copy a valid playlist ID.
3. TTY output is readable and guided while redirected, JSON, CI, and MCP output remain stable and decoration-free.
4. Every expected error provides a safe message and a concrete next action.
5. MCP retains exactly four tools with accurate descriptions, annotations, success schemas, and actionable errors.
6. No new implicit network access, telemetry, source upload, player control, or background process exists.
7. All unit, integration, MCP, persistence, packaging, runtime, live-sync, and cleanup acceptance checks pass locally.
8. The final branch receives independent code review before push.

## Non-Goals

- No TUI or full-screen terminal application.
- No web or desktop UI.
- No playlist track browser.
- No provider OAuth or metadata import.
- No direct playback controls.
- No music generation.
- No personalization profile or telemetry.
- No background repository monitoring or automatic sync.
- No npm publication as part of this work.
- No workaround for the GitHub account billing lock; CI is rerun only after the account can start jobs.
