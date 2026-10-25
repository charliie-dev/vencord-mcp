# vencord-mcp

vencord-mcp is a Vencord user plugin for Vesktop. The plugin adds an MCP endpoint to Discord. With
this endpoint, an AI agent can read and send Discord messages with your account. You control the
tasks that the agent can do.

> [!WARNING]
> Use vencord-mcp only for your account, on your computer. Changes to the Discord client, such as
> Vencord, are against the Discord Terms of Service. If an agent sends messages with your account,
> the risk to the account increases.

```text
MCP client (for example, Claude Code)
  └─ http://127.0.0.1:7890/mcp   bearer token, MCP version 2026-07-28
       └─ native.ts   Vesktop main process: the MCP endpoint
            └─ index.tsx   Discord page: Discord calls with your session
```

## Functions

- The endpoint listens only on `127.0.0.1`. Each request must have the bearer token.
- The default access is read-only. To let the agent send, change or remove data, set
  `readonlyMode` to off.
- You can limit the agent to some servers. Direct messages are off by default.
- The agent can show active threads and archived threads. It can read a thread page by page.
- There are 29 tools. Each tool has MCP hints (read-only, destructive). Refer to
  [docs/mcp.md](docs/mcp.md).
- The plugin uses the Discord session of Vesktop. It does not read or keep your Discord token.

## First steps (macOS)

You must have [Vesktop](https://github.com/Vencord/Vesktop), Git and [mise](https://mise.jdx.dev/).

Vencord includes a user plugin only when you build Vencord from source. Thus you must get the
Vencord source, add the plugin and build Vencord. The `deploy` task does the last two steps.

```bash
# Get the Vencord source. Vesktop uses the Vencord build from this directory.
git clone https://github.com/Vendicated/Vencord.git ~/Work/Vencord
# Install nub. Then copy the plugin into Vencord and build Vencord.
mise install
mise run deploy
```

1. In Discord, open User Settings > Vesktop > Developer Options. Click Open Developer Settings.
2. In the Vencord Location section, click Change. Select the directory `~/Work/Vencord/dist`.
3. Stop Vesktop fully (Cmd+Q). Then start Vesktop again.
4. In Discord, open User Settings > Vencord > Plugins. Set MCPBridge to on.
5. Connect your MCP client to the endpoint. Refer to
   [docs/mcp.md](docs/mcp.md#connect-a-client).

| Document                                   | Contents                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| [docs/setup.md](docs/setup.md)             | How to install, the plugin settings, new versions and problems         |
| [docs/mcp.md](docs/mcp.md)                 | Agents: the client connection, access limits, tools, threads, protocol |
| [docs/security.md](docs/security.md)       | How vencord-mcp protects your account, and the location of each secret |
| [docs/development.md](docs/development.md) | Tools, tests, the source layout and how to add a tool                  |

## Development

```bash
nub run test      # the smoke test and the unit tests (Discord is not necessary)
mise run deploy   # copy the plugin into Vencord and build Vencord
```

## License

MIT

This plugin uses code from [sushi-dev55/discord-mcp](https://github.com/sushi-dev55/discord-mcp)
and [hazre/discord-mcp](https://github.com/hazre/discord-mcp).
