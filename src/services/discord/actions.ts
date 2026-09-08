import {
  Guild,
  GuildChannel,
  Role,
  TextChannel,
  VoiceChannel,
  CategoryChannel,
  ChannelType,
  PermissionFlagsBits,
  PermissionsBitField,
} from 'discord.js';
import { findRole, findChannel, findCategory } from './lookup';
import { validateAction, hasPrivilegedRole } from './permissionValidator';
import { DiscordAction } from './types';

/**
 * Runs a DiscordAction after validation and idempotent checks.
 * Returns a descriptive string about what happened.
 */
export async function runAction(guild: Guild, action: DiscordAction): Promise<string> {
  // Validate the action against privileged policies
  validateAction(guild, action);

  switch (action.type) {
    case 'createRole': {
      const { name, color = 0x000000, hoist = false } = action.payload;
      // Idempotent: skip if role already exists
      const existing = findRole(guild, name);
      if (existing) return `Role "${name}" already exists.`;
      await guild.roles.create({ name, color, hoist });
      return `Created role "${name}".`;
    }
    case 'createChannel': {
      const { name, type, category } = action.payload;
      const existing = findChannel(guild, name);
      if (existing) return `Channel "${name}" already exists.`;
      // Map simplified type string to Discord ChannelType enum
      let channelType: ChannelType;
      switch (type) {
        case 'GUILD_TEXT':
          channelType = ChannelType.GuildText;
          break;
        case 'GUILD_VOICE':
          channelType = ChannelType.GuildVoice;
          break;
        case 'GUILD_CATEGORY':
          channelType = ChannelType.GuildCategory;
          break;
        default:
          throw new Error(`Unsupported channel type: ${type}`);
      }

      let parentId: string | undefined = undefined;
      if (category) {
        const cat = findCategory(guild, category);
        if (!cat) {
          throw new Error(`Category "${category}" not found in server.`);
        }
        parentId = cat.id;
      }

      if (parentId) {
        await guild.channels.create({ name, type: channelType, parent: parentId });
        return `Created ${type.toLowerCase().replace('guild_', '')} channel "${name}" inside category "${category}".`;
      } else {
        await guild.channels.create({ name, type: channelType });
        return `Created ${type.toLowerCase().replace('guild_', '')} channel "${name}".`;
      }
    }
    case 'assignRole': {
      const { roleName, memberId } = action.payload;
      const role = findRole(guild, roleName);
      if (!role) throw new Error(`Role "${roleName}" not found for assignment.`);
      const member = await guild.members.fetch(memberId);
      if (member.roles.cache.has(role.id)) return `Member already has role "${roleName}".`;
      await member.roles.add(role);
      return `Assigned role "${roleName}" to member ${member.user.tag}.`;
    }
    case 'removeRole': {
      const { roleName, memberId } = action.payload;
      const role = findRole(guild, roleName);
      if (!role) throw new Error(`Role "${roleName}" not found for removal.`);
      const member = await guild.members.fetch(memberId);
      if (!member.roles.cache.has(role.id)) return `Member does not have role "${roleName}".`;
      await member.roles.remove(role);
      return `Removed role "${roleName}" from member ${member.user.tag}.`;
    }
    case 'applyPermissionTemplate': {
      const { targetName, permissionOverwrites } = action.payload;
      const cleanTargetName =
        typeof targetName === 'string' && targetName.startsWith('#')
          ? targetName.slice(1).trim()
          : (targetName?.trim() || '');

      const roleMatch = findRole(guild, cleanTargetName);
      const target = findChannel(guild, cleanTargetName) ?? findCategory(guild, cleanTargetName);

      if (roleMatch && !target) {
        throw new Error(
          `Target "${targetName}" resolves to a role instead of a channel or category. applyPermissionTemplate targetName must be an existing channel or category.`
        );
      }
      if (roleMatch && cleanTargetName.toLowerCase() === roleMatch.name.toLowerCase()) {
        throw new Error(
          `Target "${targetName}" resolves to a role instead of a channel or category. applyPermissionTemplate targetName must be an existing channel or category.`
        );
      }
      if (!target) throw new Error(`Target "${targetName}" not found for permission template.`);
      if (!Array.isArray(permissionOverwrites) || permissionOverwrites.length === 0) {
        throw new Error(`Action "applyPermissionTemplate" requires non-empty "permissionOverwrites".`);
      }

      // 1. Pre-validation and ID resolution before ANY Discord mutations
      const resolvedList: { id: string; name: string; allow: string[]; deny: string[] }[] = [];
      let everyoneDeniesView = false;
      const everyoneId = guild.roles.everyone?.id ?? guild.id;

      for (const ow of permissionOverwrites) {
        if (!ow.id || typeof ow.id !== 'string') {
          throw new Error('Permission overwrite requires an id string.');
        }

        // Validate forbidden permissions
        if (ow.allow && ow.allow.some((p: string) => normalizePermissionFlag(p) === 'Administrator')) {
          throw new Error('Permission template cannot grant Administrator permission.');
        }

        const resolved = resolveOverwriteTargetId(guild, ow.id);
        const allows = Array.isArray(ow.allow)
          ? ow.allow.map((p: string) => normalizePermissionFlag(p))
          : [];
        const denies = Array.isArray(ow.deny)
          ? ow.deny.map((p: string) => normalizePermissionFlag(p))
          : [];

        if (
          resolved.id === everyoneId &&
          (denies.includes('ViewChannel') || denies.includes('VIEW_CHANNEL'))
        ) {
          everyoneDeniesView = true;
        }

        resolvedList.push({
          id: resolved.id,
          name: resolved.name,
          allow: allows,
          deny: denies,
        });
      }

      // 2. Staff/bot access preservation if role-gated (@everyone denied ViewChannel)
      const staffRoles = resolveStaffRoles(guild);
      if (everyoneDeniesView) {
        const staffPermissions = ['ViewChannel', 'SendMessages', 'ReadMessageHistory'];
        for (const staff of staffRoles) {
          const existing = resolvedList.find((r) => r.id === staff.id);
          if (!existing) {
            resolvedList.push({
              id: staff.id,
              name: staff.name,
              allow: staffPermissions,
              deny: [],
            });
          } else {
            // Ensure staff permissions are in allow and not in deny
            for (const sp of staffPermissions) {
              if (!existing.allow.includes(sp)) existing.allow.push(sp);
              existing.deny = existing.deny.filter((d) => d !== sp);
            }
          }
        }
      }

      // 3. Execution ordering:
      // When @everyone denies ViewChannel, reorder specifically to prevent self-lockout:
      // a. KosmoBot -> ViewChannel: true (FIRST to prevent self-lockout)
      // b. Kosmo Founder -> required access
      // c. Team Kosmo -> required access
      // d. Moderator -> required access
      // e. target discussion role -> required access
      // f. @everyone -> ViewChannel: false (LAST)
      // For normal public channels, preserve existing order.
      if (everyoneDeniesView && Array.isArray(action.payload?.permissionOverwrites)) {
        // Ensure staff roles are present in action.payload.permissionOverwrites
        const staffNames = ['KosmoBot', 'Kosmo Founder', 'Team Kosmo', 'Moderator'];
        const staffPerms = ['ViewChannel', 'SendMessages', 'ReadMessageHistory'];
        for (const sName of staffNames) {
          const hasIt = action.payload.permissionOverwrites.some((ow: any) => {
            if (typeof ow.id !== 'string') return false;
            const l = ow.id.toLowerCase().trim();
            return l === sName.toLowerCase() || (sName === 'Kosmo Founder' && l === 'founder');
          });
          if (!hasIt) {
            action.payload.permissionOverwrites.push({
              id: sName,
              allow: staffPerms,
              deny: [],
            });
          }
        }
        action.payload.permissionOverwrites = orderPermissionOverwritesForRoleGating(
          action.payload.permissionOverwrites
        );
      }

      const executionList = everyoneDeniesView
        ? orderOverwritesForRoleGating(resolvedList, everyoneId, staffRoles)
        : resolvedList;

      // 4. Execution: Apply each overwrite using discord.js v14 boolean format
      for (const entry of executionList) {
        const existingOw = target.permissionOverwrites?.cache?.get?.(entry.id);
        if (isOverwriteAlreadyCorrect(existingOw, entry.allow, entry.deny)) {
          continue; // Already correct, leave intact and avoid redundant Discord API mutation
        }

        const options = toDiscordJsOverwriteOptions(entry.allow, entry.deny);
        try {
          await (target as any).permissionOverwrites.create(entry.id, options);
        } catch (err: any) {
          const discordCode = err?.code ?? err?.rawError?.code ?? 'UNKNOWN';
          const httpStatus =
            err?.status ?? err?.rawError?.status ?? err?.statusCode ?? 'UNKNOWN';
          const errMsg = err?.message || String(err);
          throw new Error(
            `Failed to apply permission overwrite [action: applyPermissionTemplate] on channel "${cleanTargetName}" (ID: ${target.id}) for target "${entry.name}" (ID: ${entry.id}): Discord API error ${discordCode} (HTTP ${httpStatus}) - ${errMsg}`
          );
        }
      }

      // 5. Post-Action Verification: Fetch and verify actual Discord state
      await verifyPermissionState(
        guild,
        target,
        targetName,
        executionList,
        everyoneDeniesView,
        staffRoles
      );

      return `Applied permission template to "${targetName}".`;
    }
    case 'deleteChannel': {
      const { channelName } = action.payload;
      const channel = findChannel(guild, channelName);
      if (!channel) return `Channel "${channelName}" not found or already deleted.`;
      await channel.delete();
      return `Deleted channel "${channelName}".`;
    }
    case 'deleteCategory': {
      const { categoryName } = action.payload;
      const category = findCategory(guild, categoryName);
      if (!category) return `Category "${categoryName}" not found or already deleted.`;
      await category.delete();
      return `Deleted category "${categoryName}".`;
    }
    case 'deleteRole': {
      const { roleName } = action.payload;
      const role = findRole(guild, roleName);
      if (!role) return `Role "${roleName}" not found or already deleted.`;
      await role.delete();
      return `Deleted role "${roleName}".`;
    }
    case 'timeoutMember': {
      const { memberId, durationMinutes, reason } = action.payload;
      const member = await guild.members.fetch(memberId);
      if (!member) throw new Error(`Member "${memberId}" not found.`);
      if (member.id === guild.ownerId) {
        throw new Error('Cannot timeout the server owner.');
      }
      if (member.user?.bot) {
        throw new Error('Cannot timeout bot accounts.');
      }
      if (hasPrivilegedRole(member)) {
        throw new Error('Cannot timeout staff members with privileged roles.');
      }
      const ms = durationMinutes * 60 * 1000;
      await member.timeout(ms, reason);
      return `Timed out member ${member.user?.tag || member.displayName || memberId} for ${durationMinutes} minutes.`;
    }
    case 'kickMember': {
      const { targetId, reason } = action.payload;
      const member = await guild.members.fetch(targetId);
      if (!member) throw new Error(`Member "${targetId}" not found.`);
      if (member.id === guild.ownerId) {
        throw new Error('Cannot kick the server owner.');
      }
      if (member.user?.bot) {
        throw new Error('Cannot kick bot accounts.');
      }
      if (hasPrivilegedRole(member)) {
        throw new Error('Cannot kick staff members with privileged roles.');
      }
      await member.kick(reason);
      return `Kicked member ${member.user?.tag || member.displayName || targetId}.`;
    }
    case 'banMember': {
      const { targetId, reason } = action.payload;
      const member = await guild.members.fetch(targetId);
      if (!member) throw new Error(`Member "${targetId}" not found.`);
      if (member.id === guild.ownerId) {
        throw new Error('Cannot ban the server owner.');
      }
      if (member.user?.bot) {
        throw new Error('Cannot ban bot accounts.');
      }
      if (hasPrivilegedRole(member)) {
        throw new Error('Cannot ban staff members with privileged roles.');
      }
      await member.ban({ reason });
      return `Banned member ${member.user?.tag || member.displayName || targetId}.`;
    }
    case 'purgeMessages': {
      const { channelId, amount, reason } = action.payload;
      if (!channelId?.trim()) {
        throw new Error('Channel ID cannot be empty for purge.');
      }
      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > 100) {
        throw new Error('Purge amount must be an integer between 1 and 100.');
      }
      if (!reason?.trim()) {
        throw new Error('Purge reason cannot be empty.');
      }
      if (reason.trim().length > 512) {
        throw new Error('Purge reason cannot exceed 512 characters.');
      }

      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel) {
        throw new Error(`Channel "${channelId}" not found in server.`);
      }
      if (typeof (channel as any).bulkDelete !== 'function') {
        throw new Error('Target channel does not support message deletion.');
      }

      const botMember =
        guild.members.me ??
        (typeof guild.members.fetchMe === 'function'
          ? await guild.members.fetchMe().catch(() => null)
          : null);
      if (botMember && typeof (channel as any).permissionsFor === 'function') {
        const perms = (channel as any).permissionsFor(botMember);
        if (
          perms &&
          !perms.has(PermissionFlagsBits.ManageMessages) &&
          !perms.has('ManageMessages')
        ) {
          throw new Error('Bot lacks ManageMessages permission in the target channel.');
        }
      }

      const deleted = await (channel as any).bulkDelete(amount, true);
      const deletedCount =
        typeof deleted === 'number'
          ? deleted
          : deleted?.size ?? (Array.isArray(deleted) ? deleted.length : 0);
      const channelName = (channel as any).name || channelId;
      return `Purged ${deletedCount} of ${amount} message(s) from #${channelName}.`;
    }
    default:
      throw new Error('Unknown action type');
  }
}

