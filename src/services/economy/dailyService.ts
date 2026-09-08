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
import { cache, redisKeys, REDIS_TTL } from '../cache';
import { getDailyClaimRepository } from '../database/dailyClaimRepository';

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

// In-memory test mirror keyed by userId for fast synchronous check & offline test suites
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
 * Synchronous check of user cooldown status from memory mirror.
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
 * Asynchronous check of user cooldown status querying Redis speed layer and PostgreSQL fallback.
 */
export async function checkDailyEligibilityAsync(userId: string): Promise<{
  eligible: boolean;
  remainingMs: number;
  nextClaimAt?: Date;
}> {
  const redisCooldownKey = redisKeys.dailyCooldown(userId);
  const cachedTimeStr = await cache.get<string>(redisCooldownKey);
  let lastClaimTime: Date | null = cachedTimeStr ? new Date(cachedTimeStr) : null;

  if (!lastClaimTime) {
    try {
      const dbClaim = await getDailyClaimRepository().getLastClaim(userId);
      if (dbClaim && Date.now() - dbClaim.claimedAt.getTime() < DAILY_COOLDOWN_MS) {
        lastClaimTime = dbClaim.claimedAt;
        const remainingSec = Math.ceil((DAILY_COOLDOWN_MS - (Date.now() - lastClaimTime.getTime())) / 1000);
        if (remainingSec > 0) {
          await cache.set(redisCooldownKey, lastClaimTime.toISOString(), remainingSec);
        }
      }
    } catch {
      // Non-blocking fallback to local mirror
    }
  }

  if (!lastClaimTime) {
    const localEntry = dailyCooldowns.get(userId);
    if (localEntry) lastClaimTime = localEntry.lastClaimedAt;
  }

  if (lastClaimTime) {
    const elapsed = Date.now() - lastClaimTime.getTime();
    if (elapsed < DAILY_COOLDOWN_MS) {
      const remainingMs = DAILY_COOLDOWN_MS - elapsed;
      const nextClaimAt = new Date(lastClaimTime.getTime() + DAILY_COOLDOWN_MS);
      return { eligible: false, remainingMs, nextClaimAt };
    }
  }

  return { eligible: true, remainingMs: 0 };
}

/**
 * Executes a race-safe daily claim for a user.
 *
 * 1. Acquires distributed Redis lock `lock:user:${userId}:daily_claim` (15s TTL) with unique ownership token.
 * 2. Verifies 24-hour cooldown from Redis speed layer and PostgreSQL recovery ledger.
 * 3. Coordinates with UnbelievaBoat external economy provider to grant Sparks.
 * 4. Invariant: Cooldown is NEVER consumed if UnbelievaBoat fails.
 * 5. On success: sets Redis cooldown key `cooldown:daily:${userId}` (24h TTL) and logs durable PostgreSQL claim.
 * 6. Safely releases lock via atomic Lua ownership check.
 */
