# MeloPulse

Local coding playlists for MCP agents.

```bash
npx @melolab/melopulse recommend
```

MeloPulse reads safe Git metadata locally, recommends from a local catalogue, and opens playlists in MeloLab or your music app. Recommendation does not upload code or require an account.

## What it does

MeloPulse is an offline-first playlist recommender for coding sessions. It includes a small local catalogue, lets you import HTTPS playlist links with local tags, and can explicitly synchronize MeloLab's public catalogue into a local cache. It returns playlist URLs; your browser or music app handles playback.

It does not generate music, store audio, authenticate users, use OAuth, control a player, monitor repositories in the background, send telemetry, or fetch provider metadata. The only network operation is an explicit `sync` request to MeloLab.

## Install and use

The package is not published until a separate release action occurs. Until then, run from a local checkout with `npm run build` and `node dist/cli/index.js <command>`.

Once published, use the CLI with `npx`:

```bash
npx -y @melolab/melopulse recommend --activity debugging
npx -y @melolab/melopulse recommend --no-git --json
```

### CLI commands

| Command | Purpose |
| --- | --- |
| `melopulse add <playlist-url>` | Import an HTTPS playlist link into the local catalogue. Use `--title`, `--activity`, `--mood`, `--energy`, `--focus`, and `--vocals` to set local tags. |
| `melopulse sync` | Explicitly download MeloLab's public featured catalogue and update the local cache. |
| `melopulse recommend` | Return up to three local recommendations. Git context is enabled by default; use `--no-git` to disable it. |
| `melopulse play <playlist-id>` | Hand a selected playlist URL to the operating system's default browser or registered music app. |
| `melopulse mcp` | Start the MCP server over standard input/output. |

`recommend` accepts `--activity`, `--mood`, `--energy`, `--focus`, `--vocals`, `--limit`, and `--json`. Recommendation uses the bundled catalogue, your local link imports, and any cached MeloLab sync; it does not query streaming providers.

## MCP tools

The MCP server exposes exactly four tools:

| Tool | Purpose |
| --- | --- |
| `melopulse_recommend` | Recommend from the local catalogue, optionally using safe Git context. |
| `melopulse_add_playlist` | Import and tag an HTTPS playlist link locally. |
| `melopulse_list_playlists` | List local catalogue entries, optionally filtered by source. |
| `melopulse_sync_catalog` | Explicitly synchronize MeloLab's public catalogue. |

See [MCP setup](docs/mcp.md) and copy the ready-made configurations in [examples](examples).

## Supported playlist links

MeloPulse accepts HTTPS links and recognizes MeloLab, Spotify, Apple Music, and YouTube Music links. Other HTTPS playlist links are stored as `generic`. Link import only saves the URL and your local tags; it does not retrieve provider metadata or audio.

## Local storage and privacy

The local catalogue is stored in the platform configuration directory, or in `MELOPULSE_CONFIG_DIR` when set. It contains `playlists.json` for local imports and `melolab-catalog-cache.json` for the last explicit MeloLab sync.

When Git context is enabled, MeloPulse reads only safe metadata from the chosen workspace. It never uploads repository contents, source code, file contents, remote URLs, credentials, or audio. Read the complete [privacy boundary](docs/privacy.md).

## MeloLab relationship

MeloPulse is a local recommender that can hand off a MeloLab playlist URL to your browser or app. MeloLab sync is opt-in and happens only when you run `melopulse sync` or call `melopulse_sync_catalog`; there is no background synchronization, account connection, OAuth, or provider integration.

## Development

```bash
npm ci
npm run verify
npm run smoke:pack
npm pack --dry-run
```

The packed-install smoke test builds an npm tarball, installs it in a temporary directory, runs `recommend --no-git --json`, verifies a recommendation is returned, and cleans up both locations.

## Contributing and security

Please read [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and [SECURITY.md](SECURITY.md) before participating.

## License

[MIT](LICENSE) © 2026 Tover0314
