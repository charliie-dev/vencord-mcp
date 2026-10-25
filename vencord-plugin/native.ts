/*
 * Vencord MCP Bridge — Discord main process side.
 * Owns the MCP endpoint on 127.0.0.1:7890, authenticates callers with the
 * shared token, and relays tool calls to the renderer plugin over IPC.
 */

import { randomBytes, timingSafeEqual } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";
import { createServer } from "http";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import type { IpcMainInvokeEvent } from "electron";
import { homedir } from "os";
import { dirname, join } from "path";

const LISTEN_HOST = "127.0.0.1";
const LISTEN_PORT = Number(process.env.DISCORD_MCP_PORT ?? 7890);
const TOKEN_PATH = process.env.DISCORD_MCP_TOKEN_FILE ?? join(homedir(), ".config", "discord-mcp", "token");
const CALL_TIMEOUT_MS = 15_000;
const WAITER_FRESH_MS = 15_000;
const MAX_BODY_BYTES = 1_000_000;
const PROTOCOL_VERSION = "2025-11-25";
const RETRY_INTERVAL_MS = 10_000;
const INSTRUCTIONS = "Controls the local Discord client through its Vencord plugin. Mutating tools respect the plugin's scope settings (allowedGuildIds, allowDMs, readonlyMode).";
const SESSION_ID = randomBytes(16).toString("hex");

export type ToolCall = { id: number; action: string; params: Record<string, any> };

function readToken(): string {
    try {
        return readFileSync(TOKEN_PATH, "utf8").trim();
    } catch {
        const token = randomBytes(32).toString("hex");
        mkdirSync(dirname(TOKEN_PATH), { recursive: true });
        writeFileSync(TOKEN_PATH, token + "\n", { mode: 0o600 });
        try { chmodSync(TOKEN_PATH, 0o600); } catch { }
        console.log(`[mcp] generated shared token at ${TOKEN_PATH}`);
        return token;
    }
}

const token = readToken();

