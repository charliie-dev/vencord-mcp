# Setup

vencord-mcp operates in Vesktop, a Discord client with Vencord. The plugin has two parts:

- `native.ts` operates in the Vesktop main process. It is the MCP endpoint.
- `index.tsx` operates in the Discord page. It does the Discord calls.

The plugin is a Vencord user plugin. Vencord includes a user plugin only when you build Vencord
from source. Thus you must keep a Vencord source directory. Each time Vesktop starts, it uses the
Vencord build from this directory.

The tests of these steps used macOS, Vesktop 1.6.8 and Claude Code 2.1.310.

## How to install

You must have Git and [mise](https://mise.jdx.dev/). mise installs nub. nub installs the Node
version in `.node-version`.

1. Install Vesktop.

   ```bash
   brew install --cask vesktop
   ```

2. Get the Vencord source. The default directory is `~/Work/Vencord`. To use a different
   directory, set `VENCORD_DIR`.

   ```bash
   git clone https://github.com/Vendicated/Vencord.git ~/Work/Vencord
   ```

3. In this repo, install the tools.

   ```bash
   mise install
   ```

4. Copy the plugin into Vencord and build Vencord.

   ```bash
   mise run deploy
   ```

   The `deploy` task does these steps:
   - It copies `index.tsx` and `native.ts` into `$VENCORD_DIR/src/userplugins/MCPBridge`.
   - It installs the Vencord packages with `nub install --frozen-lockfile`.
   - It builds Vencord with `nub run build`. The build goes into `$VENCORD_DIR/dist`.

   nub reads the `pnpm-lock.yaml` file of Vencord and does not change it. Git ignores
   `src/userplugins`. Thus the Vencord directory stays the same as the upstream repo.

5. In Discord, open User Settings > Vesktop > Developer Options. Click Open Developer Settings.
6. In the Vencord Location section, click Change. Select the `dist` directory in `$VENCORD_DIR`.
7. Stop Vesktop fully (Cmd+Q). Then start Vesktop again.
8. Sign in to Discord in Vesktop.
9. In Discord, open User Settings > Vencord > Plugins. Set MCPBridge to on.

At the first start, `native.ts` makes the token file. Then connect your MCP client. Refer to
[mcp.md](mcp.md#connect-a-client).

During `deploy`, nub shows a warning about `gifenc`: the lockfile entry has no integrity field.
This entry is in the upstream Vencord lockfile. To remove the warning, you must change that
lockfile. This setup does not change it.

## Plugin settings

To change the settings, open User Settings > Vencord > Plugins > MCPBridge. The plugin reads the
settings again for each call. Thus a change has an effect on the next call.

The settings page shows a label for each setting. For example, the label of `allowDMs` is Allow
Direct Messages. This document uses the setting names.

| Setting               | Default | Function                                                                        |
| --------------------- | ------- | ------------------------------------------------------------------------------- |
| `readonlyMode`        | on      | Stops all tools that change data. Only the read tools operate                   |
| `allowedGuildIds`     | empty   | Server IDs, with commas between them. If empty, the agent can use all servers   |
| `allowDMs`            | off     | Lets the agent read direct messages and send them                               |
| `respectDiscordPerms` | on      | Before a call, examines your Discord permissions. The Discord API also examines |

For the effect of each setting on the tools, refer to [mcp.md](mcp.md#access-limits).

## Environment variables

| Variable                 | Default                       | Function                                                       |
| ------------------------ | ----------------------------- | -------------------------------------------------------------- |
| `VENCORD_DIR`            | `~/Work/Vencord`              | The Vencord source directory. `mise run deploy` uses it        |
| `DISCORD_MCP_PORT`       | `7890`                        | The port of the MCP endpoint                                   |
| `DISCORD_MCP_TOKEN_FILE` | `~/.config/discord-mcp/token` | The token file. If there is no token file, the plugin makes it |

`native.ts` reads `DISCORD_MCP_PORT` and `DISCORD_MCP_TOKEN_FILE` from the environment of the
Vesktop process. If you start Vesktop from the Dock, the variables of your shell do not apply.

## New versions

To change the plugin:

1. Change the code in `vencord-plugin/`.
2. Do the tests. Refer to [development.md](development.md#tests).
3. Copy the plugin into Vencord and build Vencord.

   ```bash
   mise run deploy
   ```

4. Stop Vesktop fully (Cmd+Q). Then start Vesktop again.

A change to `native.ts` has an effect only after Vesktop starts again. For a change to `index.tsx`
only, a reload of the page (Cmd+R) is sufficient.

To get a new version of Vencord:

1. Get the new Vencord source.

   ```bash
   git -C ~/Work/Vencord pull
   ```

2. Do steps 3 and 4 of the procedure above.

## One endpoint, one page

- **Port:** The first Discord client that opens port 7890 gets the endpoint. A second client does
  not use the port. Each 10 seconds, it examines the port again. When the first client stops, the
  second client gets the endpoint.
- **Page:** In the client that has the endpoint, the first Discord page that connects does the
  calls. A second page gets the error `bridge-busy`.

## Problems

**The client cannot connect to the endpoint.**
Make sure that Vesktop is open and that MCPBridge is on. Then send this test request. You must do
this step, because the request contains the token.

```bash
curl -s http://127.0.0.1:7890/mcp \
  -H "Authorization: Bearer $(cat ~/.config/discord-mcp/token)" \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2026-07-28" -H "Mcp-Method: server/discover" \
  -d '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
```

The result must contain `"supportedVersions":["2026-07-28"]`.

**The endpoint sends 401.**
The token file changed. If you remove the token file, the plugin makes a new token at the next
start. Put the new token in the configuration of your client.

**A tool sends "Vencord plugin not connected".**
The Discord page has no connection to the endpoint. Make sure that MCPBridge is on. If the problem
continues, stop Vesktop fully and start it again.

**The Vesktop console shows `bridge-busy`.**
A second Discord page started a connection. Close the second window, or set MCPBridge to off in
the second client.

**The tools are not in the client.**
Connect the client to the server again. In Claude Code, use `/mcp`.
