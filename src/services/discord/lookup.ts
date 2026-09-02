import { Guild, Role, GuildChannel, ChannelType, CategoryChannel } from 'discord.js';

/** Find a role by name or ID */
export function findRole(guild: Guild, nameOrId: string): Role | null {
  const roles = Array.from(guild.roles.cache.values());
  const role = roles.find(r => r.id === nameOrId || r.name === nameOrId);
  return role ?? null;
}

/** Find a channel by name or ID */
export function findChannel(guild: Guild, nameOrId: string): GuildChannel | null {
  const channels = Array.from(guild.channels.cache.values());
  const channel = channels.find(c => c.id === nameOrId || c.name === nameOrId) as GuildChannel | null;
  return channel ?? null;
}


export function findCategory(guild: Guild, nameOrId: string): CategoryChannel | null {
  const channels = Array.from(guild.channels.cache.values());
  const channel = channels.find(c => c.type === ChannelType.GuildCategory && (c.id === nameOrId || c.name === nameOrId)) as CategoryChannel | null;
  return channel ?? null;
}
