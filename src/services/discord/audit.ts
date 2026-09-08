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
 * @param userId Optional Discord user ID of the requesting user. If matching guild.ownerId, authorized as owner.
 * @throws if the policy denies the audit operation.
 */
export async function runAudit(guild: Guild, userRoleIds: string[], userId?: string): Promise<AuditReport> {
  // ----------- Authorization (Centralized Policy Layer) -----------------------
  const decision = authorize(userRoleIds, Category.AUDIT, {
    userId,
    guildOwnerId: guild.ownerId,
  });
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
  const commandCollection = await guild.commands.fetch();
  const commands: CommandInfo[] = commandCollection.map((cmd: ApplicationCommand) => ({
    id: cmd.id,
    name: cmd.name,
    description: cmd.description,
    defaultPermission: (cmd as any).defaultPermission,
  }));

  // ----------- Desired‑state configuration presence -------------------------
  const candidatePaths = [
    path.resolve(__dirname, '../../config/desiredState.json'), // ts-node / test runtime: src/services/discord -> src/config/desiredState.json
    path.resolve(__dirname, '../../../src/config/desiredState.json'), // compiled runtime: dist/services/discord -> src/config/desiredState.json
    path.resolve(process.cwd(), 'src/config/desiredState.json'), // process root fallback
  ];
  const hasDesiredStateConfig = candidatePaths.some((candidate) => fs.existsSync(candidate));

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
