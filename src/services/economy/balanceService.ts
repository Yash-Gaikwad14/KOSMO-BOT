/**
 * /balance Sparks Economy & Visibility Business Service
 *
 * Scope:
 *   - Read-only balance retrieval from UnbelievaBoat.
 *   - Enforces a per-user query cooldown (rate-limiting) to prevent upstream API abuse.
 *   - Evaluates caller High-Karma tier status.
 *   - Reports current in-process daily Sparks claim eligibility.
 *   - Invariant: Read-only operation. NEVER mutates user balance or currency ledger.
 */

import {
  IUnbelievaBoatClient,
  defaultUnbelievaBoatClient,
} from './unbelievaboatClient';
import {
  isHighKarmaMember,
  checkDailyEligibility,
} from './dailyService';

export const BALANCE_COOLDOWN_MS = 10 * 1000; // 10-second per-user query rate limit

export interface UserBalanceData {
  cash: number;
  bank: number;
  total: number;
}

export interface BalanceResult {
  success: boolean;
  onCooldown?: boolean;
  remainingMs?: number;
  balance?: UserBalanceData;
  isHighKarma: boolean;
  dailyEligible: boolean;
  dailyNextClaimAt?: Date;
  error?: string;
  message?: string;
}

import { cache, redisKeys, REDIS_TTL } from '../cache';

// In-memory rate-limit mirror keyed by userId for tests
const balanceCooldowns = new Map<string, Date>();

/**
 * Checks if a user is on balance-query cooldown.
 */
export function checkBalanceCooldown(userId: string): {
  onCooldown: boolean;
  remainingMs: number;
} {
  const lastQuery = balanceCooldowns.get(userId);
  if (!lastQuery) {
    return { onCooldown: false, remainingMs: 0 };
  }

  const elapsed = Date.now() - lastQuery.getTime();
  if (elapsed < BALANCE_COOLDOWN_MS) {
    return {
      onCooldown: true,
      remainingMs: BALANCE_COOLDOWN_MS - elapsed,
    };
  }

  return { onCooldown: false, remainingMs: 0 };
}

/**
 * Retrieves the user's Sparks balance, tier, and daily claim status.
 *
 * 1. Checks per-user query rate-limit cooldown via atomic Redis rate-limiter.
 * 2. Determines High-Karma tier.
 * 3. Checks daily claim eligibility.
 * 4. Calls UnbelievaBoat client for balance (read-only).
 * 5. Updates user rate-limit cooldown on query.
 */
export async function getUserBalanceInfo(
  userId: string,
  guildId: string,
  callerRoleIds: string[],
  client: IUnbelievaBoatClient = defaultUnbelievaBoatClient
): Promise<BalanceResult> {
  const isHighKarma = isHighKarmaMember(callerRoleIds);

  // 1. Enforce query rate limit via Redis atomic rate limiter
  const rl = await cache.checkAndIncrementRateLimit(
    redisKeys.balanceRateLimit(userId),
    1,
    REDIS_TTL.BALANCE_RATELIMIT
  );
  if (!rl.allowed) {
    const ttl = await cache.ttl(redisKeys.balanceRateLimit(userId));
    const remainingMs = Math.max(1000, ttl > 0 ? ttl * 1000 : BALANCE_COOLDOWN_MS);
    const secondsRemaining = Math.max(1, Math.ceil(remainingMs / 1000));
    return {
      success: false,
      onCooldown: true,
      remainingMs,
      isHighKarma,
      dailyEligible: false,
      message: `You are checking balance too quickly. Please wait **${secondsRemaining}s** before querying again.`,
    };
  }

  // Also update in-memory mirror
  balanceCooldowns.set(userId, new Date());

  // 2. Check current in-process daily claim eligibility
  const dailyStatus = checkDailyEligibility(userId);

  // 3. Fetch balance from UnbelievaBoat (read-only GET)
  const ubbResponse = await client.getUserBalance(guildId, userId);

  if (!ubbResponse.success) {
    return {
      success: false,
      onCooldown: false,
      isHighKarma,
      dailyEligible: dailyStatus.eligible,
      dailyNextClaimAt: dailyStatus.nextClaimAt,
      error: ubbResponse.error || 'Failed to retrieve balance from economy provider.',
      message: `Could not retrieve balance: ${ubbResponse.error || 'Unknown error'}`,
    };
  }

  // 4. Record query cooldown on completed lookup
  balanceCooldowns.set(userId, new Date());

  // 5. Parse balance numbers safely
  const rawData = ubbResponse.data;
  const cash = typeof rawData?.cash === 'number' && Number.isFinite(rawData.cash) ? rawData.cash : 0;
  const bank = typeof rawData?.bank === 'number' && Number.isFinite(rawData.bank) ? rawData.bank : 0;
  const total = typeof rawData?.total === 'number' && Number.isFinite(rawData.total)
    ? rawData.total
    : cash + bank;

  return {
    success: true,
    balance: {
      cash,
      bank,
      total,
    },
    isHighKarma,
    dailyEligible: dailyStatus.eligible,
    dailyNextClaimAt: dailyStatus.nextClaimAt,
  };
}

/**
 * Resets balance cooldowns for testing.
 */
export function _resetBalanceCooldowns(): void {
  balanceCooldowns.clear();
}

/**
 * Manually sets a cooldown entry for testing.
 */
export function _setBalanceCooldown(userId: string, timestamp: Date): void {
  balanceCooldowns.set(userId, timestamp);
}
