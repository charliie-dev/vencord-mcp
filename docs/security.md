# Protection

vencord-mcp is for one person on one computer. vencord-mcp gives this protection:

- Other web pages cannot use your Discord account through the endpoint.
- Local programs without the token cannot use your Discord account through the endpoint.
- An agent can do only the tasks that the plugin settings let it do.
- The repo does not contain secrets.

## Network

- The endpoint listens only on `127.0.0.1`, port 7890 by default.
- Each request must have the header `Host: 127.0.0.1:<port>` or `Host: localhost:<port>`. The
  endpoint rejects other hosts with 403. This prevents DNS rebinding attacks.
- The endpoint rejects each request that has an `Origin` header (403). Agents are not browsers.
- The endpoint accepts only POST requests to `/mcp`. The body can have a maximum of 1,000,000 bytes.
  If the body has more than 4,000,000 bytes, the endpoint closes the connection.

## Token and sign-in

- **MCP:** The endpoint uses a random bearer token (32 random bytes, in hex). The endpoint compares
  the token in constant time.
- **Discord:** You must sign in to Discord in Vesktop. The plugin does not sign in for you. The
  plugin does not read or keep your Discord token. It sends the Discord calls through the Discord
  client code in the page, with the session of Vesktop.

## Secrets

| Secret                   | Location                                  | Notes                                                     |
| ------------------------ | ----------------------------------------- | --------------------------------------------------------- |
| MCP bearer token         | `~/.config/discord-mcp/token` (0600)      | A program with the token can use the tools                |
| Copy of the bearer token | The configuration file of your MCP client | `claude mcp add --header` writes the token into this file |
| Discord session          | The data directory of Vesktop             | Vesktop keeps it. The plugin does not read it             |

The repo does not contain the token. The plugin makes the token at the first start.

## Limits for the agent

- `readonlyMode` is on by default. Then only the read tools operate.
- `allowedGuildIds` can limit the agent to some servers.
- `allowDMs` is off by default. Then the agent cannot read or send direct messages.
- The Discord page examines the settings for each call, before the call goes to Discord.
- If a channel is not in the client cache, the plugin gets the channel from the Discord API to
  find its server. If the plugin cannot find the server, the call stops with an error.
- If `respectDiscordPerms` is on, the plugin examines your Discord permissions before each call.
- The endpoint examines the tool arguments with the input schema of the tool. The Discord page
  gets only calls with correct arguments.
- Each ID must have only digits. Thus an ID cannot change the path of a Discord API call, for
  example to get to DMs when `allowDMs` is off. The endpoint and the Discord page both examine this.
- No tool accepts a local file path. An agent cannot send a file from your computer.
- The plugin does not use the Discord endpoint that marks a channel as read.

## Conditions

- **The settings are the control, not the hints.** The MCP hints (read-only, destructive) tell the
  client the type of each tool. A client can ignore the hints. `readonlyMode` and the access limits
  control which tools operate.
- **Message text can contain instructions.** Other persons write the messages, names and topics
  that the agent reads. The server instructions tell the agent to use this text only as data. This
  is only an instruction to the agent: the plugin does not mark the text. Before you set
  `readonlyMode` to off, limit the agent with `allowedGuildIds`.
- **An agent keeps the data that it read.** The plugin cannot remove data from the agent or from
  the client.
- **The client sends each call for you.** Use a client that is safe. Prevent agent access to the
  token file. For example, use a sandbox rule that prevents read access to it.
- **Discord can stop the account.** Changes to the Discord client are against the Discord Terms of
  Service. If an agent sends messages with your account, Discord can see this as a self-bot.
