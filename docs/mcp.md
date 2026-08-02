# MCP setup

MeloPulse serves exactly four local tools over MCP standard input/output: `melopulse_recommend`, `melopulse_add_playlist`, `melopulse_list_playlists`, and `melopulse_sync_catalog`.

The first three operate on local state. `melopulse_sync_catalog` is the sole MCP operation that contacts the network, and it only runs when explicitly called.

## Published package

After the package is published in a separate release action, configure an MCP client to run:

```text
npx -y @melolab/melopulse mcp
```

For clients that use JSON configuration:

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

Claude Desktop and Cursor examples are available in [`examples/`](../examples/).

## Local verification

Build the checkout first:

```powershell
npm run build
```

Then configure an MCP client to run this exact local command:

```text
node D:/ai-music/melopulse/dist/cli/index.js mcp
```

For example, a generic JSON MCP configuration can use:

```json
{
  "mcpServers": {
    "melopulse": {
      "command": "node",
      "args": ["D:/ai-music/melopulse/dist/cli/index.js", "mcp"]
    }
  }
}
```

MCP is a local stdio server; do not expose it as a network service. See [Privacy](privacy.md) for the Git and network boundary.
