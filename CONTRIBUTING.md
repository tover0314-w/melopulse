# Contributing to MeloPulse

Thanks for improving MeloPulse. By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

Use Node.js 20 or newer, then run:

```bash
npm ci
npm run verify
npm run smoke:pack
```

Keep changes focused and add or update tests when behavior changes. For CLI and MCP changes, preserve MeloPulse's local-first privacy boundary: recommendations and playlist imports stay local, and MeloLab is contacted only by an explicit sync.

## Pull requests

Describe the user-visible change, include test evidence, and call out any privacy impact. Do not add telemetry, background monitoring, authentication, OAuth, music generation, provider metadata lookups, audio storage, or player control without an approved project direction.

## Reporting issues

Use the issue forms for reproducible bugs and well-scoped feature requests. Do not include credentials, private repository information, or other secrets. See [SECURITY.md](SECURITY.md) for vulnerability reporting.