/**
 * Normalizes permission string to PascalCase used by discord.js v14
 */
function normalizePermissionFlag(flag: string): string {
  const clean = flag.replace(/[_\s-]/g, '').toLowerCase();
  const map: Record<string, string> = {
    viewchannel: 'ViewChannel',
    sendmessages: 'SendMessages',
    readmessagehistory: 'ReadMessageHistory',
    embedlinks: 'EmbedLinks',
    attachfiles: 'AttachFiles',
    connect: 'Connect',
    speak: 'Speak',
    administrator: 'Administrator',
    managemessages: 'ManageMessages',
    manageroles: 'ManageRoles',
    managechannels: 'ManageChannels',
    createinstantinvite: 'CreateInstantInvite',
  };
  return map[clean] || flag;
}

/**
 * Resolves permission template target ID from either:
 * - @everyone / everyone -> guild.roles.everyone.id
 * - Snowflake ID (if matches role/user in guild)
 * - Role name (case-insensitive)
 * - Bot username or bot role
 */
function resolveOverwriteTargetId(guild: Guild, rawTarget: string): { id: string; name: string } {
  const trimmed = rawTarget.trim();
  const lower = trimmed.toLowerCase();

  // @everyone
  if (lower === '@everyone' || lower === 'everyone') {
    const everyoneRole = guild.roles.everyone ?? { id: guild.id, name: '@everyone' };
    return { id: everyoneRole.id, name: '@everyone' };
  }

  // Check if snowflake ID
  if (/^\d{17,20}$/.test(trimmed)) {
    const roleById = guild.roles.cache.get(trimmed);
    if (roleById) {
      return { id: roleById.id, name: roleById.name };
    }
    const memberById = guild.members?.cache?.get(trimmed);
    if (memberById) {
      return { id: memberById.id, name: memberById.user?.tag || memberById.displayName || trimmed };
    }
    // Bot role fallback
    if (guild.members?.me?.id === trimmed) {
      return { id: trimmed, name: 'KosmoBot' };
    }
    return { id: trimmed, name: trimmed };
  }

  // Match by role name (case-insensitive)
  const matching = Array.from(guild.roles.cache.values()).filter(
    (r) => r.name.toLowerCase() === lower
  );

  if (matching.length === 0) {
    if (
      lower === 'kosmobot' ||
      (guild.members?.me?.user?.username && lower === guild.members.me.user.username.toLowerCase())
    ) {
      const botRole =
        guild.members?.me?.roles?.botRole ??
        (guild.members?.me
          ? Array.from(guild.roles.cache.values()).find((r) => r.tags?.botId === guild.members.me?.id)
          : null);
      if (botRole) {
        return { id: botRole.id, name: botRole.name };
      }
      if (guild.members?.me?.id) {
        return { id: guild.members.me.id, name: 'KosmoBot' };
      }
    }
    throw new Error(
      `Role "${trimmed}" not found in this server. Missing roles must be created manually first.`
    );
  }

  if (matching.length > 1) {
    throw new Error(
      `Role name "${trimmed}" is ambiguous (matched ${matching.length} roles). Please specify the role by its unique ID.`
    );
  }

  return { id: matching[0].id, name: matching[0].name };
}

