# Discord MCP Server

A full-featured [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that lets AI agents (Claude, etc.) interact with Discord — send messages, read channels, manage servers, join voice, and more.

The MCP endpoint is hosted **inside Discord** by the bridge plugin's native module. The plugin hooks into Discord's internal APIs, giving the endpoint full access to anything your Discord account can do. There is no separate server process: the endpoint lives and dies with Discord, and any number of MCP clients can attach to it.

```
AI Agent <--HTTP /mcp--> Discord main process (native.ts) <--IPC--> Vencord Plugin <--> Discord APIs
```

## Features

**28 tools** available to any MCP-compatible AI agent:

| Category | Tools |
|---|---|
| **Servers** | `list_guilds`, `get_guild_info` |
| **Channels** | `list_channels`, `get_channel_info`, `create_channel`, `delete_channel` |
| **Messages** | `send_message`, `edit_message`, `delete_message`, `read_messages`, `search_messages` |
| **DMs** | `list_dms`, `send_dm` |
| **Reactions** | `add_reaction`, `remove_reaction` |
| **Threads** | `create_thread` |
| **Users** | `get_current_user`, `get_user_info`, `list_guild_members` |
| **Voice** | `join_voice`, `leave_voice` |
| **Roles** | `list_roles` |
| **Status** | `set_status`, `set_nickname` |
| **Pins** | `pin_message`, `unpin_message` |
| **Utility** | `start_typing`, `connection_status` |

## Prerequisites

- [Git](https://git-scm.com), [Node.js](https://nodejs.org) v18+ and [pnpm](https://pnpm.io) (`npm i -g pnpm`) — to build Vencord
- Discord desktop app
- An MCP-compatible client (e.g. [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Claude Desktop](https://claude.ai/download), [OpenCode](https://opencode.ai))

## Installation

### 1. Clone this repo

```bash
git clone https://github.com/YOUR_USERNAME/discord-mcp.git
cd discord-mcp
```

### 2. Install the Vencord plugin

The plugin is **not** in Vencord's official plugin registry — it's a userplugin you build from source. Both files in `vencord-plugin/` are required: `index.tsx` runs in Discord's renderer, `native.ts` runs in its main process and hosts the MCP endpoint.

#### If you already have Vencord from source:

```bash
# Copy the plugin into your Vencord source tree
cp -r vencord-plugin /path/to/vencord/src/userplugins/MCPBridge
```

#### If you don't have Vencord yet:

```bash
# Clone Vencord
git clone https://github.com/Vendicated/Vencord.git
cd Vencord

# Install dependencies
pnpm install

# Copy the plugin
cp -r /path/to/discord-mcp/vencord-plugin src/userplugins/MCPBridge

# Build Vencord (includes your plugin)
pnpm build

# Inject into Discord
pnpm inject
```

> **Note:** `pnpm inject` will ask you to select your Discord installation. After injection, restart Discord.

#### If Vencord is already injected (just updating the plugin):

```bash
# Rebuild Vencord after adding/updating the plugin
cd /path/to/Vencord
pnpm build

# Copy the built files to Vencord's dist folder
# Windows:
copy dist\*.js %APPDATA%\Vencord\dist\

# macOS/Linux:
cp dist/*.js ~/.config/Vencord/dist/
```

Then restart Discord (fully quit and reopen — a renderer reload is not enough for native changes).

### 3. Enable the plugin in Discord

1. Open Discord
2. Go to **User Settings** (gear icon) > **Vencord** > **Plugins**
3. Search for **MCPBridge**
4. Toggle it **ON**
5. You should see `[MCPBridge] Plugin started` and `[mcp] MCP endpoint listening on http://127.0.0.1:7890/mcp` in the console (Ctrl+Shift+I)

The first start generates a shared bearer token at `~/.config/discord-mcp/token` (mode 0600). It is only printed as a path, never as a value.

### 4. Configure your MCP client

The endpoint is plain Streamable HTTP at `http://127.0.0.1:7890/mcp` and requires the token as a bearer header. Any MCP client with HTTP transport support works.

#### Claude Code

```bash
claude mcp add --transport http discord http://127.0.0.1:7890/mcp \
  --header "Authorization: Bearer $(cat ~/.config/discord-mcp/token)"
```

#### OpenCode

```jsonc
{
  "mcp": {
    "servers": {
      "discord": {
        "type": "remote",
        "url": "http://127.0.0.1:7890/mcp",
        "oauth": false,
        "headers": {
          "Authorization": "Bearer {file:/home/USER/.config/discord-mcp/token}"
        }
      }
    }
  }
}
```

`{file:...}` substitution embeds the token without hard-coding it; the path must be absolute (`~` is not expanded).

#### Any other client

```json
{
  "mcpServers": {
    "discord": {
      "type": "http",
      "url": "http://127.0.0.1:7890/mcp",
      "headers": {
        "Authorization": "Bearer <token from ~/.config/discord-mcp/token>"
      }
    }
  }
}
```

### 5. Verify it works

In your MCP client, check the `discord` server lists all tools. Then try:

> "Check the Discord connection status"

or

> "List my Discord servers"

## How It Works

```
                HTTP /mcp (JSON-RPC, bearer token)        IPC long-poll
MCP Client  <───────────────────────────────>  native.ts  <──────────────>  index.tsx
              (runs inside Discord's                     (main process)      (renderer process,
               main process)                                                 Discord APIs)
```

1. **native.ts** — Vencord native module in Discord's main process. Owns the HTTP MCP endpoint on `127.0.0.1:7890/mcp`, validates the bearer token, and implements the MCP handshake and tool surface.
2. **index.tsx** — Vencord plugin in Discord's renderer. Long-polls the native module over Vencord's plugin IPC, executes each tool call against Discord's internal webpack modules, and completes the request.
3. When an AI agent calls a tool (e.g. `send_message`), the native module queues the call, the renderer picks it up, calls the Discord API, and returns the result.

Because the endpoint is hosted by Discord itself, closing Discord makes it unavailable by design — open Discord (with MCPBridge enabled) and clients can reconnect. Multiple clients and multiple agent sessions share the one endpoint.

### Ownership and conflicts

- **One endpoint, first-wins.** The first Discord client whose native module binds port 7890 owns the endpoint. Another client (e.g. Vesktop while Canary is running) stays passive, logs `already held`, and retries every 10 seconds — it never kills the holder. When the holder exits, the next client takes over automatically.
- **One executor, first-wins.** Inside the owning client, the first renderer to poll holds the bridge; a second renderer is refused with `bridge-busy` until the holder detaches or goes stale.

## Project Structure

```
discord-mcp/
├── vencord-plugin/
│   ├── index.tsx       # Vencord plugin (renderer): tool execution
│   └── native.ts       # Vencord native module (main process): HTTP MCP endpoint
├── test/
│   └── native-smoke.mjs  # Protocol smoke test, runs without Discord
├── package.json
└── README.md
```

## Configuration

| Setting | Default | Description |
|---|---|---|
| Listen port | `7890` | `DISCORD_MCP_PORT` env var |
| Token file | `~/.config/discord-mcp/token` | `DISCORD_MCP_TOKEN_FILE` env var; generated on first start |
| Tool timeout | `15000` ms | `CALL_TIMEOUT_MS` in `vencord-plugin/native.ts` |
| Retry interval (passive client) | `10000` ms | `RETRY_INTERVAL_MS` in `vencord-plugin/native.ts` |

## Development

`native.ts` uses only Node builtins, so the whole protocol layer runs standalone — no Discord, no Electron:

```bash
npm test          # node --test test/native-smoke.mjs (needs Node >= 23.6 for type stripping)
```

The smoke test boots the native module on a test port and covers the handshake, tool catalog, bearer auth, host/path guards, renderer round trip, curated permission errors, and bridge ownership.

## Troubleshooting

### Endpoint not reachable

- Discord must be running with the **MCPBridge** plugin enabled — the endpoint is inside Discord.
- Check Discord console (Ctrl+Shift+I) for `[mcp]` logs.
- Verify from a shell: `curl -H "Authorization: Bearer $(cat ~/.config/discord-mcp/token)" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' http://127.0.0.1:7890/mcp`

### 401 invalid or missing bearer token

- The token file changed (it is regenerated if deleted) — update the client config, or re-read it via `{file:...}` substitution.
- Env overrides (`DISCORD_MCP_TOKEN_FILE`) must point at the same file for client and Discord.

### Another Discord client holds the endpoint

- Both clients log which one owns port 7890. The passive client takes over within ~10 seconds of the holder quitting; to hand it over manually, close the holding client or disable MCPBridge there.

### "bridge-busy" in Discord console

- A second renderer tried to poll while another one holds the bridge. Disable MCPBridge in the other client/window or close it.

### MCP tools not showing up

- Restart your MCP client after changing its config.
- Reconnect the server in your client (`/mcp` in Claude Code, `/mcps` in OpenCode's TUI).

## Security Considerations

- This runs with **your Discord account's full permissions** — the AI can do anything you can do.
- The endpoint listens on `127.0.0.1` only, validates its `Host` header against DNS rebinding, and requires the shared bearer token (file mode 0600) on every request.
- The plugin holds the real authority: scope (`allowedGuildIds`, `allowDMs`) and `readonlyMode` settings are enforced in the renderer, with the native module only mapping denials to friendly errors.
- Review tool calls before approving them, especially destructive actions like `delete_message` or `delete_channel`.
- No Discord token is stored or transmitted — calls go through Discord's own internal APIs via the plugin.

## License

MIT
