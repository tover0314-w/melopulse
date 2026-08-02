# MeloPulse

Local coding playlists for people and MCP agents.

MeloPulse is offline-first: it recommends from a bundled catalogue, your local playlist imports, and any locally cached MeloLab catalogue. It never uploads code, audio, credentials, or playlist metadata. Only `melopulse sync` contacts MeloLab.

## Package availability

The npm package is **not yet published**. It will be published only through a separate release action. Until then, build a local checkout and run:

```bash
npm run build
node dist/cli/index.js recommend
```

The journey below uses the bare `melopulse` command. It assumes a global install after publication, or the built local-checkout entry point shown above. After publication, run the same command without a global install with `npx`:

```bash
npx -y @melolab/melopulse recommend --activity debugging
```

## Start a session

### 1. Recommend a playlist

```bash
melopulse recommend --activity debugging
```

MeloPulse may use safe local Git metadata to improve this suggestion. Use `--no-git` when you do not want it to read that metadata:

```bash
melopulse recommend --no-git --json
```

Human output uses durable labels so the next action is clear:

```text
MeloPulse recommendations
Context: local catalogue | Git context on | 3 requested | activity debugging

1. Focus Flow
Why: Matches your debugging session.
Fit: MeloLab | low energy | high focus | no vocals
URL: https://melolab.ai/playlist/launch-showcase-playlist-focus-flow
Play: melopulse play melolab:launch-showcase-playlist-focus-flow
```

### 2. Play a selected playlist

Copy the ID shown after `Play:` and hand the URL to your operating system:

```bash
melopulse play melolab:launch-showcase-playlist-focus-flow
```

```text
Opening in your default browser or music app:
https://melolab.ai/playlist/launch-showcase-playlist-focus-flow
```

MeloPulse does not control a player. Any subsequent network activity is performed by the browser or music app you choose, not by MeloPulse.

### 3. List your local catalogue

```bash
melopulse list
melopulse list --source spotify
melopulse list --json
```

The plain view starts with a `1 playlist` or `N playlists` heading, states the requested local/source context, and shows each playlist ID, title, normalized source, energy, focus, and URL. Source filters accept `melolab`, `spotify`, `apple_music`, `youtube_music`, and `generic`.

### 4. Add a playlist link

Import HTTPS playlist links and keep their title and tags locally:

```bash
melopulse add https://open.spotify.com/playlist/example --title "Deep Work" --activity deep_focus
```

```text
Saved playlist: Deep Work
Source: Spotify
ID: spotify:<local-id>
URL: https://open.spotify.com/playlist/example
Next: melopulse recommend
```

MeloPulse recognizes Spotify, Apple Music, and YouTube Music URLs; other HTTPS playlist URLs are saved as `generic`. For example:

```bash
melopulse add https://music.apple.com/us/playlist/example --title "Apple Focus"
melopulse add https://music.youtube.com/playlist?list=example --title "YouTube Focus"
melopulse add https://playlists.example.com/deep-work --title "Team Mix"
```

Imports save only the link and the tags you provide. MeloPulse does not fetch provider metadata, authenticate with providers, or transfer audio.

### 5. Sync MeloLab explicitly

```bash
melopulse sync
```

```text
Synced 6 public playlists from MeloLab.
Next: melopulse recommend
```

This is the only MeloPulse command that contacts the network, and it contacts MeloLab only. It updates the local cache; a failed sync keeps the previous cache.

### 6. Connect an MCP client

MeloPulse exposes four local MCP tools over standard input/output. See [MCP setup and tool guidance](docs/mcp.md) and the ready-made [client examples](examples/).

## CLI behavior

`melopulse --help` includes a quick start and the offline/network boundary. Every command supports `--help`; `melopulse --version` prints the installed version.

Use `--no-color` to disable terminal colors for a command, or set `NO_COLOR` in the environment to disable them everywhere. MeloPulse also uses stable plain output when output is redirected, in CI, or in a dumb terminal.

Commands that support `--json` produce exactly one JSON value followed by a newline on standard output. Expected command failures with `--json` produce exactly one safe JSON error object on standard error, leave standard output empty, and exit with status 1. JSON output never contains ANSI terminal controls.

```bash
melopulse recommend --no-git --json
melopulse add https://open.spotify.com/playlist/example --title "Deep Work" --json
melopulse play missing --json
```

The final command writes an error shaped like this to standard error:

```json
{
  "error": {
    "code": "PLAYLIST_NOT_FOUND",
    "message": "Playlist 'missing' was not found.",
    "suggestion": "Run melopulse list or melopulse recommend to choose a valid playlist ID.",
    "retryable": false
  }
}
```

## Local storage and privacy

The local catalogue is stored in the platform configuration directory, or in `MELOPULSE_CONFIG_DIR` when set. It contains `playlists.json` for imported links and `melolab-catalog-cache.json` for the most recent explicit sync.

With Git context enabled, MeloPulse reads safe repository metadata only. It never reads or uploads source-file contents, diffs, remote URLs, credentials, or audio. Read the complete [privacy boundary](docs/privacy.md).

## Development

```bash
npm ci
npm run verify
npm run smoke:pack
npm pack --dry-run
```

The packed-install smoke test creates a tarball, installs it in an isolated directory, checks help, version, local recommendation/import/listing, JSON error routing, and MCP tool behavior, then removes the tarball and temporary locations.

## Contributing and license

Read [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and [SECURITY.md](SECURITY.md) before participating.

[MIT](LICENSE) © 2026 Tover0314
