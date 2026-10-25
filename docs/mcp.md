# Agent access (MCP)

The MCP endpoint is `http://127.0.0.1:7890/mcp`. The endpoint uses Streamable HTTP.

The endpoint accepts only MCP version 2026-07-28. The endpoint does each request independently:
there is no `initialize` handshake and no session. The endpoint rejects clients of earlier versions
with error `-32022` (`UnsupportedProtocolVersion`). Claude Code 2.1.310 uses version 2026-07-28
automatically.

The Discord page does the work: `native.ts` sends each call to the page. If the page has no
connection, the call stops with the error `Vencord plugin not connected`, and Discord gets no data.

## Connect a client

Each request must have the header `Authorization: Bearer <token>`. At the first start, the plugin
makes the token. The file `~/.config/discord-mcp/token` (mode 0600) keeps the token.

To add vencord-mcp to Claude Code, use this command. You must do this step, because the command
reads the token file.

```bash
claude mcp add --transport http -s user discord http://127.0.0.1:7890/mcp \
  --header "Authorization: Bearer $(cat ~/.config/discord-mcp/token)"
```

Claude Code keeps the header, with the token, in its configuration file. Do not let other persons
read that file.

For a different client, use the same URL and header. The client must use MCP version 2026-07-28.

> [!IMPORTANT]
> Prevent agent access to the token file. For example, use a sandbox rule that prevents read access
> to it. A program with the token can use each tool that the plugin settings let it use.

## Access limits