export async function claimDaily(
  userId: string,
  guildId: string,
  callerRoleIds: string[],
  client: IUnbelievaBoatClient = defaultUnbelievaBoatClient
): Promise<DailyClaimResult> {
  const isHighKarma = isHighKarmaMember(callerRoleIds);
  const lockKey = redisKeys.dailyClaimLock(userId);

  // 1. Acquire Redis distributed lock with unique ownership token
  const lock = await cache.acquireLock(lockKey, REDIS_TTL.DAILY_CLAIM_LOCK);
  if (!lock.acquired) {
    return {
      success: false,
      onCooldown: true,
      sparksAwarded: 0,
      isHighKarma,
      message: 'Your daily Sparks claim is currently being processed. Please wait a moment.',
    };
  }

  try {
    // 2. Check 24-Hour Cooldown from Redis (speed layer)
    const redisCooldownKey = redisKeys.dailyCooldown(userId);
    const cachedClaimTimeStr = await cache.get<string>(redisCooldownKey);
    let lastClaimTime: Date | null = cachedClaimTimeStr ? new Date(cachedClaimTimeStr) : null;

    // Fail-safe / Restart recovery: If Redis key not found, check PostgreSQL durable claim ledger
    if (!lastClaimTime) {
      try {
        const dbClaim = await getDailyClaimRepository().getLastClaim(userId);
        if (dbClaim && Date.now() - dbClaim.claimedAt.getTime() < DAILY_COOLDOWN_MS) {
          lastClaimTime = dbClaim.claimedAt;
          const remainingSec = Math.ceil((DAILY_COOLDOWN_MS - (Date.now() - lastClaimTime.getTime())) / 1000);
          if (remainingSec > 0) {
            await cache.set(redisCooldownKey, lastClaimTime.toISOString(), remainingSec);
          }
        }
      } catch (dbErr) {
        console.warn('Daily claim PostgreSQL recovery check warning:', dbErr);
      }
    }

    // Also check in-memory test mirror
    if (!lastClaimTime) {
      const localEntry = dailyCooldowns.get(userId);
      if (localEntry && Date.now() - localEntry.lastClaimedAt.getTime() < DAILY_COOLDOWN_MS) {
        lastClaimTime = localEntry.lastClaimedAt;
      }
    }

    if (lastClaimTime) {
      const elapsed = Date.now() - lastClaimTime.getTime();
      if (elapsed < DAILY_COOLDOWN_MS) {
        const remainingMs = DAILY_COOLDOWN_MS - elapsed;
        const nextClaimAt = new Date(lastClaimTime.getTime() + DAILY_COOLDOWN_MS);
        const remainingFormatted = formatRemainingTime(remainingMs);
        const unixNext = Math.floor(nextClaimAt.getTime() / 1000);

        // Update local memory mirror
        dailyCooldowns.set(userId, { lastClaimedAt: lastClaimTime, totalClaims: 1 });

        return {
          success: false,
          onCooldown: true,
          sparksAwarded: 0,
          isHighKarma,
          remainingMs,
          nextClaimAt,
          message: `You have already claimed your daily Sparks. Come back in **${remainingFormatted}** (available <t:${unixNext}:R>).`,
        };
      }
    }

    // 3. Calculate Sparks Reward
    const sparksAwarded = isHighKarma ? SPARKS_HIGH_KARMA : SPARKS_NORMAL;
    const tierDescription = isHighKarma ? 'High-Karma Tier' : 'Standard Tier';
    const reason = `Kosmo daily Sparks allowance (${tierDescription})`;

    // 4. Dispatch to UnbelievaBoat External Economy Provider
    const ubbResponse = await client.grantSparks(guildId, userId, sparksAwarded, reason);

    if (!ubbResponse.success) {
      // Invariant: NEVER record cooldown on failure
      return {
        success: false,
        onCooldown: false,
        sparksAwarded: 0,
        isHighKarma,
        error: ubbResponse.error || 'Economy synchronization failed',
        message: `Encountered an issue crediting Sparks to UnbelievaBoat: ${ubbResponse.error || 'Unknown error'}. Your daily claim was not consumed. Please try again shortly.`,
      };
    }

    // 5. Update Cooldown only after verified success
    const now = new Date();
    const nextClaimAt = new Date(now.getTime() + DAILY_COOLDOWN_MS);

    // Authoritative Redis speed layer write (24h TTL)
    await cache.set(redisCooldownKey, now.toISOString(), REDIS_TTL.DAILY_COOLDOWN);

    // Durable PostgreSQL claim ledger write
    try {
      await getDailyClaimRepository().recordClaim({
        userId,
        guildId,
        sparksAwarded,
        isHighKarma,
        claimedAt: now,
      });
    } catch (err) {
      console.warn('Failed to record daily claim in durable PostgreSQL ledger:', err);
    }

    // Update in-memory mirror
    const existing = dailyCooldowns.get(userId);
    dailyCooldowns.set(userId, {
      lastClaimedAt: now,
      totalClaims: (existing?.totalClaims ?? 0) + 1,
    });

    return {
      success: true,
      sparksAwarded,
      isHighKarma,
      nextClaimAt,
      message: isHighKarma
        ? `⚡ **Daily Sparks Claimed!**\nAwarded **+${sparksAwarded.toLocaleString()} Sparks** (High-Karma Tier) to <@${userId}>.\nThanks for your active community contributions!`
        : `🪙 **Daily Sparks Claimed!**\nAwarded **+${sparksAwarded.toLocaleString()} Sparks** (Standard Tier) to <@${userId}>.\n*Tip: Level up your Karma in the server to unlock the **2,000 Sparks/day** High-Karma tier.*`,
    };
  } finally {
    if (lock.token) {
      await cache.releaseLock(lockKey, lock.token);
    }
  }
}

/**
 * Resets cooldowns for test environments.
 */
export function _resetDailyCooldowns(): void {
  dailyCooldowns.clear();
  cache.flush().catch(() => {});
  try {
    const repo = getDailyClaimRepository();
    if (repo && typeof repo.clear === 'function') {
      repo.clear().catch(() => {});
    }
  } catch {}
}

/**
 * Manually sets a cooldown entry for testing.
 */
export function _setDailyCooldown(userId: string, lastClaimedAt: Date, totalClaims = 1): void {
  dailyCooldowns.set(userId, { lastClaimedAt, totalClaims });
  const elapsed = Date.now() - lastClaimedAt.getTime();
  const remainingSec = Math.max(0, Math.ceil((DAILY_COOLDOWN_MS - elapsed) / 1000));
  if (remainingSec > 0) {
    cache.set(redisKeys.dailyCooldown(userId), lastClaimedAt.toISOString(), remainingSec).catch(() => {});
  } else {
    cache.del(redisKeys.dailyCooldown(userId)).catch(() => {});
    // If expired, clear any stale claim from the repo for test isolation
    try {
      const repo = getDailyClaimRepository();
      if (repo && typeof repo.clear === 'function') {
        repo.clear().catch(() => {});
      }
    } catch {}
  }
}