const TOOLS = [
    {
        name: "list_guilds",
        description: "List all Discord servers (guilds) the user is in",
        inputSchema: { type: "object", properties: {}, additionalProperties: false }
    },
    {
        name: "get_guild_info",
        description: "Get detailed info about a specific guild",
        inputSchema: {
            type: "object",
            properties: { guild_id: { type: "string", description: "The guild/server ID" } },
            required: ["guild_id"],
            additionalProperties: false
        }
    },
    {
        name: "list_channels",
        description: "List all channels in a guild",
        inputSchema: {
            type: "object",
            properties: {
                guild_id: { type: "string", description: "The guild/server ID" },
                type: { type: "string", description: "Filter by type: text, voice, category, announcement, forum" }
            },
            required: ["guild_id"],
            additionalProperties: false
        }
    },
    {
        name: "get_channel_info",
        description: "Get detailed info about a specific channel",
        inputSchema: {
            type: "object",
            properties: { channel_id: { type: "string", description: "The channel ID" } },
            required: ["channel_id"],
            additionalProperties: false
        }
    },
    {
        name: "send_message",
        description: "Send a message to a Discord channel",
        inputSchema: {
            type: "object",
            properties: {
                channel_id: { type: "string", description: "The channel ID to send the message to" },
                content: { type: "string", description: "The message content" },
                tts: { type: "boolean", description: "Whether to send as text-to-speech" },
                reply_to: { type: "string", description: "Message ID to reply to" }
            },
            required: ["channel_id", "content"],
            additionalProperties: false
        }
    },
    {
        name: "edit_message",
        description: "Edit one of your own messages",
        inputSchema: {
            type: "object",
            properties: {
                channel_id: { type: "string", description: "The channel ID" },
                message_id: { type: "string", description: "The message ID to edit" },
                content: { type: "string", description: "The new message content" }
            },
            required: ["channel_id", "message_id", "content"],
            additionalProperties: false
        }
    },
    {
        name: "delete_message",
        description: "Delete a message",
        inputSchema: {
            type: "object",
            properties: {
                channel_id: { type: "string", description: "The channel ID" },
                message_id: { type: "string", description: "The message ID to delete" }
            },
            required: ["channel_id", "message_id"],
            additionalProperties: false
        }
    },
    {
        name: "read_messages",
        description: "Read recent messages from a channel",
        inputSchema: {
            type: "object",
            properties: {
                channel_id: { type: "string", description: "The channel ID to read from" },
                limit: { type: "number", description: "Number of messages to fetch (default 50, max 100)" }
            },
            required: ["channel_id"],
            additionalProperties: false
        }
    },
    {
        name: "search_messages",
        description: "Search messages in a guild or channel",
        inputSchema: {
            type: "object",
            properties: {
                guild_id: { type: "string", description: "Guild to search in" },
                channel_id: { type: "string", description: "Channel to search in (narrows guild search)" },
                query: { type: "string", description: "Search query text" },
                author_id: { type: "string", description: "Filter by author ID" },
                limit: { type: "number", description: "Max results (default 25)" }
            },
            required: ["query"],
            additionalProperties: false
        }
    },
    {
        name: "add_reaction",
        description: "Add a reaction to a message",
        inputSchema: {
            type: "object",
            properties: {
                channel_id: { type: "string", description: "The channel ID" },
                message_id: { type: "string", description: "The message ID" },
                emoji: { type: "string", description: "The emoji to react with (e.g. '👍' or 'custom_emoji:123456')" }
            },
            required: ["channel_id", "message_id", "emoji"],
            additionalProperties: false
        }
    },
    {
        name: "remove_reaction",
        description: "Remove your reaction from a message",
        inputSchema: {
            type: "object",
            properties: {
                channel_id: { type: "string", description: "The channel ID" },
                message_id: { type: "string", description: "The message ID" },
                emoji: { type: "string", description: "The emoji to remove" }
            },
            required: ["channel_id", "message_id", "emoji"],
            additionalProperties: false
        }
    },
    {
        name: "get_current_user",
        description: "Get info about the currently logged-in Discord user",
        inputSchema: { type: "object", properties: {}, additionalProperties: false }
    },
    {
        name: "get_user_info",
        description: "Get info about a specific user by ID",
        inputSchema: {
            type: "object",
            properties: { user_id: { type: "string", description: "The user ID" } },
            required: ["user_id"],
            additionalProperties: false
        }
    },
    {
        name: "list_guild_members",
        description: "List members of a guild (fetches from member list)",
        inputSchema: {
            type: "object",
            properties: {
                guild_id: { type: "string", description: "The guild ID" },
                limit: { type: "number", description: "Max members to return (default 100)" }
            },
            required: ["guild_id"],
            additionalProperties: false
        }
    },
    {
        name: "list_dms",
        description: "List all open DM conversations",
        inputSchema: { type: "object", properties: {}, additionalProperties: false }
    },
    {
        name: "send_dm",
        description: "Send a direct message to a user",
        inputSchema: {
            type: "object",
            properties: {
                user_id: { type: "string", description: "The user ID to DM" },
                content: { type: "string", description: "The message content" }
            },
            required: ["user_id", "content"],
            additionalProperties: false
        }
    },
    {
        name: "set_status",
        description: "Set user's custom status",
        inputSchema: {
            type: "object",
            properties: {
                text: { type: "string", description: "Custom status text" },
                emoji: { type: "string", description: "Status emoji" },
                status: { type: "string", description: "online, idle, dnd, or invisible" }
            },
            additionalProperties: false
        }
    },
    {
        name: "join_voice",
        description: "Join a voice channel",
        inputSchema: {
            type: "object",
            properties: {
                channel_id: { type: "string", description: "The voice channel ID to join" },
                guild_id: { type: "string", description: "The guild ID" },
                self_mute: { type: "boolean", description: "Join muted (default false)" },
                self_deaf: { type: "boolean", description: "Join deafened (default false)" }
            },
            required: ["channel_id", "guild_id"],
            additionalProperties: false
        }
    },
    {
        name: "leave_voice",
        description: "Leave the current voice channel",
        inputSchema: { type: "object", properties: {}, additionalProperties: false }
    },
    {
        name: "list_roles",
        description: "List all roles in a guild",
        inputSchema: {
            type: "object",
            properties: { guild_id: { type: "string", description: "The guild ID" } },
            required: ["guild_id"],
            additionalProperties: false
        }
    },
    {
        name: "create_channel",
        description: "Create a new channel in a guild",
        inputSchema: {
            type: "object",
            properties: {
                guild_id: { type: "string", description: "The guild ID" },
                name: { type: "string", description: "Channel name" },
                type: { type: "string", description: "Channel type: text (default), voice, category, announcement, forum" },
                parent_id: { type: "string", description: "Parent category ID" },
                topic: { type: "string", description: "Channel topic/description" }
            },
            required: ["guild_id", "name"],
            additionalProperties: false
        }
    },
    {
        name: "delete_channel",
        description: "Delete a channel",
        inputSchema: {
            type: "object",
            properties: { channel_id: { type: "string", description: "The channel ID to delete" } },
            required: ["channel_id"],
            additionalProperties: false
        }
    },
    {
        name: "create_thread",
        description: "Create a thread from a message or in a channel",
        inputSchema: {
            type: "object",
            properties: {
                channel_id: { type: "string", description: "The channel ID" },
                name: { type: "string", description: "Thread name" },
                message_id: { type: "string", description: "Message ID to start thread from (omit for forum/standalone thread)" },
                auto_archive_duration: { type: "number", description: "Auto archive in minutes: 60, 1440, 4320, 10080" }
            },
            required: ["channel_id", "name"],
            additionalProperties: false
        }
    },
    {
        name: "start_typing",
        description: "Show typing indicator in a channel",
        inputSchema: {
            type: "object",
            properties: { channel_id: { type: "string", description: "The channel ID" } },
            required: ["channel_id"],
            additionalProperties: false
        }
    },
    {
        name: "pin_message",
        description: "Pin a message in a channel",
        inputSchema: {
            type: "object",
            properties: {
                channel_id: { type: "string", description: "The channel ID" },
                message_id: { type: "string", description: "The message ID to pin" }
            },
            required: ["channel_id", "message_id"],
            additionalProperties: false
        }
    },
    {
        name: "unpin_message",
        description: "Unpin a message",
        inputSchema: {
            type: "object",
            properties: {
                channel_id: { type: "string", description: "The channel ID" },
                message_id: { type: "string", description: "The message ID to unpin" }
            },
            required: ["channel_id", "message_id"],
            additionalProperties: false
        }
    },
    {
        name: "set_nickname",
        description: "Set your nickname in a guild",
        inputSchema: {
            type: "object",
            properties: {
                guild_id: { type: "string", description: "The guild ID" },
                nickname: { type: "string", description: "The new nickname (empty string to reset)" }
            },
            required: ["guild_id", "nickname"],
            additionalProperties: false
        }
    },
    {
        name: "connection_status",
        description: "Check if the Vencord bridge plugin is connected",
        inputSchema: { type: "object", properties: {}, additionalProperties: false }
    }
];

