# Security model

vencord-mcp is for one owner on one computer. The design has these objectives:

- Other web pages cannot use your Discord account through the endpoint.
- Local programs without the token cannot use your Discord account through the endpoint.
- An agent can do only what the plugin settings permit.
- The repo does not contain secrets.

## Network

- The endpoint listens only on `127.0.0.1`, port 7890 by default.
- Each request must have `Host: 127.0.0.1:<port>` or `Host: localhost:<port>`. The endpoint
  rejects other hosts with 403. This prevents DNS rebinding attacks.
- The endpoint rejects each request with an `Origin` header (403). Agents are not browsers.
- The endpoint accepts only POST requests to `/mcp`. The body can have a maximum of 1,000,000 bytes.

## Authentication

- **MCP:** The endpoint uses a random bearer token (32 random bytes, in hex). The endpoint compares
  the token in constant time.
- **Discord:** You sign in to Discord in Vesktop yourself. The plugin does not sign in for you. The
  plugin does not read or keep your Discord token. It calls Discord through the Discord client code
  in the page, with the session of Vesktop.

## Secrets

| Secret                   | Location                                  | Notes                                                     |
| ------------------------ | ----------------------------------------- | --------------------------------------------------------- |
| MCP bearer token         | `~/.config/discord-mcp/token` (0600)      | A program with the token can call the tools               |
| Copy of the bearer token | The configuration file of your MCP client | `claude mcp add --header` writes the token into this file |
| Discord session          | The data directory of Vesktop             | Vesktop keeps it. The plugin does not read it             |

The repo does not contain the token. The plugin makes the token at the first start.

## Agent limits

- `readonlyMode` is on by default. Then only the read tools operate.
- `allowedGuildIds` can limit the agent to a list of servers.
- `allowDMs` is off by default. Then the agent cannot read or send direct messages.
- The Discord page checks the settings for each call, before the call goes to Discord.
- If a channel is not in the client cache, the plugin gets the channel from the Discord API to
  find its server. If the plugin cannot find the server, the call fails.
- With `respectDiscordPerms` on, the plugin checks your Discord permissions before each call.
- No tool accepts a local file path. An agent cannot send a file from your computer.
- The plugin does not call the Discord endpoint that marks a channel as read.

## Conditions of the design

- **The settings are the control, not the hints.** The MCP hints (read-only, destructive) tell the
  client what a tool does. A client can ignore them. `readonlyMode` and the scope settings control
  what operates.
- **Message text can contain instructions.** Other persons write the messages, names and topics
  that the agent reads. The server instructions tell the agent to treat this text as data, not as
  instructions. This is only an instruction to the agent: the plugin does not mark the text. Before
  you turn off `readonlyMode`, limit the agent with `allowedGuildIds`.
- **An agent keeps the data that it read.** The plugin cannot remove data from the agent or from
  the client.
- **The client sends each call in your name.** Use a client that you trust. Prevent agent access to
  the token file. For example, use a sandbox rule that denies read access to it.
- **Discord can act against the account.** Client modifications break the Discord terms of service.
  Messages that an agent sends with your account are self-bot activity.
