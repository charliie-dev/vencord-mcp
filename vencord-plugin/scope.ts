/*
 * Access rules of the MCP bridge: readonlyMode, the guild allowlist, the DM switch, and the
 * record that the Discord permission pre-flight checks. Pure functions with no webpack
 * imports, so test/scope.test.mjs loads this file under Node type stripping.
 * Every refusal starts with "not-allowed:"; native.ts turns those into the curated error.
 */

export type Scope = { readonlyMode: boolean; allowDMs: boolean; allowedGuilds: string[]; };

// The only actions that readonlyMode lets through. native.ts gives exactly these (plus
// connection_status) readOnlyHint: true; the smoke test checks that the two agree.
export const READ_ACTIONS = new Set([
    "list_guilds", "get_guild_info", "list_channels", "get_channel_info",
    "read_messages", "search_messages", "get_current_user", "get_user_info",
    "list_guild_members", "list_dms", "list_roles", "list_threads"
]);

export const THREAD_TYPES = new Set([10, 11, 12]);
const DM_TYPES = new Set([1, 3]);
const VOICE_TYPES = new Set([2, 13]);

export function parseAllowedGuilds(raw: string): string[] {
    return raw.split(",").map(s => s.trim()).filter(Boolean);
}

export function describeScope(scope: Scope): string {
    return scope.allowedGuilds.length ? scope.allowedGuilds.join(", ") : "all";
}

export function guildAllowed(guildId: string, scope: Scope): boolean {
    return !scope.allowedGuilds.length || scope.allowedGuilds.includes(guildId);
}

export function checkReadonly(action: string, scope: Scope): void {
    if (scope.readonlyMode && !READ_ACTIONS.has(action) && action !== "connection_status") {
        throw new Error(`not-allowed: ${action}: readonlyMode is on. Mutating actions are blocked.`);
    }
}

// A missing guild ID is an error, never a pass: skipping the check for it once let
// join_voice reach a server outside the allowlist.
export function requireGuildScope(guildId: string | undefined, action: string, scope: Scope): void {
    if (!guildId) throw new Error(`${action}: guild ID is missing`);
    if (!guildAllowed(guildId, scope)) {
        throw new Error(`not-allowed: ${action} in guild ${guildId}: not in allowed guilds. Allowed guilds: ${describeScope(scope)}`);
    }
}

// subject names the action and its target, for example "send_dm to 123".
export function requireDMs(subject: string, scope: Scope): void {
    if (!scope.allowDMs) {
        throw new Error(`not-allowed: ${subject}: DMs are not allowed. Allowed guilds: ${describeScope(scope)}`);
    }
}

// channel is the ChannelStore record or the REST object for channelId. A channel that is
// neither a DM nor in a known guild is refused: treating it as a DM or as "no guild" would
// put it outside both checks.
export function requireChannelScope(channel: any, channelId: string, action: string, scope: Scope): void {
    if (DM_TYPES.has(channel?.type)) return requireDMs(`${action} in DM ${channelId}`, scope);
    if (!channel?.guild_id) {
        throw new Error(`not-allowed: ${action} in ${channelId}: cannot determine its guild. Allowed guilds: ${describeScope(scope)}`);
    }
    requireGuildScope(channel.guild_id, action, scope);
}

// PermissionStore.can() needs a ChannelRecord. A thread fetched over REST is a plain object,
// so check its parent instead; with no record at all, leave the decision to the API (null).
export function permissionTarget(channel: any, getChannel: (id: string) => any): any {
    if (!channel) return null;
    const cached = getChannel(channel.id);
    if (cached) return cached;
    if (THREAD_TYPES.has(channel.type) && channel.parent_id) return getChannel(channel.parent_id) ?? null;
    return null;
}

// search_messages: a given channel decides the guild, so guild_id cannot point the search at
// a different server than the one whose scope was checked.
export function searchGuild(channel: any, channelId: string | undefined, guildId: string | undefined): string {
    if (channelId) {
        if (!channel?.guild_id) throw new Error("search_messages does not search DMs");
        if (guildId && guildId !== channel.guild_id) throw new Error(`Channel ${channelId} is not in guild ${guildId}`);
        return channel.guild_id;
    }
    if (!guildId) throw new Error("Need guild_id or channel_id");
    return guildId;
}

// join_voice: the guild comes from the channel, never from the caller. DM calls are out of scope.
export function voiceGuild(channel: any, channelId: string): string {
    if (!VOICE_TYPES.has(channel?.type) || !channel?.guild_id) {
        throw new Error(`Channel ${channelId} is not a voice or stage channel in a guild`);
    }
    return channel.guild_id;
}