const TOOL_NAMES = new Set(TOOLS.map(t => t.name));

// ── Renderer bridge ──────────────────────────────────────────────────────────

const queue: ToolCall[] = [];
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; action: string; params: Record<string, any>; }>();
let nextCallId = 0;
let waiter: { resolve: (call: ToolCall | null) => void; senderId: number; } | null = null;
let ownerSenderId: number | null = null;
let ownerLastSeen = 0;

function bridgeAlive(now = Date.now()): boolean {
    return waiter !== null || now - ownerLastSeen < WAITER_FRESH_MS;
}

function isPermissionError(message: string): boolean {
    return message.includes("not-allowed:");
}

function toCuratedPermissionError(action: string, params: Record<string, any>, rawMessage: string): string {
    const where = params?.channel_id || params?.guild_id || params?.user_id || "this scope";
    return `You are not allowed to do ${action} in ${where}. ${rawMessage} Check Vencord MCPBridge settings (allowedGuildIds, allowDMs, readonlyMode).`;
}

function dispatchCall(action: string, params: Record<string, any>): Promise<unknown> {
    if (!bridgeAlive()) {
        return Promise.reject(new Error("Vencord plugin not connected. Open Discord with the MCP Bridge plugin enabled."));
    }
    const id = ++nextCallId;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`Timeout waiting for plugin response (action: ${action})`));
        }, CALL_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer, action, params });
        if (waiter) {
            const w = waiter;
            waiter = null;
            w.resolve({ id, action, params });
        } else {
            queue.push({ id, action, params });
        }
    });
}

// The renderer long-polls this; the first client to poll holds the bridge.
export function poll(event: IpcMainInvokeEvent): Promise<ToolCall | null> | ToolCall {
    const senderId = event.sender.id;
    const now = Date.now();
    if (ownerSenderId === null || ownerSenderId === senderId) {
        ownerSenderId = senderId;
    } else if (bridgeAlive(now)) {
        throw new Error("bridge-busy: another Discord client holds the MCP bridge — disable the plugin there or close that client.");
    } else {
        console.log(`[mcp] renderer ${senderId} took the bridge from stale owner ${ownerSenderId}`);
        if (waiter) {
            waiter.resolve(null);
            waiter = null;
        }
        ownerSenderId = senderId;
    }
    ownerLastSeen = now;
    const call = queue.shift();
    if (call) return call;
    return new Promise<ToolCall | null>(resolve => {
        if (waiter) waiter.resolve(null);
        waiter = { resolve, senderId };
    });
}

export function complete(event: IpcMainInvokeEvent, id: number, result?: unknown, error?: string): void {
    if (ownerSenderId !== null && event.sender.id !== ownerSenderId) {
        throw new Error("bridge-busy: not the bridge owner");
    }
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    ownerLastSeen = Date.now();
    if (error) {
        entry.reject(new Error(isPermissionError(error) ? toCuratedPermissionError(entry.action, entry.params, error) : error));
    } else {
        entry.resolve(result === undefined ? "ok" : result);
    }
}

export function detach(event: IpcMainInvokeEvent): void {
    if (ownerSenderId !== null && event.sender.id !== ownerSenderId) return;
    ownerSenderId = null;
    if (waiter) {
        waiter.resolve(null);
        waiter = null;
    }
}

