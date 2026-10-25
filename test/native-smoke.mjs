/*
 * Protocol smoke test for vencord-plugin/native.ts.
 * Runs the native module standalone (no Electron) on a test port and exercises
 * the HTTP MCP surface (revision 2026-07-28) plus a full renderer round trip
 * through the bridge.
 * Requires Node >= 23.6 (type stripping); run with: npm test
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// A fixed port that something else holds would put native.ts in passive mode, and every
// request would then go to the other server.
const PORT = await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
        const { port } = probe.address();
        probe.close(() => resolve(port));
    });
});
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
    return rawExchange(headers, body).then(res => res.status);
}

// node:http, not fetch: it lets a test send any Host header, and it does not use the global
// timers that a test may mock.
function rawExchange(headers, body = "{}") {
    return new Promise((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: PORT, path: "/mcp", method: "POST", headers }, res => {
            const chunks = [];
            res.on("data", chunk => chunks.push(chunk));
            res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
        });
        req.on("error", reject);
        req.end(body);
    });
}

function rawRpc(method, params) {
    const headers = {
        host: `127.0.0.1:${PORT}`,
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        "mcp-protocol-version": VERSION,
        "mcp-method": method,
        ...(method === "tools/call" ? { "mcp-name": params.name } : {})
    };
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: meta() } });
    return rawExchange(headers, body).then(res => ({ status: res.status, json: JSON.parse(res.text) }));
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

test("every tool is annotated, and readOnlyHint matches the renderer's READ_ACTIONS", async () => {
    const { result } = await (await rpc("tools/list")).json();
    for (const tool of result.tools) {
        assert.equal(typeof tool.annotations?.readOnlyHint, "boolean", `${tool.name} has readOnlyHint`);
        if (!tool.annotations.readOnlyHint) {
            assert.equal(typeof tool.annotations.destructiveHint, "boolean", `${tool.name} has destructiveHint`);
        }
    }
    // READ_ACTIONS is what readonlyMode lets through; a hint that disagrees with it would
    // tell the client a blocked tool is safe, or a safe tool is blocked.
    const source = readFileSync(new URL("../vencord-plugin/index.tsx", import.meta.url), "utf8");
    const block = source.match(/const READ_ACTIONS = new Set\(\[([\s\S]*?)\]\)/);
    assert.ok(block, "READ_ACTIONS found in index.tsx");
    const readActions = [...block[1].matchAll(/"([a-z_]+)"/g)].map(m => m[1]).concat("connection_status").sort();
    const readOnly = result.tools.filter(t => t.annotations.readOnlyHint).map(t => t.name).sort();
    assert.deepEqual(readOnly, readActions);
    const destructive = result.tools.filter(t => t.annotations.destructiveHint).map(t => t.name);
    assert.ok(destructive.includes("delete_channel") && destructive.includes("delete_message"));
    assert.ok(!destructive.includes("send_message"));
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

test("a call arriving while the renderer is busy after an idle period is queued, not refused", { timeout: 5000 }, async t => {
    // Observed live: after >15 s idle, two parallel tool calls -> the first reached the renderer,
    // the second failed with "not connected" because the renderer was no longer waiting and its
    // last poll was stale.
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const polled = native.poll(fakeEvent(1));
    t.mock.timers.tick(20_000);

    const first = rpc("tools/call", { name: "list_guilds", arguments: {} });
    const call1 = await polled;
    const second = rpc("tools/call", { name: "list_roles", arguments: { guild_id: "1" } });
    await new Promise(resolve => setTimeout(resolve, 100));

    native.complete(fakeEvent(1), call1.id, []);
    // A queued call comes back synchronously; a Promise means the queue was empty, i.e. the
    // second call was refused instead of queued.
    const call2 = native.poll(fakeEvent(1));
    if (call2 instanceof Promise) native.detach(fakeEvent(1));
    assert.ok(!(call2 instanceof Promise), "second call was queued for the renderer");
    assert.equal(call2.action, "list_roles");
    native.complete(fakeEvent(1), call2.id, []);

    for (const res of [await first, await second]) {
        const { result } = await res.json();
        assert.equal(result.isError, undefined, result.content?.[0]?.text);
    }
    native.detach(fakeEvent(1));
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

test("a call that times out in the queue never reaches the renderer", { timeout: 5000 }, async t => {
    // A recent poll keeps the bridge alive, but no renderer waits, so the call is queued.
    const polled = native.poll(fakeEvent(1));
    native.detach(fakeEvent(1));
    assert.equal(await polled, null);

    t.mock.timers.enable({ apis: ["setTimeout"] });
    let settled = false;
    const res = rawRpc("tools/call", { name: "send_message", arguments: { channel_id: "42", content: "hi" } })
        .finally(() => { settled = true; });
    while (!settled) {
        t.mock.timers.tick(15_000);
        await new Promise(resolve => setImmediate(resolve));
    }
    const { json } = await res;
    assert.match(json.result.content[0].text, /Timeout waiting for plugin response/);

    // Before the fix the renderer still got the call here and sent the message after the
    // client had seen the timeout.
    const next = native.poll(fakeEvent(1));
    native.detach(fakeEvent(1));
    assert.ok(next instanceof Promise, "the timed-out call was dropped from the queue");
    assert.equal(await next, null);
});

test("tool arguments are checked against the input schema before the renderer sees them", async () => {
    const cases = [
        [{ name: "get_guild_info", arguments: {} }, /'guild_id' is required/],
        [{ name: "get_guild_info", arguments: { guild_id: 1 } }, /'guild_id' must be a string/],
        [{ name: "list_guilds", arguments: { extra: "x" } }, /unknown argument 'extra'/],
    ];
    for (const [params, why] of cases) {
        const { result } = await (await rpc("tools/call", params)).json();
        assert.equal(result.isError, true);
        assert.match(result.content[0].text, why);
    }
    const notObject = await rpc("tools/call", { name: "list_guilds", arguments: ["x"] });
    assert.equal(notObject.status, 200);
    assert.equal((await notObject.json()).error.code, -32602);
});

// Writes the body in 64 KiB chunks with no Content-Length, so the server must count bytes.
function chunkedPost(totalBytes) {
    return new Promise((resolve, reject) => {
        const headers = { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "transfer-encoding": "chunked" };
        const req = request({ host: "127.0.0.1", port: PORT, path: "/mcp", method: "POST", headers }, res => {
            const chunks = [];
            res.on("data", chunk => chunks.push(chunk));
            res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
        });
        req.on("error", reject);
        const chunk = Buffer.alloc(65_536, "x");
        let sent = 0;
        const pump = () => {
            while (sent < totalBytes) {
                const piece = chunk.subarray(0, Math.min(chunk.length, totalBytes - sent));
                sent += piece.length;
                if (!req.write(piece)) return req.once("drain", pump);
            }
            req.end();
        };
        pump();
    });
}

test("an oversized body gets a 413 response, not a reset connection", async () => {
    const headers = { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
    // With and without Content-Length (node:http sends it for a body given to end()), the
    // server reads and discards the body, then answers.
    const declared = await rawExchange(headers, "x".repeat(1_000_001));
    assert.equal(declared.status, 413);
    assert.equal(JSON.parse(declared.text).error.code, -32600);
    const chunked = await chunkedPost(1_000_001);
    assert.equal(chunked.status, 413);
    assert.equal(JSON.parse(chunked.text).error.code, -32600);
});

test("a chunked body far over the limit has its connection cut", async () => {
    await assert.rejects(chunkedPost(4_000_001 + 65_536 * 4));
});

test("a null optional argument counts as not given; a null required one is missing", async () => {
    const { result } = await (await rpc("tools/call", { name: "get_guild_info", arguments: { guild_id: null } })).json();
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /'guild_id' is required/);

    const polled = native.poll(fakeEvent(1));
    const res = rpc("tools/call", { name: "read_messages", arguments: { channel_id: "1", before: null } });
    const call = await polled;
    assert.deepEqual(call.params, { channel_id: "1" }, "the renderer does not see the null argument");
    native.complete(fakeEvent(1), call.id, []);
    assert.equal((await (await res).json()).result.isError, undefined);
    native.detach(fakeEvent(1));
});

test("an error without a usable request id carries id null", async () => {
    const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
    const parse = await fetch(BASE, { method: "POST", headers, body: "{" });
    assert.equal(parse.status, 400);
    assert.deepEqual(await parse.json(), { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    const noMethod = await fetch(BASE, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 7 }) });
    assert.equal(noMethod.status, 400);
    assert.equal((await noMethod.json()).id, 7);
});

test("an empty token file gets a new token", () => {
    const emptyFile = join(dir, "empty-token");
    writeFileSync(emptyFile, "\n", { mode: 0o600 });
    const nativeUrl = new URL("../vencord-plugin/native.ts", import.meta.url).href;
    // Port 0: the child must not wait for a port that another test run holds.
    execFileSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(nativeUrl)})`], {
        env: { ...process.env, DISCORD_MCP_PORT: "0", DISCORD_MCP_TOKEN_FILE: emptyFile },
        stdio: "pipe",
        timeout: 10_000
    });
    assert.match(readFileSync(emptyFile, "utf8"), /^[0-9a-f]{64}\n$/);
});

test("an unreadable token file keeps the endpoint closed instead of aborting the module", () => {
    const notAFile = join(dir, "token-dir");
    mkdirSync(notAFile);
    const nativeUrl = new URL("../vencord-plugin/native.ts", import.meta.url).href;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(nativeUrl)}); console.log("module loaded")`], {
        env: { ...process.env, DISCORD_MCP_PORT: "0", DISCORD_MCP_TOKEN_FILE: notAFile },
        encoding: "utf8",
        timeout: 10_000
    });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /module loaded/);
    assert.match(child.stderr, /cannot read token file/);
    assert.match(child.stderr, /endpoint is not started/);
});

test("a stale owner loses the bridge, and only the owner can complete a call", { timeout: 5000 }, async t => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const polled = native.poll(fakeEvent(1));
    const res = rpc("tools/call", { name: "list_guilds", arguments: {} });
    const call = await polled;
    // Renderer 1 took the call and then went silent: no waiter and no poll for 20 s.
    t.mock.timers.tick(20_000);

    const takeover = native.poll(fakeEvent(2));
    assert.ok(takeover instanceof Promise, "renderer 2 now holds the bridge and waits");
    assert.throws(() => native.complete(fakeEvent(1), call.id, []), /not the bridge owner/);
    native.complete(fakeEvent(2), call.id, []);
    assert.equal((await (await res).json()).result.isError, undefined);
    native.detach(fakeEvent(2));
    assert.equal(await takeover, null);
});

after(() => {
    rmSync(dir, { recursive: true, force: true });
});
