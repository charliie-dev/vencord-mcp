# vencord-mcp

vencord-mcp is a Vencord user plugin for Vesktop. The plugin adds an MCP endpoint to Discord. With
this endpoint, an AI agent can read and send Discord messages with your account. You control what
the agent can do.

> [!WARNING]
> Use vencord-mcp only for your own account, on your own computer. Client modifications such as
> Vencord break the Discord terms of service. When an agent sends messages with your account, the
> risk to the account is higher.

```text
MCP client (for example, Claude Code)
  └─ http://127.0.0.1:7890/mcp   bearer token, MCP version 2026-07-28
       └─ native.ts   Vesktop main process: the MCP endpoint
            └─ index.tsx   Discord page: Discord calls with your session
```

## Features

- The endpoint listens only on `127.0.0.1`. Each request must have the bearer token.
- The default access is read-only. To let the agent send, edit or delete, turn off `readonlyMode`.
- You can limit the agent to a list of servers. Direct messages are off by default.
- The agent can list active and archived threads, and read a thread page by page.
- 29 tools, each with MCP hints (read-only, destructive). Refer to [docs/mcp.md](docs/mcp.md).
- The plugin uses the Discord session of Vesktop. It does not read or keep your Discord token.

## Quick start (macOS)

You must have [Vesktop](https://github.com/Vencord/Vesktop), Git and [mise](https://mise.jdx.dev/).

```bash
# Get the Vencord source. Vesktop loads the Vencord build from this directory.
git clone https://github.com/Vendicated/Vencord.git ~/Work/Vencord
# Install nub. Then copy the plugin into Vencord and build Vencord.
mise install
mise run deploy
```

1. In the Vesktop settings, set Vencord Location to `~/Work/Vencord/dist`. Quit Vesktop (Cmd+Q)
   and open it again.
2. In Discord, open User Settings > Vencord > Plugins. Turn on MCPBridge.
3. Add the endpoint to your MCP client. Refer to [docs/mcp.md](docs/mcp.md#connect-a-client).

| Document                                   | Contents                                                     |
| ------------------------------------------ | ------------------------------------------------------------ |
| [docs/setup.md](docs/setup.md)             | Install, plugin settings, updates and troubleshooting        |
| [docs/mcp.md](docs/mcp.md)                 | Agents: client setup, scope, tools, threads and the protocol |
| [docs/security.md](docs/security.md)       | The security model and the location of each secret           |
| [docs/development.md](docs/development.md) | Tools, tests, source layout and how to add a tool            |

## Development

```bash
nub run test      # the protocol smoke test (Discord is not necessary)
mise run deploy   # copy the plugin into Vencord and build Vencord
```

## License

MIT

Based on [sushi-dev55/discord-mcp](https://github.com/sushi-dev55/discord-mcp) and
[hazre/discord-mcp](https://github.com/hazre/discord-mcp).
