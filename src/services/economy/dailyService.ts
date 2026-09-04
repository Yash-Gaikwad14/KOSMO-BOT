/**
 * /daily Sparks Economy & Cooldown Business Service
 *
 * Scope:
 *   - Enforces the 24-hour daily claim cooldown window.
 *   - Deterministically calculates Sparks rewards based on Arcane High-Karma role status.
 *   - Orchestrates balance synchronization via UnbelievaBoat.
 *   - Invariant: Cooldown is NEVER consumed if external economy synchronization fails.
 *   - Invariant: KOSMO-BOT maintains NO local competing balance ledger.
 */

import {
  IUnbelievaBoatClient,
  defaultUnbelievaBoatClient,
} from './unbelievaboatClient';

export const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
export const SPARKS_NORMAL = 500;
export const SPARKS_HIGH_KARMA = 2000;

export interface DailyClaimResult {
  success: boolean;
  onCooldown?: boolean;
  sparksAwarded: number;
  isHighKarma: boolean;
  message: string;
  nextClaimAt?: Date;
  remainingMs?: number;
  error?: string;
}

export interface CooldownEntry {
  lastClaimedAt: Date;
  totalClaims: number;
}

// In-memory cooldown store keyed by userId
const dailyCooldowns = new Map<string, CooldownEntry>();

/**
 * Checks whether the member has the approved High-Karma role.
 * Sourced strictly from configuration (process.env.HIGH_KARMA_ROLE_ID).
 * KOSMO-BOT never grants or infers this role.
 */
export function isHighKarmaMember(roleIds: string[] | undefined | null): boolean {
  const highKarmaRoleId = process.env.HIGH_KARMA_ROLE_ID;
  if (!highKarmaRoleId || !Array.isArray(roleIds) || roleIds.length === 0) {
    return false;
  }
  return roleIds.includes(highKarmaRoleId);
}

/**
 * Formats a millisecond duration into human-readable hours, minutes, and seconds.
 */
export function formatRemainingTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(' ');
}

/**
 * Checks user cooldown status without performing mutations.
 */
export function checkDailyEligibility(userId: string): {
  eligible: boolean;
  remainingMs: number;
  nextClaimAt?: Date;
} {
  const entry = dailyCooldowns.get(userId);
  if (!entry) {
    return { eligible: true, remainingMs: 0 };
  }

  const now = Date.now();
  const elapsed = now - entry.lastClaimedAt.getTime();
  if (elapsed < DAILY_COOLDOWN_MS) {
    const remainingMs = DAILY_COOLDOWN_MS - elapsed;
    const nextClaimAt = new Date(entry.lastClaimedAt.getTime() + DAILY_COOLDOWN_MS);
    return { eligible: false, remainingMs, nextClaimAt };
  }

  return { eligible: true, remainingMs: 0 };
}

/**
 * Executes a daily claim for a user.
 *
 * 1. Verifies 24-hour cooldown.
 * 2. Determines High-Karma tier.
 * 3. Coordinates with UnbelievaBoat to grant Sparks.
 * 4. Only records cooldown after verified economy synchronization.
 */
export async function claimDaily(
  userId: string,
  guildId: string,
  callerRoleIds: string[],
  client: IUnbelievaBoatClient = defaultUnbelievaBoatClient
): Promise<DailyClaimResult> {
  const isHighKarma = isHighKarmaMember(callerRoleIds);

  // 1. Check Cooldown
  const eligibility = checkDailyEligibility(userId);
  if (!eligibility.eligible) {
    const remainingFormatted = formatRemainingTime(eligibility.remainingMs);
    const unixNext = Math.floor(eligibility.nextClaimAt!.getTime() / 1000);

    return {
      success: false,
      onCooldown: true,
      sparksAwarded: 0,
      isHighKarma,
      remainingMs: eligibility.remainingMs,
      nextClaimAt: eligibility.nextClaimAt,
      message: `You have already claimed your daily Sparks. Come back in **${remainingFormatted}** (available <t:${unixNext}:R>).`,
    };
  }

  // 2. Calculate Sparks Reward
  const sparksAwarded = isHighKarma ? SPARKS_HIGH_KARMA : SPARKS_NORMAL;
  const tierDescription = isHighKarma ? 'High-Karma Tier' : 'Standard Tier';
  const reason = `Kosmo daily Sparks allowance (${tierDescription})`;

  // 3. Dispatch to UnbelievaBoat External Economy Provider
  const ubbResponse = await client.grantSparks(guildId, userId, sparksAwarded, reason);

  if (!ubbResponse.success) {
    // CRITICAL: Do NOT record cooldown on failure!
    return {
      success: false,
      onCooldown: false,
      sparksAwarded: 0,
      isHighKarma,
      error: ubbResponse.error || 'Economy synchronization failed',
      message: `Encountered an issue crediting Sparks to UnbelievaBoat: ${ubbResponse.error || 'Unknown error'}. Your daily claim was not consumed. Please try again shortly.`,
    };
  }

  // 4. Update In-Memory Cooldown only after verified success
  const now = new Date();
  const existing = dailyCooldowns.get(userId);
  dailyCooldowns.set(userId, {
    lastClaimedAt: now,
    totalClaims: (existing?.totalClaims ?? 0) + 1,
  });

  const nextClaimAt = new Date(now.getTime() + DAILY_COOLDOWN_MS);

  return {
    success: true,
    sparksAwarded,
    isHighKarma,
    nextClaimAt,
    message: isHighKarma
      ? `⚡ **Daily Sparks Claimed!**\nAwarded **+${sparksAwarded.toLocaleString()} Sparks** (High-Karma Tier) to <@${userId}>.\nThanks for your active community contributions!`
      : `🪙 **Daily Sparks Claimed!**\nAwarded **+${sparksAwarded.toLocaleString()} Sparks** (Standard Tier) to <@${userId}>.\n*Tip: Level up your Karma in the server to unlock the **2,000 Sparks/day** High-Karma tier.*`,
  };
}

/**
 * Resets cooldowns for test environments.
 */
export function _resetDailyCooldowns(): void {
  dailyCooldowns.clear();
}

/**
 * Manually sets a cooldown entry for testing.
 */
export function _setDailyCooldown(userId: string, lastClaimedAt: Date, totalClaims = 1): void {
  dailyCooldowns.set(userId, { lastClaimedAt, totalClaims });
}
