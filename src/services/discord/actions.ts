import { Guild, GuildChannel, Role, TextChannel, VoiceChannel, CategoryChannel, ChannelType } from 'discord.js';
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
    default:
      throw new Error('Unknown action type');
  }
}