interface StaffRoleInfo {
  name: string;
  id: string;
}

/**
 * Identifies existing staff and bot roles present in the guild for access preservation:
 * - Kosmo Founder
 * - Team Kosmo
 * - Moderator
 * - KosmoBot
 */
function resolveStaffRoles(guild: Guild): StaffRoleInfo[] {
  const staff: StaffRoleInfo[] = [];

  // Kosmo Founder
  const founderRole = findRole(guild, 'Kosmo Founder') ?? findRole(guild, 'Founder');
  if (founderRole) {
    staff.push({ name: founderRole.name, id: founderRole.id });
  }

  // Team Kosmo
  const teamRole = findRole(guild, 'Team Kosmo');
  if (teamRole) {
    staff.push({ name: teamRole.name, id: teamRole.id });
  }

  // Moderator
  const modRole = findRole(guild, 'Moderator');
  if (modRole) {
    staff.push({ name: modRole.name, id: modRole.id });
  }

  // KosmoBot
  const botRole =
    findRole(guild, 'KosmoBot') ??
    guild.members?.me?.roles?.botRole ??
    (guild.members?.me
      ? Array.from(guild.roles.cache.values()).find((r) => r.tags?.botId === guild.members.me?.id)
      : null);
  if (botRole) {
    staff.push({ name: botRole.name, id: botRole.id });
  } else if (guild.members?.me?.id) {
    staff.push({ name: 'KosmoBot', id: guild.members.me.id });
  }

  return staff;
}

