import { Guild, GuildChannel, Role, TextChannel, VoiceChannel, CategoryChannel, ChannelType } from 'discord.js';
import { findRole, findChannel } from './lookup';
import { validateAction } from './permissionValidator';
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
      const { name, type } = action.payload;
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
      await guild.channels.create({ name, type: channelType });
      return `Created ${type.toLowerCase().replace('guild_', '')} channel "${name}".`;
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
      const target = findChannel(guild, targetName) ?? findCategory(guild, targetName);
      if (!target) throw new Error(`Target "${targetName}" not found for permission template.`);
      // Apply each overwrite (assumes permissionOverwrites is an array of {id, allow?, deny?})
      for (const ow of permissionOverwrites) {
        // Validation: do not allow Administrator or privileged role grants
        if (ow.allow && ow.allow.includes('Administrator')) {
          throw new Error('Permission template cannot grant Administrator permission.');
        }
        if (ow.deny && ow.deny.includes('Administrator')) {
          // denying admin is allowed – proceed
        }
        // Further checks for privileged roles could be added here
        await (target as any).permissionOverwrites.create(ow.id, {
          allow: ow.allow ? ow.allow.map((p: any) => (typeof p === 'string' ? p : p)) : [],
          deny: ow.deny ? ow.deny.map((p: any) => (typeof p === 'string' ? p : p)) : [],
        });
      }
      return `Applied permission template to "${targetName}".`;
    }
    default:
      throw new Error('Unknown action type');
  }
}

// Helper for categories (reuse findChannel logic)
function findCategory(guild: Guild, nameOrId: string) {
  const channel = guild.channels.cache.find(
    (c) => (c.type === ChannelType.GuildCategory) && (c.id === nameOrId || c.name === nameOrId),
  );
  return channel ?? null;
}