// ── MCP protocol ─────────────────────────────────────────────────────────────

function ok(text: unknown) {
    return { content: [{ type: "text", text: typeof text === "string" ? text : JSON.stringify(text, null, 2) }] };
}

function err(message: string) {
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

async function handleRpc(msg: any): Promise<object | null> {
    const { id, method, params } = msg ?? {};
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id, result });
    const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

    if (id === undefined && method !== "initialize") return null;

    switch (method) {
        case "initialize":
            return reply({
                protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : PROTOCOL_VERSION,
                capabilities: { tools: {} },
                serverInfo: { name: "discord-mcp", version: "2.0.0" },
                instructions: INSTRUCTIONS
            });
        case "ping":
            return reply({});
        case "notifications/initialized":
        case "notifications/cancelled":
            return null;
        case "tools/list":
            return reply({ tools: TOOLS });
        case "tools/call": {
            const name: string = params?.name;
            const args: Record<string, any> = params?.arguments ?? {};
            if (name === "connection_status") {
                return reply(bridgeAlive()
                    ? ok("Vencord bridge plugin is connected and ready.")
                    : err("Vencord bridge plugin is NOT connected. Make sure Discord is open with the MCPBridge plugin enabled."));
            }
            if (!TOOL_NAMES.has(name)) return fail(-32602, `Unknown tool: ${name}`);
            try {
                return reply(ok(await dispatchCall(name, args)));
            } catch (e: any) {
                return reply(err(e?.message ?? String(e)));
            }
        }
        default:
            return fail(-32601, `Method not found: ${method}`);
    }
}

// ── HTTP endpoint ────────────────────────────────────────────────────────────

function authorized(req: IncomingMessage): boolean {
    const header = req.headers.authorization;
    if (!token || typeof header !== "string" || !header.startsWith("Bearer ")) return false;
    const given = Buffer.from(header.slice(7));
    const expected = Buffer.from(token);
    return given.length === expected.length && timingSafeEqual(given, expected);
}

function send(res: ServerResponse, status: number, body?: unknown): void {
    if (body === undefined) {
        res.writeHead(status);
        res.end();
        return;
    }
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks: Buffer[] = [];
        req.on("data", chunk => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error("request body too large"));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = String(req.headers.host ?? "").toLowerCase();
    if (host !== `${LISTEN_HOST}:${LISTEN_PORT}` && host !== `localhost:${LISTEN_PORT}`) {
        return send(res, 403, { error: "forbidden host" });
    }
    if ((req.url ?? "").split("?")[0] !== "/mcp") {
        return send(res, 404, { error: "not found" });
    }
    if (req.method === "GET") {
        return send(res, 405, { error: "this server does not use the SSE stream" });
    }
    if (req.method === "DELETE") {
        return send(res, 204);
    }
    if (req.method !== "POST") {
        return send(res, 405, { error: "method not allowed" });
    }
    if (!authorized(req)) {
        return send(res, 401, { jsonrpc: "2.0", id: null, error: { code: -32001, message: "invalid or missing bearer token" } });
    }

    let body: string;
    try {
        body = await readBody(req);
    } catch (e: any) {
        return send(res, 413, { jsonrpc: "2.0", id: null, error: { code: -32600, message: e?.message ?? "bad request" } });
    }

    let msg: any;
    try {
        msg = JSON.parse(body);
    } catch {
        return send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
    if (msg === null || typeof msg !== "object" || Array.isArray(msg)) {
        return send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
    }

    const response = await handleRpc(msg);
    if (response === null) {
        return send(res, 202);
    }
    res.writeHead(200, { "content-type": "application/json", "mcp-session-id": SESSION_ID });
    res.end(JSON.stringify(response));
}

// First client to bind wins; later clients stay passive and retry until the
// holder exits, so a second Discord client can never kill the first one's endpoint.
let passive = false;

function startBridge(): void {
    const server = createServer((req, res) => { void handleRequest(req, res); });
    server.on("error", (e: any) => {
        try { server.close(); } catch { }
        if (e?.code === "EADDRINUSE") {
            if (!passive) {
                passive = true;
                console.log(`[mcp] ${LISTEN_HOST}:${LISTEN_PORT} is already held by another Discord client — staying passive`);
            }
        } else {
            console.error("[mcp] server error:", e?.message ?? e);
        }
        setTimeout(startBridge, RETRY_INTERVAL_MS);
    });
    server.listen(LISTEN_PORT, LISTEN_HOST, () => {
        passive = false;
        console.log(`[mcp] MCP endpoint listening on http://${LISTEN_HOST}:${LISTEN_PORT}/mcp`);
    });
    server.unref();
}

startBridge();