/** Converts allow/deny arrays into discord.js v14 PermissionOverwriteOptions object */
function toDiscordJsOverwriteOptions(allow: string[], deny: string[]): Record<string, boolean> {
  const options: Record<string, boolean> = {};
  for (const p of allow) {
    const norm = normalizePermissionFlag(p);
    options[norm] = true;
  }
  for (const p of deny) {
    const norm = normalizePermissionFlag(p);
    options[norm] = false;
  }
  return options;
}

/** Safely checks whether a PermissionsBitField or permission array/object contains a permission */
function checkBitfieldOrList(field: any, perm: string): boolean {
  if (!field) return false;
  if (typeof field.has === 'function') {
    try {
      return field.has(perm);
    } catch {
      // Fallback if flag resolution throws
    }
  }
  if (typeof field.toArray === 'function') {
    try {
      const arr = field.toArray();
      if (Array.isArray(arr)) {
        return arr.map((x: string) => x.toLowerCase()).includes(perm.toLowerCase());
      }
    } catch {}
  }
  if (Array.isArray(field)) {
    return field.map((x: any) => String(x).toLowerCase()).includes(perm.toLowerCase());
  }
  if (typeof field === 'object' && field[perm] !== undefined) {
    return Boolean(field[perm]);
  }
  return false;
}

