/*
 * Protocol smoke test for vencord-plugin/native.ts.
 * Runs the native module standalone (no Electron) on a test port and exercises
 * the HTTP MCP surface (revision 2026-07-28) plus a full renderer round trip
 * through the bridge.
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
const VERSION = "2026-07-28";

const dir = mkdtempSync(join(tmpdir(), "discord-mcp-smoke-"));
const tokenFile = join(dir, "token");
writeFileSync(tokenFile, TOKEN + "\n", { mode: 0o600 });

process.env.DISCORD_MCP_PORT = String(PORT);
process.env.DISCORD_MCP_TOKEN_FILE = tokenFile;

const native = await import("../vencord-plugin/native.ts");

const BASE = `http://127.0.0.1:${PORT}/mcp`;
const fakeEvent = senderId => ({ sender: { id: senderId } });

function meta(version = VERSION) {
    return {
        "io.modelcontextprotocol/protocolVersion": version,
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": { name: "smoke", version: "0" }
    };
}

// Sends a modern request with matching headers. `headers` overrides them; a null
// value removes the header. `body` replaces params wholesale when given.
function rpc(method, params = {}, { token = TOKEN, version = VERSION, headers = {}, body } = {}) {
    const merged = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": version,
        "mcp-method": method,
        ...(method === "tools/call" ? { "mcp-name": params.name } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers
    };
    for (const key of Object.keys(merged)) if (merged[key] === null) delete merged[key];
    return fetch(BASE, {
        method: "POST",
        headers: merged,
        body: JSON.stringify(body ?? { jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: meta(version) } })
    });
}

function rawPost(headers, body = "{}") {
    return new Promise((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: PORT, path: "/mcp", method: "POST", headers }, res => {
            res.resume();
            res.on("end", () => resolve(res.statusCode));
        });
        req.on("error", reject);
        req.end(body);
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

test("server/discover advertises the supported revision", async () => {
    const res = await rpc("server/discover");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("mcp-session-id"), null, "no session header in a stateless revision");
    const { result } = await res.json();
    assert.equal(result.resultType, "complete");
    assert.deepEqual(result.supportedVersions, [VERSION]);
    assert.ok(result.capabilities.tools, "advertises tools capability");
    assert.match(result.instructions, /untrusted/);
    assert.equal(typeof result.ttlMs, "number");
    assert.equal(result.cacheScope, "public");
    assert.equal(result._meta["io.modelcontextprotocol/serverInfo"].name, "discord-mcp");
});

test("tools/list exposes the full catalog as a cacheable result", async () => {
    const { result } = await (await rpc("tools/list")).json();
    assert.equal(result.resultType, "complete");
    assert.equal(typeof result.ttlMs, "number");
    assert.equal(result.cacheScope, "public");
    assert.equal(result.tools.length, 29);
    const names = result.tools.map(tool => tool.name);
    assert.ok(names.includes("connection_status"));
    assert.ok(names.includes("send_message"));
    assert.ok(names.includes("list_threads"));
    const read = result.tools.find(tool => tool.name === "read_messages");
    assert.ok(read.inputSchema.properties.before);
    for (const tool of result.tools) {
        assert.equal(tool.inputSchema.type, "object");
    }
});

test("legacy initialize is refused and names the supported revision", async () => {
    const res = await rpc("initialize", {}, {
        headers: { "mcp-protocol-version": null, "mcp-method": null },
        body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "legacy", version: "0" } } }
    });
    assert.equal(res.status, 400);
    const { error } = await res.json();
    assert.equal(error.code, -32022);
    assert.deepEqual(error.data.supported, [VERSION]);
    assert.equal(error.data.requested, "2025-11-25");
    assert.match(error.message, /2026-07-28/);
});

test("an unsupported version gets UnsupportedProtocolVersionError, not an echo", async () => {
    const res = await rpc("tools/list", {}, { version: "2025-11-25" });
    assert.equal(res.status, 400);
    const { error } = await res.json();
    assert.equal(error.code, -32022);
    assert.deepEqual(error.data, { supported: [VERSION], requested: "2025-11-25" });
});

test("headers must be present and match the body", async () => {
    const cases = [
        { headers: { "mcp-protocol-version": null }, why: /MCP-Protocol-Version header is missing/ },
        { headers: { "mcp-method": null }, why: /Mcp-Method header is missing/ },
        { headers: { "mcp-protocol-version": "2099-01-01" }, why: /does not match body value/ },
        { headers: { "mcp-method": "tools/call" }, why: /Mcp-Method header value/ }
    ];
    for (const { headers, why } of cases) {
        const res = await rpc("tools/list", {}, { headers });
        assert.equal(res.status, 400);
        const { error } = await res.json();
        assert.equal(error.code, -32020);
        assert.match(error.message, why);
    }

    const noName = await rpc("tools/call", { name: "connection_status", arguments: {} }, { headers: { "mcp-name": null } });
    assert.equal(noName.status, 400);
    assert.equal((await noName.json()).error.code, -32020);

    const wrongName = await rpc("tools/call", { name: "connection_status", arguments: {} }, { headers: { "mcp-name": "list_guilds" } });
    assert.equal(wrongName.status, 400);
    assert.match((await wrongName.json()).error.message, /Mcp-Name header value 'list_guilds'/);
});

test("a Base64-encoded Mcp-Name is decoded before comparison", async () => {
    const encoded = `=?base64?${Buffer.from("connection_status").toString("base64")}?=`;
    const res = await rpc("tools/call", { name: "connection_status", arguments: {} }, { headers: { "mcp-name": encoded } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).result.resultType, "complete");
});

test("a request without the required _meta fields is invalid params", async () => {
    const res = await rpc("tools/list", {}, { body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} } });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, -32602);
});

test("bearer token is enforced", async () => {
    assert.equal((await rpc("tools/list", {}, { token: null })).status, 401);
    assert.equal((await rpc("tools/list", {}, { token: "wrong-token" })).status, 401);
});

test("method, path, host and origin guards", async () => {
    const get = await fetch(BASE, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(get.status, 405);
    assert.equal(get.headers.get("allow"), "POST");
    const del = await fetch(BASE, { method: "DELETE", headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(del.status, 405, "no sessions to delete");

    const missing = await fetch(`http://127.0.0.1:${PORT}/nope`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: "{}" });
    assert.equal(missing.status, 404);

    const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
    assert.equal(await rawPost({ ...auth, host: "evil.example" }), 403);
    assert.equal(await rawPost({ ...auth, host: `127.0.0.1:${PORT}`, origin: "https://evil.example" }), 403);
});

test("a notification is accepted without a body", async () => {
    const res = await rpc("notifications/cancelled", {}, { body: { jsonrpc: "2.0", method: "notifications/cancelled" } });
    assert.equal(res.status, 202);
});

test("connection_status reflects a renderer that never polled", async () => {
    const { result } = await (await rpc("tools/call", { name: "connection_status", arguments: {} })).json();
    assert.equal(result.resultType, "complete");
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /NOT connected/);
});

test("tool call round trip through the renderer bridge", async () => {
    const polled = native.poll(fakeEvent(1));
    const resPromise = rpc("tools/call", { name: "list_guilds", arguments: {} });
    const call = await polled;
    assert.ok(call, "renderer received the call");
    assert.equal(call.action, "list_guilds");
    assert.equal(typeof call.id, "number");

    native.complete(fakeEvent(1), call.id, [{ id: "1", name: "Test Guild" }]);
    const { result } = await (await resPromise).json();
    assert.equal(result.resultType, "complete");
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /Test Guild/);

    const status = await (await rpc("tools/call", { name: "connection_status", arguments: {} })).json();
    assert.equal(status.result.isError, undefined);
});

test("permission errors are curated", async () => {
    const polled = native.poll(fakeEvent(1));
    const resPromise = rpc("tools/call", { name: "send_message", arguments: { channel_id: "42", content: "hi" } });
    const call = await polled;
    native.complete(fakeEvent(1), call.id, undefined, "not-allowed: send_message in guild 9: missing SEND_MESSAGES");
    const { result } = await (await resPromise).json();
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /You are not allowed to do send_message/);
    assert.match(result.content[0].text, /42/);
});

test("unknown tools and methods are protocol errors; ping is gone", async () => {
    const tool = await rpc("tools/call", { name: "no_such_tool", arguments: {} });
    assert.equal(tool.status, 200, "a 400 here would look like a legacy server to dual-era clients");
    assert.equal((await tool.json()).error.code, -32602);
    for (const method of ["no/such/method", "ping"]) {
        const res = await rpc(method);
        assert.equal(res.status, 404);
        assert.equal((await res.json()).error.code, -32601);
    }
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
