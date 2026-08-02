# Privacy

MeloPulse is local-first. Recommendations are computed from the bundled catalogue, local link imports, and any locally cached MeloLab catalogue.

## Local Git metadata

With Git context enabled (the default for `recommend`), MeloPulse runs these exact commands in the selected workspace:

```text
git rev-parse --show-toplevel
git branch --show-current
git log -1 --pretty=%s
git status --short
```

It uses the current branch name, latest commit subject, count of changed files, and top-level changed path areas to guide a recommendation. The commands have a 16 KiB output limit. Use `--no-git` with the CLI, or set `useGitContext: false` with MCP, to avoid reading this metadata.

## Local files

MeloPulse stores these JSON files in the platform configuration directory, or in the directory named by `MELOPULSE_CONFIG_DIR`:

- `playlists.json`: imported HTTPS playlist URLs and local title/tag choices.
- `melolab-catalog-cache.json`: the last catalogue returned by an explicit MeloLab sync.

## What never leaves your machine

MeloPulse never uploads source code, file contents, Git diffs, repository remotes, credentials, private URLs, audio, or player data. It has no account system, authentication, OAuth, telemetry, provider metadata lookup, background monitoring, or player-control API.

## Network boundary

Only an explicit MeloLab sync uses the network: `melopulse sync` or the `melopulse_sync_catalog` MCP tool requests MeloLab's public featured playlist catalogue. Importing links, listing playlists, recommending, reading Git context, and URL handoff are local operations. Opening a recommendation delegates its URL to your operating system; any later network activity is performed by the browser or music app you choose, not by MeloPulse.