/**
 * Post-action verification:
 * - Fetches target channel's current permission overwrites
 * - Asserts all requested allow/deny permissions are present in Discord state
 * - Asserts staff/bot access is preserved on role-gated channels
 * - Throws error if any state does not match
 */
async function verifyPermissionState(
  guild: Guild,
  target: any,
  targetName: string,
  expectedOverwrites: { id: string; name: string; allow: string[]; deny: string[] }[],
  mustPreserveStaff: boolean,
  staffRoles: StaffRoleInfo[]
): Promise<void> {
  let currentTarget: any = target;
  if (typeof guild.channels?.fetch === 'function') {
    try {
      currentTarget = (await guild.channels.fetch(target.id, { force: true } as any)) ?? target;
    } catch {
      currentTarget = target;
    }
  }

  const overwritesCache = currentTarget.permissionOverwrites?.cache;
  if (!overwritesCache) {
    throw new Error(
      `Post-action verification failed: Channel "${targetName}" permission overwrites cache is unavailable.`
    );
  }

  // 1. Verify every expected allow/deny permission
  for (const expected of expectedOverwrites) {
    const actual = overwritesCache.get(expected.id);
    if (!actual) {
      throw new Error(
        `Post-action verification failed: Overwrite for "${expected.name}" (${expected.id}) not found on channel "${targetName}".`
      );
    }

    for (const p of expected.allow) {
      const norm = normalizePermissionFlag(p);
      const isAllowed = checkBitfieldOrList(actual.allow, norm);
      if (!isAllowed) {
        throw new Error(
          `Post-action verification failed: Permission "${norm}" is not allowed for "${expected.name}" (${expected.id}) on channel "${targetName}".`
        );
      }
    }

    for (const p of expected.deny) {
      const norm = normalizePermissionFlag(p);
      const isDenied = checkBitfieldOrList(actual.deny, norm);
      if (!isDenied) {
        throw new Error(
          `Post-action verification failed: Permission "${norm}" is not denied for "${expected.name}" (${expected.id}) on channel "${targetName}".`
        );
      }
    }
  }

  // 2. Verify staff/bot access is preserved if channel is role-gated (@everyone denied ViewChannel)
  if (mustPreserveStaff) {
    for (const staff of staffRoles) {
      const actual = overwritesCache.get(staff.id);
      if (!actual) {
        throw new Error(
          `Post-action verification failed: Staff role "${staff.name}" (${staff.id}) has no permission overwrite on role-gated channel "${targetName}".`
        );
      }
      const isAllowed = checkBitfieldOrList(actual.allow, 'ViewChannel');
      if (!isAllowed) {
        throw new Error(
          `Post-action verification failed: ViewChannel permission is not allowed for staff role "${staff.name}" (${staff.id}) on role-gated channel "${targetName}".`
        );
      }
    }
  }
}

