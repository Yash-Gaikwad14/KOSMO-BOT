/**
 * /profile Community Profile Business Service
 *
 * Scope:
 *   - Aggregates Discord member role-derived recognition and badges.
 *   - Fetches read-only Sparks balance from UnbelievaBoat.
 *   - Evaluates daily claim eligibility and tier allowance.
 *   - Enforces 10-second per-user profile query rate limiting.
 *   - Invariant: Strictly read-only. NEVER mutates balances, roles, or external bots.
 */

import {
  IUnbelievaBoatClient,
  defaultUnbelievaBoatClient,
} from './unbelievaboatClient';
import {
  isHighKarmaMember,
  checkDailyEligibility,
  SPARKS_NORMAL,
  SPARKS_HIGH_KARMA,
} from './dailyService';
import { extractUserRoleIds } from '../discord/policy';
import { cache, redisKeys, REDIS_TTL } from '../cache';

export const PROFILE_COOLDOWN_MS = 10 * 1000; // 10-second per-user query rate limit

export interface ProfileRecognition {
  badges: string[];
  premiumTier?: string;
  domainRoles: string[];
}

export interface ProfileResult {
  success: boolean;
  onCooldown?: boolean;
  remainingMs?: number;
  userId: string;
  isHighKarma: boolean;
  dailyEligible: boolean;
  dailyNextClaimAt?: Date;
  dailyAllowance: number;
  balance?: {
    cash: number;
    bank: number;
    total: number;
  };
  recognition: ProfileRecognition;
  error?: string;
  message?: string;
}

// In-memory rate-limit map keyed by userId
const profileCooldowns = new Map<string, Date>();

/**
 * Checks if a user is on profile query cooldown.
 */
export function checkProfileCooldown(userId: string): {
  onCooldown: boolean;
  remainingMs: number;
} {
  const lastQuery = profileCooldowns.get(userId);
  if (!lastQuery) {
    return { onCooldown: false, remainingMs: 0 };
  }

  const elapsed = Date.now() - lastQuery.getTime();
  if (elapsed < PROFILE_COOLDOWN_MS) {
    return {
      onCooldown: true,
      remainingMs: PROFILE_COOLDOWN_MS - elapsed,
    };
  }

  return { onCooldown: false, remainingMs: 0 };
}

/**
 * Helper to check whether any role matches a target name or ID.
 */
function hasRole(callerRoles: string[], nameOrId: string): boolean {
  if (!Array.isArray(callerRoles) || callerRoles.length === 0) {
    return false;
  }
  const cleanTarget = nameOrId.toLowerCase().trim();
  return callerRoles.some((r) => {
    if (typeof r !== 'string') return false;
    const clean = r.toLowerCase().trim();
    return clean === cleanTarget;
  });
}

/**
 * Resolves role-based badges, premium tier, and domain roles from caller's roles.
 */
export function resolveMemberRecognition(
  callerRoles: string[],
  isHighKarma: boolean
): ProfileRecognition {
  const badges: string[] = [];

  // 1. Recognition Badges
  if (hasRole(callerRoles, 'Feedback Champion')) {
    badges.push('🏆 Feedback Champion');
  }
  if (hasRole(callerRoles, 'Top Inviter')) {
    badges.push('📨 Top Inviter');
  }
  if (
    hasRole(callerRoles, 'High Roller') ||
    hasRole(callerRoles, 'High Roller / Level 50+')
  ) {
    badges.push('🎰 High Roller');
  }
  if (isHighKarma || hasRole(callerRoles, 'High-Karma User') || hasRole(callerRoles, 'High-Karma')) {
    badges.push('⚡ High-Karma');
  }

  // 2. Premium Tier Precedence (Max > Pro > VIP)
  let premiumTier: string | undefined = undefined;
  if (hasRole(callerRoles, 'Kosmo Max')) {
    premiumTier = '💎 Kosmo Max';
  } else if (hasRole(callerRoles, 'Kosmo Pro')) {
    premiumTier = '💎 Kosmo Pro';
  } else if (hasRole(callerRoles, 'Kosmo VIP')) {
    premiumTier = '💎 Kosmo VIP';
  }

  // 3. Domain Guilds
  const domainRoles: string[] = [];
  if (hasRole(callerRoles, 'Tech & Engineering') || hasRole(callerRoles, 'Tech and Engineering')) {
    domainRoles.push('💻 Tech & Engineering');
  }
  if (hasRole(callerRoles, 'Business & Strategy') || hasRole(callerRoles, 'Business and Strategy')) {
    domainRoles.push('📈 Business & Strategy');
  }
  if (hasRole(callerRoles, 'Academia & Education') || hasRole(callerRoles, 'Academia and Education') || hasRole(callerRoles, 'Academia & Research')) {
    domainRoles.push('🎓 Academia & Education');
  }
  if (hasRole(callerRoles, 'Law & Compliance') || hasRole(callerRoles, 'Law and Compliance') || hasRole(callerRoles, 'Legal & Policy')) {
    domainRoles.push('⚖️ Law & Compliance');
  }
  if (hasRole(callerRoles, 'Creative & Design') || hasRole(callerRoles, 'Creative and Design') || hasRole(callerRoles, 'Creatives Lounge')) {
    domainRoles.push('🎨 Creative & Design');
  }

  return { badges, premiumTier, domainRoles };
}