The Discord page examines each call with the plugin settings. For the settings, refer to
[setup.md](setup.md#plugin-settings).

| Setting               | Effect on the tools                                                                  |
| --------------------- | ------------------------------------------------------------------------------------ |
| `readonlyMode`        | When on, only the read tools operate. The other tools give the error `not-allowed`   |
| `allowedGuildIds`     | When not empty, a call to a server that is not in the list gives an error            |
| `allowDMs`            | When off, `list_dms`, `send_dm` and all calls to a DM channel give an error          |
| `respectDiscordPerms` | When on, a call without the necessary Discord permission gives an error at the start |

If a channel is not in the client cache, the plugin gets the channel from the Discord API. Then it
finds the server of the channel. Archived threads are an example. If the plugin cannot find the
server, and the channel is not a DM, the call stops with an error.

The plugin finds the server from the channel ID. For `join_voice` and `search_messages`, a server
ID from the agent cannot change the server that the plugin examines.

`respectDiscordPerms` does not apply to all calls. Discord does not need a permission to edit your
message or to remove your message. Thus the plugin does not examine permissions for `edit_message`.
For `delete_message`, the plugin examines `MANAGE_MESSAGES` only for a message from a different
person in the client cache. For other messages, the Discord API does the check. In a DM, the plugin
does not examine permissions: `allowDMs` controls DMs.

If a setting stops a call, the result starts with `You are not allowed to do`. The result also
gives the tool, the channel or server, and the cause.

## Tools

Each tool has MCP hints. A read-only tool does not change data. A destructive tool can remove or
replace data. An additive tool only adds data. The hints are for the client only. The plugin
settings control which tools operate.

| Tool                 | Hint        | Function                                                                      |
| -------------------- | ----------- | ----------------------------------------------------------------------------- |
| `list_guilds`        | read-only   | Shows your servers. If you set `allowedGuildIds`, it shows only those servers |
| `get_guild_info`     | read-only   | Shows the data of one server                                                  |
| `list_channels`      | read-only   | Shows the channels of a server. This result does not include threads          |
| `get_channel_info`   | read-only   | Shows the data of one channel. For a thread, it also shows the thread data    |
| `list_threads`       | read-only   | Shows the threads of a channel. Refer to [Threads](#threads)                  |
| `read_messages`      | read-only   | Reads the messages of a channel or a thread                                   |
| `search_messages`    | read-only   | Finds messages in a server or in one of its channels. Not for DMs             |
| `list_dms`           | read-only   | Shows your DM channels                                                        |
| `get_current_user`   | read-only   | Shows the data of your account. It does not show your email address           |
| `get_user_info`      | read-only   | Shows the data of one user                                                    |
| `list_guild_members` | read-only   | Shows the members of a server                                                 |
| `list_roles`         | read-only   | Shows the roles of a server                                                   |
| `connection_status`  | read-only   | Shows if the Discord page has a connection to the endpoint                    |
| `send_message`       | additive    | Sends a message to a channel or a thread. The message can reply to a message  |
| `send_dm`            | additive    | Sends a direct message to a user                                              |
| `create_thread`      | additive    | Starts a thread from a message, or in a channel                               |
| `create_channel`     | additive    | Makes a channel in a server                                                   |
| `add_reaction`       | additive    | Adds a reaction to a message                                                  |
| `pin_message`        | additive    | Pins a message                                                                |
| `start_typing`       | additive    | Shows the typing indicator in a channel                                       |
| `join_voice`         | additive    | Connects to a voice channel or a stage channel in a server                    |
| `edit_message`       | destructive | Replaces the text of one of your messages                                     |
| `delete_message`     | destructive | Removes a message                                                             |
| `remove_reaction`    | destructive | Removes your reaction from a message                                          |
| `unpin_message`      | destructive | Unpins a message                                                              |
| `delete_channel`     | destructive | Removes a channel                                                             |
| `set_status`         | destructive | Sets your status and your custom status                                       |
| `set_nickname`       | destructive | Sets your nickname in a server                                                |
| `leave_voice`        | destructive | Disconnects from the voice channel                                            |

No tool accepts a local file path. The plugin does not use the Discord endpoint that marks a channel
as read.

## Threads

In Discord, a thread is a channel. To read a thread, give its ID to `read_messages`.

To find threads:

- Use `list_threads` with the ID of the parent channel. A forum channel is also a parent channel.
- In the result of `read_messages`, a message that started a thread has a `thread` field.

`list_threads` has two modes:

| Mode                 | Source                  | Pages                                                            |
| -------------------- | ----------------------- | ---------------------------------------------------------------- |
| Active (the default) | The cache of the client | `limit` (default 50, maximum 100) and `offset`                   |
| `archived: true`     | The Discord API         | `limit` (2 to 100, default 50) and `before`. Only public threads |

- In the active mode, the thread with the newest message is first. The result has `total` and
  `has_more`.
- The client gets the active threads that you did not join only after you open the channel in
  Discord. Before that time, the result can be empty.
- For the next page of archived threads, set `before` to the `archive_timestamp` of the last thread
  in the result. Use the ISO 8601 format.

To read a long thread:

1. Use `read_messages` with the thread ID. The newest messages are first.
2. For the next page, set `before` to the ID of the last message in the result.
3. Do step 2 again until the result is empty.

`read_messages` accepts a maximum of one of `before`, `after` and `around`. Each message in the
result has these fields:

- `id`, `author` (`id`, `username`, `display_name`), `content`, `timestamp` and `edited_timestamp`.
- `attachments` (`filename`, `url` and `size`) and the number of `embeds`.
- `reactions` (`emoji` and `count`), `reply_to` (only the ID) and `pinned`.
- `thread` (`id`, `name` and `message_count`), if the message started a thread.

## Protocol

Each request is a POST with one JSON-RPC message. A request must have these items:

- The headers `MCP-Protocol-Version: 2026-07-28` and `Mcp-Method: <method>`.
- For `tools/call`, also the header `Mcp-Name: <tool>`. The value can use the Base64 format
  `=?base64?…?=`.
- In `params._meta`: `io.modelcontextprotocol/protocolVersion` and
  `io.modelcontextprotocol/clientCapabilities`.

The header values must agree with the body. The endpoint has these methods:

- `server/discover` gives the versions, the capabilities and the instructions of the endpoint.
- `tools/list` gives the 29 tools with their hints.
- `tools/call` does a tool call. A call has a time limit of 15 seconds.

Each result has `resultType: "complete"` and the server name in `_meta`. A client can keep the
result of `server/discover` and of `tools/list` for 10 minutes (`ttlMs` 600000).

| HTTP status | JSON-RPC code | Cause                                                                   |
| ----------- | ------------- | ----------------------------------------------------------------------- |
| 400         | `-32020`      | A header is missing, is not correct, or does not agree with the body    |
| 400         | `-32602`      | `_meta` does not have the two necessary fields                          |
| 400         | `-32022`      | The version is not 2026-07-28, or the method is `initialize`            |
| 400         | `-32700`      | The body is not JSON                                                    |
| 400         | `-32600`      | The body is not a JSON-RPC request                                      |
| 404         | `-32601`      | The method is unknown. `ping` is an unknown method                      |
| 404         | `-32600`      | The path is not `/mcp`                                                  |
| 200         | `-32602`      | The tool is unknown, or `arguments` is not an object                    |
| 401         | `-32001`      | The bearer token is missing or not correct                              |
| 403         | `-32600`      | The request has an `Origin` header, or the `Host` header is not correct |
| 405         | `-32600`      | The HTTP method is not POST                                             |
| 413         | `-32600`      | The body has more than 1,000,000 bytes                                  |
| 202         | none          | The message is a notification. The endpoint does not use it             |

The `-32022` error has `data.supported` (the versions of the endpoint) and `data.requested`. If
the endpoint cannot find the request ID, the error has `id: null`.

The endpoint examines the tool arguments with the input schema of the tool. A necessary argument
must be present, each argument must have the correct type, and other arguments are not permitted.
An optional argument with the value `null` is the same as no argument. If an argument is not
correct, the result has `isError: true`, and the Discord page does not get the call.

If the body has more than 4,000,000 bytes, the endpoint does not send 413. It closes the
connection.

If a tool cannot complete the call, the result has `isError: true`. The text of a Discord API error
is `HTTP <status>: <message> (code <code>)`.

If a call gets no result in 15 seconds, the result is a timeout error. If the Discord page did not
start the call, the endpoint removes it, and Discord does not do it. If the page started the call,
the call can complete after the timeout. Thus, before you send a message again, read the channel.