/** Known privileged role IDs from roles.json for fallback matching */
const KNOWN_STAFF_ROLE_IDS = {
  founder: ['1544750811207442532', '111111111111111111'],
  teamKosmo: ['1544801399068434443', '222222222222222222'],
  moderator: ['1545398110359126066', '444444444444444444'],
  bot: ['1544800893860577360'],
};

/**
 * Reorders permissionOverwrites array (whether containing role names or IDs) to guarantee safe role-gating:
 * 1. KosmoBot (always first to prevent self-lockout)
 * 2. Kosmo Founder
 * 3. Team Kosmo
 * 4. Moderator
 * 5. Target role(s)
 * 6. @everyone (always last)
 */
export function orderPermissionOverwritesForRoleGating<T extends { id: string }>(
  overwrites: T[]
): T[] {
  const botEntries: T[] = [];
  const founderEntries: T[] = [];
  const teamEntries: T[] = [];
  const modEntries: T[] = [];
  const targetRoleEntries: T[] = [];
  const everyoneEntries: T[] = [];

  for (const ow of overwrites) {
    const raw = typeof ow.id === 'string' ? ow.id.trim() : '';
    const lower = raw.toLowerCase();

    if (lower === '@everyone' || lower === 'everyone') {
      everyoneEntries.push(ow);
    } else if (lower === 'kosmobot' || KNOWN_STAFF_ROLE_IDS.bot.includes(raw)) {
      botEntries.push(ow);
    } else if (
      lower === 'kosmo founder' ||
      lower === 'founder' ||
      KNOWN_STAFF_ROLE_IDS.founder.includes(raw)
    ) {
      founderEntries.push(ow);
    } else if (
      lower === 'team kosmo' ||
      KNOWN_STAFF_ROLE_IDS.teamKosmo.includes(raw)
    ) {
      teamEntries.push(ow);
    } else if (
      lower === 'moderator' ||
      KNOWN_STAFF_ROLE_IDS.moderator.includes(raw)
    ) {
      modEntries.push(ow);
    } else {
      targetRoleEntries.push(ow);
    }
  }

  return [
    ...botEntries,
    ...founderEntries,
    ...teamEntries,
    ...modEntries,
    ...targetRoleEntries,
    ...everyoneEntries,
  ];
}

