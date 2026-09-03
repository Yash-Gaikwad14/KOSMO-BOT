// src/services/discord/audit.ts

import { Guild, ApplicationCommand, Role, GuildChannel } from 'discord.js';
import { authorize, Category } from './policy';
import { AuditReport, RoleInfo, ChannelInfo, CommandInfo } from '../../types/audit';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Run a read‑only audit of the guild state.
 *
 * @param guild The Discord guild to inspect.
 * @param userRoleIds Array of Discord role IDs that the requesting user possesses.
 * @throws if the policy denies the audit operation.
 */
export async function runAudit(guild: Guild, userRoleIds: string[]): Promise<AuditReport> {
  // ----------- Authorization -------------------------------------------------
  const decision = authorize(userRoleIds, Category.AUDIT);
  if (decision !== 'ALLOW') {
    throw new Error('Unauthorized: audit operation is not permitted');
  }

  // ----------- Guild information -------------------------------------------
  const guildInfo = {
    id: guild.id,
    name: guild.name,
  };

  // ----------- Roles --------------------------------------------------------
  const roles: RoleInfo[] = guild.roles.cache.map((role: Role) => ({
    id: role.id,
    name: role.name,
    position: role.position,
    permissions: role.permissions.bitfield.toString(),
  }));

  // ----------- Channels -----------------------------------------------------
  const channels: ChannelInfo[] = guild.channels.cache.map((channel) => {
    // channel may be any GuildBasedChannel; we only need the basic fields
    const overwrites = (channel as any).permissionOverwrites?.cache?.map((ow: any) => ({
      id: ow.id,
      allow: ow.allow?.toArray?.() ?? [],
      deny: ow.deny?.toArray?.() ?? [],
    })) ?? [];
    return {
      id: (channel as any).id,
      name: (channel as any).name ?? '',
      type: String((channel as any).type),
      parentId: (channel as any).parentId ?? null,
      permissionOverwrites: overwrites,
    } as ChannelInfo;
  });

  // ----------- Registered slash commands -----------------------------------
  let commands: CommandInfo[] = [];
  try {
    const commandCollection = await guild.commands.fetch();
    commands = commandCollection.map((cmd: ApplicationCommand) => ({
      id: cmd.id,
      name: cmd.name,
      description: cmd.description,
      defaultPermission: (cmd as any).defaultPermission,
    }));
  } catch {
    // If fetching commands fails in test/mock environment
  }

  // ----------- Desired‑state configuration presence -------------------------
  const desiredConfigPath = path.resolve(__dirname, '../../config/desiredState.json');
  const hasDesiredStateConfig = fs.existsSync(desiredConfigPath);

  // Assemble the report
  const report: AuditReport = {
    guild: guildInfo,
    roles,
    channels,
    commands,
    hasDesiredStateConfig,
  };

  return report;
}
