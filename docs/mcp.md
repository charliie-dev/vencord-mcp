# Agent access (MCP)

The MCP endpoint is `http://127.0.0.1:7890/mcp`. The endpoint uses Streamable HTTP.

The endpoint accepts only MCP version 2026-07-28. Each request is independent: there is no
`initialize` handshake and no session. The endpoint rejects older clients with error `-32022`
(unsupported protocol version). Claude Code 2.1.310 uses version 2026-07-28 automatically.

The Discord page does the work: `native.ts` sends each call to the page. If the page is not
connected, the call fails with "Vencord plugin not connected", and nothing goes to Discord.

## Connect a client

Each request must have the header `Authorization: Bearer <token>`. At the first start, the plugin
makes the token. The file `~/.config/discord-mcp/token` (mode 0600) keeps the token.

To add vencord-mcp to Claude Code, use this command. The command reads the token file, so do this
step yourself.

```bash
claude mcp add --transport http -s user discord http://127.0.0.1:7890/mcp \
  --header "Authorization: Bearer $(cat ~/.config/discord-mcp/token)"
```

Claude Code keeps the header, with the token, in its configuration file. Keep that file private.

For a different client, use the same URL and header. The client must support MCP version
2026-07-28.

> [!IMPORTANT]
> Prevent agent access to the token file. For example, use a sandbox rule that denies read access
> to it. A program with the token can call each tool that the plugin settings permit.

## Scope