/**
 * Orders permission overwrites specifically to prevent self-lockout on role-gated channels:
 * 1. KosmoBot (always first so bot never locks itself out)
 * 2. Kosmo Founder
 * 3. Team Kosmo
 * 4. Moderator
 * 5. Target role(s)
 * 6. @everyone (always last)
 */
export function orderOverwritesForRoleGating<T extends { id: string; name: string }>(
  list: T[],
  everyoneId: string,
  staffRoles: StaffRoleInfo[]
): T[] {
  const botInfo = staffRoles.find((s) => s.name.toLowerCase() === 'kosmobot');
  const founderInfo = staffRoles.find(
    (s) => s.name.toLowerCase() === 'kosmo founder' || s.name.toLowerCase() === 'founder'
  );
  const teamInfo = staffRoles.find((s) => s.name.toLowerCase() === 'team kosmo');
  const modInfo = staffRoles.find((s) => s.name.toLowerCase() === 'moderator');

  const botEntries: typeof list = [];
  const founderEntries: typeof list = [];
  const teamEntries: typeof list = [];
  const modEntries: typeof list = [];
  const otherRoleEntries: typeof list = [];
  const everyoneEntries: typeof list = [];

  for (const entry of list) {
    if (
      entry.id === everyoneId ||
      entry.name.toLowerCase() === '@everyone' ||
      entry.name.toLowerCase() === 'everyone'
    ) {
      everyoneEntries.push(entry);
    } else if (
      (botInfo && entry.id === botInfo.id) ||
      entry.name.toLowerCase() === 'kosmobot'
    ) {
      botEntries.push(entry);
    } else if (
      (founderInfo && entry.id === founderInfo.id) ||
      entry.name.toLowerCase() === 'kosmo founder' ||
      entry.name.toLowerCase() === 'founder'
    ) {
      founderEntries.push(entry);
    } else if (
      (teamInfo && entry.id === teamInfo.id) ||
      entry.name.toLowerCase() === 'team kosmo'
    ) {
      teamEntries.push(entry);
    } else if (
      (modInfo && entry.id === modInfo.id) ||
      entry.name.toLowerCase() === 'moderator'
    ) {
      modEntries.push(entry);
    } else {
      otherRoleEntries.push(entry);
    }
  }

  return [
    ...botEntries,
    ...founderEntries,
    ...teamEntries,
    ...modEntries,
    ...otherRoleEntries,
    ...everyoneEntries,
  ];
}

/**
 * Checks if a channel's existing overwrite already matches the requested allow/deny set
 * to ensure idempotence without redundant Discord API calls.
 */
function isOverwriteAlreadyCorrect(
  existingOw: any,
  allow: string[],
  deny: string[]
): boolean {
  if (!existingOw) return false;
  for (const p of allow) {
    const norm = normalizePermissionFlag(p);
    if (!checkBitfieldOrList(existingOw.allow, norm)) return false;
  }
  for (const p of deny) {
    const norm = normalizePermissionFlag(p);
    if (!checkBitfieldOrList(existingOw.deny, norm)) return false;
  }
  for (const p of allow) {
    const norm = normalizePermissionFlag(p);
    if (checkBitfieldOrList(existingOw.deny, norm)) return false;
  }
  for (const p of deny) {
    const norm = normalizePermissionFlag(p);
    if (checkBitfieldOrList(existingOw.allow, norm)) return false;
  }
  return true;
}
