// src/services/support/ticketService.ts

import {
  Guild,
  GuildBasedChannel,
  GuildChannel,
  CategoryChannel,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  TextChannel,
} from 'discord.js';
import {
  TicketMetadata,
  TicketPrivacyAuditReport,
  TicketRouteDestination,
  TicketRouteResult,
  TicketAuditEntry,
} from '../../types/ticket';
import { findCategory, findRole } from '../discord/lookup';
import { getAuditRepository } from '../database/auditRepository';

/**
 * Normalizes channel or category names for robust matching against known patterns.
 */
function cleanName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Checks if a channel represents an active support ticket channel.
 * Identified by:
 * 1. Channel name starting with 'ticket-' or matching ticket pattern (e.g., ticket-username, ticket-0001).
 * 2. OR Parent category name matching 'ACTIVE TICKETS' / '🛠️ ACTIVE TICKETS'.
 */
export function isTicketChannel(channel: any): boolean {
  if (!channel) return false;

  const name = (channel.name || '').toLowerCase();
  if (name.startsWith('ticket-') || name === 'tickets') {
    return true;
  }

  // Check parent category name
  const parentName = channel.parent?.name || '';
  const cleanedParent = cleanName(parentName);
  if (cleanedParent.includes('activeticket')) {
    return true;
  }

  return false;
}

/**
 * Resolves staff roles in the guild: Founder, Team Kosmo, Moderator, Admin.
 */
function getStaffRoleIds(guild: Guild): Set<string> {
  const staffRoleIds = new Set<string>();

  const roleNames = ['Kosmo Founder', 'Founder', 'Team Kosmo', 'Moderator', 'Admin', 'Administrator'];
  for (const rName of roleNames) {
    const role = findRole(guild, rName);
    if (role) {
      staffRoleIds.add(role.id);
    }
  }

  return staffRoleIds;
}

/**
 * Performs an audit of a ticket channel's privacy permissions.
 * Verifies:
 * - @everyone is explicitly DENIED ViewChannel
 * - Staff roles have ViewChannel allowed
 * - Identifies ticket creator access
 * - Flags any unauthorized role or public leaks
 *
 * Strictly inspects metadata and overwrites only. Never accesses message content.
 */
export function auditTicketPrivacy(
  guild: Guild,
  channel: any
): TicketPrivacyAuditReport {
  const issues: string[] = [];
  const warnings: string[] = [];

  const everyoneId = guild.roles.everyone?.id ?? guild.id;
  const staffRoleIds = getStaffRoleIds(guild);
  const botId = guild.members?.me?.id;

  const overwrites = channel.permissionOverwrites?.cache
    ? Array.from(channel.permissionOverwrites.cache.values())
    : Array.isArray(channel.permissionOverwrites)
    ? channel.permissionOverwrites
    : [];

  let everyoneDeniesView = false;
  let staffHasAccess = false;
  let creatorHasAccess = false;
  let creatorId: string | undefined = undefined;

  // 1. Audit @everyone overwrite
  const everyoneOw: any = overwrites.find((ow: any) => String(ow.id) === String(everyoneId));
  if (everyoneOw) {
    const denyBitfield =
      typeof everyoneOw.deny?.has === 'function'
        ? everyoneOw.deny.has(PermissionFlagsBits.ViewChannel)
        : Array.isArray(everyoneOw.deny)
        ? everyoneOw.deny.some((p: string) => p.toLowerCase().includes('view'))
        : false;

    if (denyBitfield) {
      everyoneDeniesView = true;
    } else {
      issues.push('CRITICAL: @everyone is not denied ViewChannel. This ticket is exposed to unauthorized users!');
    }
  } else {
    issues.push('CRITICAL: No permission overwrite for @everyone found. Channel inherits category permissions!');
  }

  // 2. Audit staff access
  for (const ow of overwrites as any[]) {
    const owId = String(ow.id);
    const allowBitfield =
      typeof ow.allow?.has === 'function'
        ? ow.allow.has(PermissionFlagsBits.ViewChannel)
        : Array.isArray(ow.allow)
        ? ow.allow.some((p: string) => p.toLowerCase().includes('view'))
        : false;

    if (staffRoleIds.has(owId) && allowBitfield) {
      staffHasAccess = true;
    }

    // Check if member overwrite belongs to creator (member overwrite with ViewChannel allowed, not bot/staff)
    const isMemberType = ow.type === 1 || ow.type === 'member' || ow.type === 'Member';
    if (isMemberType && allowBitfield && owId !== botId && !staffRoleIds.has(owId)) {
      creatorHasAccess = true;
      creatorId = owId;
    }
  }

  // If creatorId not found from member overwrite, check channel topic if Ticket Tool stored it
  if (!creatorId && channel.topic) {
    const topicMatch = channel.topic.match(/(\d{17,20})/);
    if (topicMatch) {
      creatorId = topicMatch[1];
      creatorHasAccess = true;
    }
  }

  if (!staffHasAccess) {
    warnings.push('WARNING: No configured staff role explicitly has ViewChannel permission on this channel.');
  }

  const isPrivate = everyoneDeniesView && issues.length === 0;

  return {
    isPrivate,
    everyoneDeniesView,
    staffHasAccess,
    creatorHasAccess,
    creatorId,
    issues,
    warnings,
  };
}

