# Codex MCP configuration

Add this server to your Codex MCP configuration after MeloPulse is published:

```toml
[mcp_servers.melopulse]
command = "npx"
args = ["-y", "@melolab/melopulse", "mcp"]
```

For local verification after `npm run build`, use:

```toml
[mcp_servers.melopulse]
command = "node"
args = ["D:/ai-music/melopulse/dist/cli/index.js", "mcp"]
```
