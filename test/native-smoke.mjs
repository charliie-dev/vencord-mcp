/*
 * Protocol smoke test for vencord-plugin/native.ts.
 * Runs the native module standalone (no Electron) on a test port and exercises
 * the HTTP MCP surface plus a full renderer round trip through the bridge.
 * Requires Node >= 23.6 (type stripping); run with: npm test
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const PORT = 7912;
const TOKEN = "smoke-test-token";

const dir = mkdtempSync(join(tmpdir(), "discord-mcp-smoke-"));
const tokenFile = join(dir, "token");
writeFileSync(tokenFile, TOKEN + "\n", { mode: 0o600 });

process.env.DISCORD_MCP_PORT = String(PORT);
process.env.DISCORD_MCP_TOKEN_FILE = tokenFile;

const native = await import("../vencord-plugin/native.ts");

const BASE = `http://127.0.0.1:${PORT}/mcp`;
const fakeEvent = senderId => ({ sender: { id: senderId } });

function rpc(method, params, { token = TOKEN } = {}) {
    return fetch(BASE, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
    });
}

function notify(method, { token = TOKEN } = {}) {
    return fetch(BASE, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ jsonrpc: "2.0", method })
    });
}

async function waitForServer() {
    for (let i = 0; i < 50; i++) {
        try {
            await fetch(BASE);
            return;
        } catch {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    throw new Error("native bridge did not start listening");
}

await waitForServer();

test("initialize handshake and notification", async () => {
    const res = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("mcp-session-id"), "session id header present");
    const body = await res.json();
    assert.equal(body.result.protocolVersion, "2025-11-25");
    assert.equal(body.result.serverInfo.name, "discord-mcp");
    assert.ok(body.result.capabilities.tools, "advertises tools capability");

    const note = await notify("notifications/initialized");
    assert.equal(note.status, 202);

    const echoed = await rpc("notifications/initialized");
    assert.equal(echoed.status, 202);
});

test("tools/list exposes the full catalog", async () => {
    const body = await (await rpc("tools/list")).json();
    assert.equal(body.result.tools.length, 28);
    const names = body.result.tools.map(tool => tool.name);
    assert.ok(names.includes("connection_status"));
    assert.ok(names.includes("send_message"));
    for (const tool of body.result.tools) {
        assert.equal(tool.inputSchema.type, "object");
    }
});

test("bearer token is enforced", async () => {
    assert.equal((await rpc("tools/list", {}, { token: null })).status, 401);
    assert.equal((await rpc("tools/list", {}, { token: "wrong-token" })).status, 401);
});

test("stream, path and host guards", async () => {
    const get = await fetch(BASE, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(get.status, 405);

    const missing = await fetch(`http://127.0.0.1:${PORT}/nope`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: "{}" });
    assert.equal(missing.status, 404);

    const forbidden = await new Promise((resolve, reject) => {
        const req = request({
            host: "127.0.0.1",
            port: PORT,
            path: "/mcp",
            method: "POST",
            headers: { host: "evil.example", authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }
        }, res => {
            res.resume();
            res.on("end", () => resolve(res.statusCode));
        });
        req.on("error", reject);
        req.end("{}");
    });
    assert.equal(forbidden, 403);
});

test("connection_status reflects a renderer that never polled", async () => {
    const body = await (await rpc("tools/call", { name: "connection_status", arguments: {} })).json();
    assert.equal(body.result.isError, true);
    assert.match(body.result.content[0].text, /NOT connected/);
});

test("tool call round trip through the renderer bridge", async () => {
    const polled = native.poll(fakeEvent(1));
    const resPromise = rpc("tools/call", { name: "list_guilds", arguments: {} });
    const call = await polled;
    assert.ok(call, "renderer received the call");
    assert.equal(call.action, "list_guilds");
    assert.equal(typeof call.id, "number");

    native.complete(fakeEvent(1), call.id, [{ id: "1", name: "Test Guild" }]);
    const body = await (await resPromise).json();
    assert.equal(body.result.isError, undefined);
    assert.match(body.result.content[0].text, /Test Guild/);

    const status = await (await rpc("tools/call", { name: "connection_status", arguments: {} })).json();
    assert.equal(status.result.isError, undefined);
});

test("permission errors are curated", async () => {
    const polled = native.poll(fakeEvent(1));
    const resPromise = rpc("tools/call", { name: "send_message", arguments: { channel_id: "42", content: "hi" } });
    const call = await polled;
    native.complete(fakeEvent(1), call.id, undefined, "not-allowed: send_message in guild 9: missing SEND_MESSAGES");
    const body = await (await resPromise).json();
    assert.equal(body.result.isError, true);
    assert.match(body.result.content[0].text, /You are not allowed to do send_message/);
    assert.match(body.result.content[0].text, /42/);
});

test("unknown tool and unknown method are protocol errors", async () => {
    const tool = await (await rpc("tools/call", { name: "no_such_tool", arguments: {} })).json();
    assert.equal(tool.error.code, -32602);
    const method = await (await rpc("no/such/method")).json();
    assert.equal(method.error.code, -32601);
});

test("second renderer is refused while the owner is alive", async () => {
    const polled = native.poll(fakeEvent(1));
    assert.throws(() => native.poll(fakeEvent(2)), /bridge-busy/);
    native.detach(fakeEvent(1));
    assert.equal(await polled, null);
});

test("detach releases the polling renderer", async () => {
    const polled = native.poll(fakeEvent(1));
    native.detach(fakeEvent(1));
    assert.equal(await polled, null);
});

after(() => {
    rmSync(dir, { recursive: true, force: true });
});
