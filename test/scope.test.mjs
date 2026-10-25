/*
 * Unit tests for vencord-plugin/scope.ts: the access rules that index.tsx applies before a
 * call reaches Discord. scope.ts has no webpack imports, so Node loads it directly.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
    checkReadonly, describeScope, guildAllowed, parseAllowedGuilds, permissionTarget, READ_ACTIONS,
    requireChannelScope, requireDMs, requireGuildScope, searchGuild, voiceGuild
} from "../vencord-plugin/scope.ts";

const scope = (overrides = {}) => ({ readonlyMode: false, allowDMs: false, allowedGuilds: [], ...overrides });
// native.ts curates an error only when its message starts with this prefix.
const notAllowed = { message: /^not-allowed: / };

test("parseAllowedGuilds trims entries and drops empty ones", () => {
    assert.deepEqual(parseAllowedGuilds(""), []);
    assert.deepEqual(parseAllowedGuilds(" 1, 2 ,,3 "), ["1", "2", "3"]);
});

test("an empty allowlist allows every guild; a non-empty one only its members", () => {
    assert.equal(guildAllowed("9", scope()), true);
    assert.equal(describeScope(scope()), "all");
    const limited = scope({ allowedGuilds: ["1", "2"] });
    assert.equal(guildAllowed("1", limited), true);
    assert.equal(guildAllowed("9", limited), false);
    assert.equal(describeScope(limited), "1, 2");
});

test("readonlyMode blocks every action outside READ_ACTIONS", () => {
    const readonly = scope({ readonlyMode: true });
    for (const action of READ_ACTIONS) checkReadonly(action, readonly);
    checkReadonly("connection_status", readonly);
    for (const action of ["send_message", "delete_channel", "set_status", "join_voice", "no_such_action"]) {
        assert.throws(() => checkReadonly(action, readonly), notAllowed, action);
    }
    checkReadonly("send_message", scope());
});

test("requireGuildScope refuses a missing guild ID instead of skipping the check", () => {
    const limited = scope({ allowedGuilds: ["1"] });
    requireGuildScope("1", "list_roles", limited);
    assert.throws(() => requireGuildScope("2", "list_roles", limited), /not-allowed: list_roles in guild 2: not in allowed guilds/);
    for (const missing of [undefined, ""]) {
        assert.throws(() => requireGuildScope(missing, "list_roles", scope()), /guild ID is missing/);
    }
});

test("requireDMs follows allowDMs", () => {
    assert.throws(() => requireDMs("send_dm to 5", scope()), /not-allowed: send_dm to 5: DMs are not allowed/);
    requireDMs("send_dm to 5", scope({ allowDMs: true }));
});

test("requireChannelScope: DMs follow allowDMs, guild channels follow the allowlist", () => {
    const limited = scope({ allowedGuilds: ["1"] });
    for (const type of [1, 3]) {
        const dm = { id: "c", type };
        assert.throws(() => requireChannelScope(dm, "c", "read_messages", limited), /in DM c: DMs are not allowed/);
        requireChannelScope(dm, "c", "read_messages", scope({ allowDMs: true, allowedGuilds: ["1"] }));
    }
    requireChannelScope({ id: "c", type: 0, guild_id: "1" }, "c", "read_messages", limited);
    // A thread fetched over REST carries guild_id like any other guild channel.
    requireChannelScope({ id: "t", type: 11, guild_id: "1", parent_id: "c" }, "t", "read_messages", limited);
    assert.throws(() => requireChannelScope({ id: "c", type: 0, guild_id: "2" }, "c", "read_messages", limited), notAllowed);
});

test("a channel that is neither a DM nor in a known guild is refused, even with DMs allowed", () => {
    const open = scope({ allowDMs: true });
    for (const channel of [null, undefined, { id: "c", type: 0 }, { id: "c" }]) {
        assert.throws(() => requireChannelScope(channel, "c", "read_messages", open), /cannot determine its guild/);
    }
});

test("permissionTarget prefers the cached record, falls back to a thread's parent, else null", () => {
    const records = { c: { id: "c", record: true }, p: { id: "p", record: true } };
    const getChannel = id => records[id];
    assert.equal(permissionTarget({ id: "c" }, getChannel), records.c);
    assert.equal(permissionTarget({ id: "t", type: 11, parent_id: "p" }, getChannel), records.p);
    assert.equal(permissionTarget({ id: "t", type: 11, parent_id: "gone" }, getChannel), null);
    // Not a thread: a parent is no stand-in for the channel's own overwrites.
    assert.equal(permissionTarget({ id: "x", type: 0, parent_id: "p" }, getChannel), null);
    assert.equal(permissionTarget(null, getChannel), null);
});

test("permissionTarget skips DMs, even cached ones, so the pre-flight cannot refuse them", () => {
    const records = { d: { id: "d", type: 1 }, g: { id: "g", type: 3 } };
    const getChannel = id => records[id];
    assert.equal(permissionTarget({ id: "d", type: 1 }, getChannel), null);
    assert.equal(permissionTarget({ id: "g", type: 3 }, getChannel), null);
});

test("searchGuild lets a given channel decide the guild", () => {
    const channel = { id: "c", type: 0, guild_id: "1" };
    assert.equal(searchGuild(channel, "c", undefined), "1");
    assert.equal(searchGuild(channel, "c", "1"), "1");
    assert.throws(() => searchGuild(channel, "c", "2"), /Channel c is not in guild 2/);
    assert.throws(() => searchGuild({ id: "d", type: 1 }, "d", undefined), /does not search DMs/);
    assert.equal(searchGuild(null, undefined, "3"), "3");
    assert.throws(() => searchGuild(null, undefined, undefined), /Need guild_id or channel_id/);
});

test("voiceGuild accepts only voice and stage channels in a guild", () => {
    assert.equal(voiceGuild({ id: "v", type: 2, guild_id: "1" }, "v"), "1");
    assert.equal(voiceGuild({ id: "s", type: 13, guild_id: "1" }, "s"), "1");
    for (const channel of [{ id: "x", type: 0, guild_id: "1" }, { id: "x", type: 1 }, { id: "x", type: 2 }, null]) {
        assert.throws(() => voiceGuild(channel, "x"), /not a voice or stage channel in a guild/);
    }
});
