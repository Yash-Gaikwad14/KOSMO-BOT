import { Guild, ChannelType, EmbedBuilder } from 'discord.js';
import { IUnbelievaBoatClient, UnbelievaBoatClient } from './unbelievaboatClient';
import { getLogicalRoles, LogicalRole } from '../discord/policy';
import { getAuditRepository } from '../database/auditRepository';

export const MAX_REWARD_AMOUNT = 5000;
export const MIN_REWARD_AMOUNT = 1;
export const MIN_REASON_LENGTH = 10;
export const MAX_REASON_LENGTH = 500;

export interface ValidationResult<T> {
  valid: boolean;
  error?: string;
  value?: T;
}

/**
 * Validates the Sparks grant amount.
 * Defense-in-depth: enforces positive integers strictly between 1 and 5,000.
 */
export function validateRewardAmount(amount: unknown): ValidationResult<number> {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return { valid: false, error: 'Amount must be a valid finite number.' };
  }

  if (!Number.isInteger(amount)) {
    return { valid: false, error: 'Amount must be an integer (no decimals).' };
  }

  if (amount < MIN_REWARD_AMOUNT) {
    return { valid: false, error: `Amount must be at least ${MIN_REWARD_AMOUNT} Spark.` };
  }

  if (amount > MAX_REWARD_AMOUNT) {
    return { valid: false, error: `Amount cannot exceed ${MAX_REWARD_AMOUNT.toLocaleString()} Sparks per command execution.` };
  }

  return { valid: true, value: amount };
}

/**
 * Validates the Sparks grant reason.
 * Requires trimmed non-empty text between 10 and 500 characters.
 */
export function validateRewardReason(reason: unknown): ValidationResult<string> {
  if (typeof reason !== 'string') {
    return { valid: false, error: 'Reason must be a text string.' };
  }

  const trimmed = reason.trim();
  if (!trimmed) {
    return { valid: false, error: 'Reason cannot be empty or whitespace-only.' };
  }

  if (trimmed.length < MIN_REASON_LENGTH) {
    return { valid: false, error: `Reason must be at least ${MIN_REASON_LENGTH} characters long.` };
  }

  if (trimmed.length > MAX_REASON_LENGTH) {
    return { valid: false, error: `Reason cannot exceed ${MAX_REASON_LENGTH} characters.` };
  }

  return { valid: true, value: trimmed };
}

/**
 * Checks if the caller has authorized roles for staff Sparks reward.
 * Reuses centralized policy: only Kosmo Founder and Team Kosmo are permitted.
 * Moderators, generic administrators, and community members are denied.
 */
export function isStaffRewardAuthorized(userRoleIds: string[]): boolean {
  if (!userRoleIds || userRoleIds.length === 0) {
    return false;
  }

  const logicalRoles = getLogicalRoles(userRoleIds);
  return (
    logicalRoles.includes(LogicalRole.Founder) ||
    logicalRoles.includes(LogicalRole.TeamKosmo)
  );
}

export interface GrantPersonalSparksResult {
  success: boolean;
  amount: number;
  cash?: number;
  total?: number;
  bank?: number;
  error?: string;
}

/**
 * Dispatches the Sparks grant to UnbelievaBoat for the caller's own wallet.
 * UnbelievaBoat remains the sole authoritative currency ledger.
 */
export async function grantPersonalSparks(
  client: IUnbelievaBoatClient,
  guildId: string,
  userId: string,
  amount: number,
  reason: string
): Promise<GrantPersonalSparksResult> {
  const ubbResponse = await client.grantSparks(guildId, userId, amount, reason);

  if (!ubbResponse.success) {
    return {
      success: false,
      amount,
      error: ubbResponse.error || 'Failed to communicate with UnbelievaBoat API.',
    };
  }

  const data = ubbResponse.data;
  return {
    success: true,
    amount,
    cash: data?.cash,
    total: data?.total,
    bank: data?.bank,
  };
}

export interface RewardAuditOptions {
  actorId: string;
  actorTag?: string;
  guildId: string;
  amount: number;
  reason: string;
  actionId: string;
  timestamp: string;
  result: 'SUCCESS' | 'FAILED';
  newCash?: number;
  newTotal?: number;
  error?: string;
}

/**
 * Logs the staff Sparks grant to #mod-logs channel.
 * Never logs secrets or API keys.
 */
export async function logRewardSparksAudit(
  guild: Guild,
  options: RewardAuditOptions
): Promise<void> {
  // 1. Durable PostgreSQL audit record
  try {
    const auditRepo = getAuditRepository();
    await auditRepo.recordEvent({
      guildId: guild.id,
      actionType: 'STAFF_REWARD_SPARKS',
      actorId: options.actorId,
      status: options.result,
      metadata: {
        actionId: options.actionId,
        actorTag: options.actorTag || null,
        amount: options.amount,
        reason: options.reason,
        newCash: options.newCash ?? null,
        newTotal: options.newTotal ?? null,
        error: options.error || null,
      },
      createdAt: new Date(options.timestamp),
    });
  } catch (dbErr) {
    console.warn('Failed to record reward audit event in PostgreSQL durable auditRepository:', dbErr);
  }

  // 2. Operational Discord #mod-logs embed
  const modLogsChannel = guild.channels?.cache?.find?.(
    (c: any) =>
      c.name?.toLowerCase() === 'mod-logs' &&
      (c.type === ChannelType.GuildText || typeof c.send === 'function')
  );

  if (!modLogsChannel || typeof (modLogsChannel as any).send !== 'function') {
    return;
  }

  const isSuccess = options.result === 'SUCCESS';
  const embed = new EmbedBuilder()
    .setTitle(isSuccess ? '✨ Staff Sparks Grant' : '❌ Staff Sparks Grant Failed')
    .setColor(isSuccess ? 0x57f287 : 0xed4245)
    .addFields(
      { name: 'Action', value: '`STAFF_REWARD_SPARKS`', inline: true },
      { name: 'Result', value: `\`${options.result}\``, inline: true },
      { name: 'Action ID', value: `\`${options.actionId}\``, inline: true },
      {
        name: 'Staff Member (Self-Grant)',
        value: `<@${options.actorId}> (${options.actorTag || options.actorId})`,
        inline: false,
      },
      {
        name: 'Amount',
        value: `**+${options.amount.toLocaleString()} Sparks**`,
        inline: true,
      },
      {
        name: 'Reason',
        value: options.reason,
        inline: false,
      }
    )
    .setTimestamp(new Date(options.timestamp));

  if (isSuccess && (options.newCash !== undefined || options.newTotal !== undefined)) {
    const balances: string[] = [];
    if (options.newCash !== undefined) balances.push(`Cash: **${options.newCash.toLocaleString()}**`);
    if (options.newTotal !== undefined) balances.push(`Total: **${options.newTotal.toLocaleString()}**`);
    embed.addFields({
      name: 'Resulting Balances',
      value: balances.join(' • '),
      inline: false,
    });
  }

  if (!isSuccess && options.error) {
    embed.addFields({
      name: 'Error Details',
      value: options.error,
      inline: false,
    });
  }

  try {
    await (modLogsChannel as any).send({ embeds: [embed] });
  } catch (logErr) {
    console.warn('Failed to send audit log to #mod-logs:', logErr);
  }
}

// Default singleton instance
export const defaultUnbelievaBoatClient = new UnbelievaBoatClient();