/**
 * Aggregates member profile information.
 *
 * @param userId User Discord snowflake
 * @param guildId Guild Discord snowflake
 * @param memberOrRoles Member object or array of role strings
 * @param client Injected UnbelievaBoat client
 */
export async function getProfile(
  userId: string,
  guildId: string,
  memberOrRoles: any,
  client: IUnbelievaBoatClient = defaultUnbelievaBoatClient
): Promise<ProfileResult> {
  // 1. Validate inputs
  if (!guildId || typeof guildId !== 'string' || guildId.trim().length === 0) {
    return {
      success: false,
      userId,
      isHighKarma: false,
      dailyEligible: false,
      dailyAllowance: SPARKS_NORMAL,
      recognition: { badges: [], domainRoles: [] },
      error: 'Guild ID is required.',
      message: 'This command can only be used in a server.',
    };
  }

  // 2. Extract roles
  const callerRoles: string[] = Array.isArray(memberOrRoles)
    ? memberOrRoles
    : extractUserRoleIds(memberOrRoles);

  const isHighKarma = isHighKarmaMember(callerRoles);
  const recognition = resolveMemberRecognition(callerRoles, isHighKarma);

  // 3. Check rate limiting via atomic Redis rate limiter
  const rl = await cache.checkAndIncrementRateLimit(
    redisKeys.profileRateLimit(userId),
    1,
    REDIS_TTL.PROFILE_RATELIMIT
  );
  if (!rl.allowed) {
    const ttl = await cache.ttl(redisKeys.profileRateLimit(userId));
    const remainingMs = Math.max(1000, ttl > 0 ? ttl * 1000 : PROFILE_COOLDOWN_MS);
    const secondsRemaining = Math.max(1, Math.ceil(remainingMs / 1000));
    return {
      success: false,
      onCooldown: true,
      remainingMs,
      userId,
      isHighKarma,
      dailyEligible: false,
      dailyAllowance: isHighKarma ? SPARKS_HIGH_KARMA : SPARKS_NORMAL,
      recognition,
      message: `You are checking your profile too quickly. Please wait **${secondsRemaining}s** before querying again.`,
    };
  }

  // Record query timestamp in memory mirror
  profileCooldowns.set(userId, new Date());

  // 4. Daily eligibility & allowance
  const dailyStatus = checkDailyEligibility(userId);
  const dailyAllowance = isHighKarma ? SPARKS_HIGH_KARMA : SPARKS_NORMAL;

  // 5. Fetch balance from UnbelievaBoat (read-only GET)
  const ubbResponse = await client.getUserBalance(guildId, userId);

  if (!ubbResponse.success) {
    return {
      success: false,
      onCooldown: false,
      userId,
      isHighKarma,
      dailyEligible: dailyStatus.eligible,
      dailyNextClaimAt: dailyStatus.nextClaimAt,
      dailyAllowance,
      recognition,
      error: ubbResponse.error || 'Failed to retrieve balance from economy provider.',
      message: `Could not retrieve economy details: ${ubbResponse.error || 'Unknown error'}`,
    };
  }

  // 6. Defensive balance parsing
  const rawData = ubbResponse.data;
  const cash =
    typeof rawData?.cash === 'number' && Number.isFinite(rawData.cash) ? rawData.cash : 0;
  const bank =
    typeof rawData?.bank === 'number' && Number.isFinite(rawData.bank) ? rawData.bank : 0;
  const total =
    typeof rawData?.total === 'number' && Number.isFinite(rawData.total)
      ? rawData.total
      : cash + bank;

  return {
    success: true,
    userId,
    isHighKarma,
    dailyEligible: dailyStatus.eligible,
    dailyNextClaimAt: dailyStatus.nextClaimAt,
    dailyAllowance,
    balance: {
      cash,
      bank,
      total,
    },
    recognition,
  };
}

/**
 * Resets cooldowns for testing.
 */
export function _resetProfileCooldowns(): void {
  profileCooldowns.clear();
}

/**
 * Sets a cooldown entry for testing.
 */
export function _setProfileCooldown(userId: string, timestamp: Date): void {
  profileCooldowns.set(userId, timestamp);
}