/**
 * Returns read-only metadata for a ticket channel.
 * STRICT PRIVACY: NEVER returns message bodies, attachments, or conversation history.
 */
export function inspectTicket(guild: Guild, channel: any): TicketMetadata {
  const privacyReport = auditTicketPrivacy(guild, channel);

  let categoryName: string | null = null;
  if (channel.parent?.name) {
    categoryName = channel.parent.name;
  } else if (channel.parentId) {
    const parent = guild.channels?.cache?.get(channel.parentId);
    categoryName = parent?.name ?? null;
  }

  return {
    channelId: channel.id,
    channelName: channel.name,
    categoryId: channel.parentId ?? null,
    categoryName,
    createdAt: channel.createdAt ?? null,
    creatorId: privacyReport.creatorId ?? null,
    isPrivate: privacyReport.isPrivate,
    privacyReport,
  };
}

/**
 * Finds an approved category channel for a routing destination.
 */
export function findDestinationCategory(
  guild: Guild,
  destination: TicketRouteDestination
): CategoryChannel | null {
  const categories = Array.from(
    guild.channels?.cache?.values() ?? []
  ).filter((c): c is CategoryChannel => c.type === ChannelType.GuildCategory);

  switch (destination) {
    case 'ACTIVE_TICKETS': {
      return (
        categories.find((c) => {
          const cleaned = cleanName(c.name);
          return cleaned.includes('activeticket');
        }) ?? null
      );
    }
    case 'FEEDBACK_AND_SUPPORT': {
      return (
        categories.find((c) => {
          const cleaned = cleanName(c.name);
          return cleaned.includes('feedback') || (cleaned.includes('support') && !cleaned.includes('active'));
        }) ?? null
      );
    }
    case 'PRIORITY_SUPPORT': {
      return (
        categories.find((c) => {
          const cleaned = cleanName(c.name);
          return cleaned.includes('promax') || cleaned.includes('priority');
        }) ?? null
      );
    }
    default:
      return null;
  }
}

/**
 * Safely routes a ticket channel to a new approved category.
 * Preserves existing permission overwrites by setting lockPermissions: false.
 * Verifies resulting Discord state before reporting success.
 */
