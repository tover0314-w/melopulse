# MCP setup and tool guidance

MeloPulse is a local stdio MCP server. It exposes exactly four tools: `melopulse_recommend`, `melopulse_add_playlist`, `melopulse_list_playlists`, and `melopulse_sync_catalog`.

The npm package is **not yet published**; publication will occur only in a separate release action. After publication, configure a client to run:

```text
npx -y @melolab/melopulse mcp
```

```json
{
  "mcpServers": {
    "melopulse": {
      "command": "npx",
      "args": ["-y", "@melolab/melopulse", "mcp"]
    }
  }
}
```

For a local checkout, build first and configure the exact built entry point:

```bash
npm run build
```

```json
{
  "mcpServers": {
    "melopulse": {
      "command": "node",
      "args": ["/absolute/path/to/melopulse/dist/cli/index.js", "mcp"]
    }
  }
}
```

Claude Desktop and Cursor configuration examples are in [`examples/`](../examples/). Keep MCP on standard input/output; do not expose it as a network service.

## Select the right tool

| Tool | Use it when | Network behavior | Annotations |
| --- | --- | --- | --- |
| `melopulse_recommend` | You need up to five ranked local playlists for an activity, mood, energy, focus, vocals, or workspace. Set `useGitContext: false` to avoid reading safe local Git metadata. | Local only. | Read-only, idempotent, closed-world. |
| `melopulse_add_playlist` | You have an HTTPS playlist link to save locally with optional title and tags. Repeating the same normalized link updates the same local record. | Local only; no provider metadata lookup. | Non-destructive, idempotent, closed-world. |
| `melopulse_list_playlists` | You need the current local catalogue or a provider-filtered list. | Local only. | Read-only, idempotent, closed-world. |
| `melopulse_sync_catalog` | You explicitly want to refresh MeloLab's public featured catalogue. | The only network tool; contacts MeloLab only. | Non-destructive, idempotent, open-world. |

All tools report `destructiveHint: false` and `idempotentHint: true`. `melopulse_recommend` and `melopulse_list_playlists` report `readOnlyHint: true`; adding and syncing report `readOnlyHint: false`. `openWorldHint` is `true` only for sync because it makes the external MeloLab request.

## Inputs and results

`melopulse_recommend` accepts optional `activity`, `mood`, `energy`, `focus`, `vocals`, `workspacePath`, `useGitContext`, and `limit` (1–5). It returns local recommendations containing the playlist's ID, source, title, URL, reason, and a ready-to-run `playCommand`.

`melopulse_add_playlist` accepts an HTTPS `url` plus optional `title`, `activityTags`, `moodTags`, `energy`, `focus`, and `vocals`. Spotify, Apple Music, and YouTube Music links are recognized locally; other HTTPS links are `generic`. It returns the saved playlist record.

`melopulse_list_playlists` accepts an optional `source` of `melolab`, `spotify`, `apple_music`, `youtube_music`, or `generic`, and returns matching local playlist records.

`melopulse_sync_catalog` has no inputs and returns the number of public MeloLab playlists synced plus the locally cached playlist records.

## Recover from errors

Known tool errors return `isError: true`. Both the text content and `structuredContent` contain the same safe JSON object:

```json
{
  "error": {
    "code": "MELOLAB_SYNC_NETWORK_ERROR",
    "message": "Unable to retrieve the MeloLab catalogue.",
    "suggestion": "Check your connection and run melopulse sync again. Your previous cache is unchanged.",
    "retryable": true
  }
}
```

Use `suggestion` as the next action. A `retryable: true` sync error means to check the connection and try the explicit sync again; the prior local cache remains available. Invalid MCP input is not retryable until it is changed. Unknown failures are reduced to a safe internal error without a stack trace or local paths.

## Privacy and persistence

The MCP server reads and writes local catalogue files in the platform configuration directory, or the directory named by `MELOPULSE_CONFIG_DIR`. Recommendation can read safe Git metadata when `useGitContext` is enabled, but it never uploads code, file contents, diffs, remote URLs, credentials, or audio. The complete boundary is in [Privacy](privacy.md).