The Discord page checks each call against the plugin settings. For the settings, refer to
[setup.md](setup.md#plugin-settings).

| Setting               | Effect on the tools                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `readonlyMode`        | When on, only the read tools operate. All other tools fail with `not-allowed`            |
| `allowedGuildIds`     | When not empty, a call to a server that is not in the list fails                         |
| `allowDMs`            | When off, `list_dms`, `send_dm` and all calls to a DM channel fail                       |
| `respectDiscordPerms` | When on, a call without the necessary Discord permission fails before it goes to Discord |

If a channel is not in the client cache, the plugin gets the channel from the Discord API. Then it
finds the server of the channel. Archived threads are an example. If the plugin cannot find the
server, and the channel is not a DM, the call fails.

If a setting blocks a call, the result starts with "You are not allowed to do". The result also
gives the tool, the channel or server, and the cause.

## Tools

Each tool has MCP hints. A read-only tool does not change data. A destructive tool can delete or
replace data. An additive tool only adds data. The hints are for the client only: the plugin
settings control what operates.

| Tool                 | Hint        | Function                                                               |
| -------------------- | ----------- | ---------------------------------------------------------------------- |
| `list_guilds`        | read-only   | Lists your servers (only the servers in `allowedGuildIds`, if set)     |
| `get_guild_info`     | read-only   | Shows the data of one server                                           |
| `list_channels`      | read-only   | Lists the channels of a server. Threads are not in this list           |
| `get_channel_info`   | read-only   | Shows the data of one channel. For a thread, it also shows thread data |
| `list_threads`       | read-only   | Lists the threads of a channel. Refer to [Threads](#threads)           |
| `read_messages`      | read-only   | Reads the messages of a channel or a thread                            |
| `search_messages`    | read-only   | Searches a server with the Discord search. It cannot search DMs        |
| `list_dms`           | read-only   | Lists your DM channels                                                 |
| `get_current_user`   | read-only   | Shows your account data. It does not show your email address           |
| `get_user_info`      | read-only   | Shows the data of one user                                             |
| `list_guild_members` | read-only   | Lists the members of a server                                          |
| `list_roles`         | read-only   | Lists the roles of a server                                            |
| `connection_status`  | read-only   | Shows if the Discord page is connected                                 |
| `send_message`       | additive    | Sends a message to a channel or a thread. It can reply to a message    |
| `send_dm`            | additive    | Sends a direct message to a user                                       |
| `create_thread`      | additive    | Starts a thread from a message, or in a channel                        |
| `create_channel`     | additive    | Makes a channel in a server                                            |
| `add_reaction`       | additive    | Adds a reaction to a message                                           |
| `pin_message`        | additive    | Pins a message                                                         |
| `start_typing`       | additive    | Shows the typing indicator in a channel                                |
| `join_voice`         | additive    | Connects to a voice channel                                            |
| `edit_message`       | destructive | Replaces the text of one of your messages                              |
| `delete_message`     | destructive | Deletes a message                                                      |
| `remove_reaction`    | destructive | Removes your reaction from a message                                   |
| `unpin_message`      | destructive | Unpins a message                                                       |
| `delete_channel`     | destructive | Deletes a channel                                                      |
| `set_status`         | destructive | Sets your status and your custom status                                |
| `set_nickname`       | destructive | Sets your nickname in a server                                         |
| `leave_voice`        | destructive | Disconnects from the voice channel                                     |

No tool accepts a local file path. The plugin does not call the Discord endpoint that marks a
channel as read.

## Threads

In Discord, a thread is a channel. To read a thread, give its ID to `read_messages`.

To find threads:

- Use `list_threads` with the ID of the parent channel. A forum channel is also a parent channel.
- In the result of `read_messages`, a message that started a thread has a `thread` field.

`list_threads` has two modes:

| Mode                 | Source                  | Pages                                                                        |
| -------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| Active (the default) | The cache of the client | `limit` (default 50, maximum 100) and `offset`. The newest activity is first |
| `archived: true`     | The Discord API         | `limit` (2 to 100, default 50) and `before`. Public threads only             |

- The result of the active mode has `total` and `has_more`.
- The client gets the active threads that you did not join only after you open the channel in
  Discord. Before that, the list can be empty.
- For the next page of archived threads, set `before` to the oldest `archive_timestamp` in the
  result. Use the ISO 8601 format.

To read a long thread:

1. Call `read_messages` with the thread ID. The newest messages are first.
2. For the next page, set `before` to the ID of the oldest message in the result.
3. Do step 2 again until the result is empty.

`read_messages` accepts a maximum of one of `before`, `after` and `around`. Each message in the
result has these fields:

- `id`, `author` (`id`, `username`, `display_name`), `content`, `timestamp` and `edited_timestamp`.
- `attachments` (`filename`, `url` and `size`) and the number of `embeds`.
- `reactions` (`emoji` and `count`), `reply_to` (the ID only) and `pinned`.
- `thread` (`id`, `name` and `message_count`), if the message started a thread.

## Protocol

Each request is a POST with one JSON-RPC message. A request must have these items:

- The headers `MCP-Protocol-Version: 2026-07-28` and `Mcp-Method: <method>`.
- For `tools/call`, also the header `Mcp-Name: <tool>`. The value can use the Base64 form
  `=?base64?…?=`.
- In `params._meta`: `io.modelcontextprotocol/protocolVersion` and
  `io.modelcontextprotocol/clientCapabilities`.

The header values must agree with the body. The endpoint supports these methods:

- `server/discover` gives the supported versions, the capabilities and the instructions.
- `tools/list` gives the 29 tools with their hints.
- `tools/call` calls a tool. A call has a time limit of 15 seconds.

Each result has `resultType: "complete"` and the server name in `_meta`. A client can keep the
result of `server/discover` and of `tools/list` for 10 minutes (`ttlMs` 600000).

| HTTP status | JSON-RPC code | Cause                                                                |
| ----------- | ------------- | -------------------------------------------------------------------- |
| 400         | `-32020`      | A header is missing, is not correct, or does not agree with the body |
| 400         | `-32602`      | `_meta` does not have the two necessary fields                       |
| 400         | `-32022`      | The version is not 2026-07-28, or the method is `initialize`         |
| 404         | `-32601`      | The method is unknown. `ping` is an unknown method                   |
| 404         | `-32600`      | The path is not `/mcp`                                               |
| 200         | `-32602`      | The tool is unknown                                                  |
| 401         | `-32001`      | The bearer token is missing or not correct                           |
| 403         | `-32600`      | The request has an `Origin` header, or the `Host` is not correct     |
| 405         | `-32600`      | The HTTP method is not POST                                          |
| 413         | `-32600`      | The body is larger than 1,000,000 bytes                              |
| 202         | none          | The message is a notification. The endpoint does nothing             |

The `-32022` error has `data.supported` (the supported versions) and `data.requested`.

When a tool fails, the result has `isError: true`. A Discord API error has this form:
`HTTP <status>: <message> (code <code>)`.