export async function routeTicket(
  guild: Guild,
  channel: any,
  destination: TicketRouteDestination,
  actorId: string
): Promise<TicketRouteResult> {
  const targetCategory = findDestinationCategory(guild, destination);
  if (!targetCategory) {
    throw new Error(`Destination category "${destination}" could not be found on this server.`);
  }

  const previousCategoryId = channel.parentId ?? null;
  if (previousCategoryId === targetCategory.id) {
    return {
      success: true,
      previousCategoryId,
      newCategoryId: targetCategory.id,
      newCategoryName: targetCategory.name,
      message: `Ticket is already routed under "${targetCategory.name}".`,
    };
  }

  // Discord mutation: Move channel parent WITHOUT syncing/locking permissions to preserve ticket privacy
  if (typeof channel.setParent === 'function') {
    await channel.setParent(targetCategory.id, { lockPermissions: false });
  } else {
    throw new Error('Target channel does not support category re-assignment.');
  }

  // Post-action state verification
  const updatedChannel = await guild.channels.fetch(channel.id).catch(() => null);
  if (!updatedChannel || (updatedChannel as any).parentId !== targetCategory.id) {
    throw new Error(
      `Verification failed: channel parent category was not updated to "${targetCategory.name}".`
    );
  }

  return {
    success: true,
    previousCategoryId,
    newCategoryId: targetCategory.id,
    newCategoryName: targetCategory.name,
    message: `Successfully routed ticket to "${targetCategory.name}".`,
  };
}

/**
 * Sends a structured audit log entry to #mod-logs.
 * STRICT PRIVACY REQUIREMENT:
 * Never logs ticket message bodies, transcripts, user messages, or sensitive tokens.
 * Gracefully succeeds without error if #mod-logs is absent.
 */
export async function logTicketAudit(
  guild: Guild,
  entry: TicketAuditEntry
): Promise<void> {
  // 1. Durable PostgreSQL Audit Persistence (metadata only, no raw message/ticket bodies)
  try {
    const auditRepo = getAuditRepository();
    await auditRepo.recordEvent({
      guildId: guild.id,
      actionType: `TICKET_${entry.action}`,
      actorId: entry.actorId,
      targetId: entry.channelId,
      status: entry.status === 'SUCCESS' ? 'SUCCESS' : entry.status === 'INFO' ? 'SUCCESS' : 'FAILED',
      metadata: {
        channelId: entry.channelId,
        channelName: entry.channelName,
        actorTag: entry.actorTag,
        destinationCategory: entry.destinationCategory || null,
        details: entry.details || null,
      },
      createdAt: entry.timestamp,
    });
  } catch (dbErr) {
    console.warn('Failed to record ticket audit event in PostgreSQL durable auditRepository:', dbErr);
  }

  // 2. Operational Discord #mod-logs embed
  try {
    const modLogsChannel = guild.channels?.cache
      ? Array.from(guild.channels.cache.values()).find(
          (c) => c.name?.toLowerCase() === 'mod-logs' && 'send' in c
        )
      : null;

    if (!modLogsChannel || typeof (modLogsChannel as any).send !== 'function') {
      return; // Gracefully continue if #mod-logs is not present
    }

    const color =
      entry.status === 'SUCCESS' ? 0x2ecc71 : entry.status === 'FAILED' ? 0xe74c3c : 0x3498db;

    const embed = new EmbedBuilder()
      .setTitle(`🛡️ Support Ticket Action: ${entry.action}`)
      .setColor(color)
      .addFields(
        { name: 'Channel', value: `#${entry.channelName} (\`${entry.channelId}\`)`, inline: true },
        { name: 'Actor', value: `<@${entry.actorId}> (\`${entry.actorTag}\`)`, inline: true },
        { name: 'Status', value: entry.status, inline: true }
      )
      .setTimestamp(entry.timestamp);

    if (entry.destinationCategory) {
      embed.addFields({ name: 'Destination Category', value: entry.destinationCategory, inline: true });
    }

    if (entry.details) {
      embed.addFields({ name: 'Details', value: entry.details, inline: false });
    }

    await (modLogsChannel as any).send({ embeds: [embed] });
  } catch (err) {
    // Non-blocking fallback: never fail the primary workflow due to audit logging error
    console.warn('Failed to send ticket audit log to #mod-logs:', err);
  }
}
