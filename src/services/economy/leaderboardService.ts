/**
 * /leaderboard Sparks Economy Leaderboard Business Service
 *
 * Scope:
 *   - Read-only guild leaderboard retrieval from UnbelievaBoat.
 *   - Enforces a per-user query cooldown (10s) to prevent spam.
 *   - Short-lived in-memory caching (60s TTL) to prevent upstream API throttling.
 *   - Normalizes both array and paginated object responses defensively.
 *   - Invariant: Read-only operation. NEVER mutates user balance, roles, or currency ledger.
 */

import {
  IUnbelievaBoatClient,
  defaultUnbelievaBoatClient,
} from './unbelievaboatClient';
import { cache, redisKeys, REDIS_TTL } from '../cache';

export const LEADERBOARD_COOLDOWN_MS = 10 * 1000; // 10-second per-user query rate limit
export const LEADERBOARD_CACHE_TTL_MS = 60 * 1000; // 60-second in-memory cache TTL
export const LEADERBOARD_PAGE_LIMIT = 10; // Max 10 entries per page

export type LeaderboardSort = 'total' | 'cash' | 'bank';

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  cash: number;
  bank: number;
  total: number;
}

export interface LeaderboardResult {
  success: boolean;
  onCooldown?: boolean;
  remainingMs?: number;
  sort: LeaderboardSort;
  page: number;
  totalPages?: number;
  entries: LeaderboardEntry[];
  cached?: boolean;
  error?: string;
  message?: string;
}

interface CacheEntry {
  data: LeaderboardResult;
  expiresAt: number;
}

// In-memory rate-limit map keyed by userId
const leaderboardCooldowns = new Map<string, Date>();

// In-memory cache map keyed by `${guildId}:${sort}:${page}`
const leaderboardCache = new Map<string, CacheEntry>();

/**
 * Checks if a user is on query cooldown.
 */
export function checkLeaderboardCooldown(userId: string): {
  onCooldown: boolean;
  remainingMs: number;
} {
  const lastQuery = leaderboardCooldowns.get(userId);
  if (!lastQuery) {
    return { onCooldown: false, remainingMs: 0 };
  }

  const elapsed = Date.now() - lastQuery.getTime();
  if (elapsed < LEADERBOARD_COOLDOWN_MS) {
    return {
      onCooldown: true,
      remainingMs: LEADERBOARD_COOLDOWN_MS - elapsed,
    };
  }

  return { onCooldown: false, remainingMs: 0 };
}

/**
 * Normalizes raw UnbelievaBoat leaderboard response data.
 */
export function normalizeLeaderboardResponse(
  rawData: any,
  page: number,
  limit: number = LEADERBOARD_PAGE_LIMIT
): { entries: LeaderboardEntry[]; totalPages?: number } {
  if (!rawData || typeof rawData !== 'object') {
    return { entries: [], totalPages: undefined };
  }

  const rawUsers = Array.isArray(rawData)
    ? rawData
    : Array.isArray(rawData?.users)
    ? rawData.users
    : [];

  const totalPages =
    typeof rawData?.total_pages === 'number' && Number.isFinite(rawData.total_pages) && rawData.total_pages > 0
      ? rawData.total_pages
      : undefined;

  const entries: LeaderboardEntry[] = [];

  for (let index = 0; index < rawUsers.length; index++) {
    const item = rawUsers[index];
    if (!item || typeof item !== 'object') continue;

    const rawUserId = item.user_id ?? item.userId;
    // Validate Discord user ID format (non-empty string of 17-20 digits)
    if (typeof rawUserId !== 'string' || !/^\d{17,20}$/.test(rawUserId.trim())) {
      continue;
    }
    const userId = rawUserId.trim();

    const cash =
      typeof item.cash === 'number' && Number.isFinite(item.cash) ? item.cash : 0;
    const bank =
      typeof item.bank === 'number' && Number.isFinite(item.bank) ? item.bank : 0;
    const total =
      typeof item.total === 'number' && Number.isFinite(item.total)
        ? item.total
        : cash + bank;

    const rank =
      typeof item.rank === 'number' && Number.isFinite(item.rank) && item.rank > 0
        ? item.rank
        : (page - 1) * limit + index + 1;

    entries.push({
      rank,
      userId,
      cash,
      bank,
      total,
    });

    if (entries.length >= limit) {
      break;
    }
  }

  return { entries, totalPages };
}

/**
 * Retrieves the guild leaderboard with caching and rate limiting.
 *
 * @param userId Requesting user ID (for cooldown tracking)
 * @param guildId Target guild ID
 * @param requestedSort 'total' | 'cash' | 'bank' (default: 'total')
 * @param requestedPage 1-indexed page number (min: 1, max: 10, default: 1)
 * @param client Injected UnbelievaBoat client
 */
export async function getLeaderboard(
  userId: string,
  guildId: string,
  requestedSort: LeaderboardSort = 'total',
  requestedPage = 1,
  client: IUnbelievaBoatClient = defaultUnbelievaBoatClient
): Promise<LeaderboardResult> {
  // 1. Validate inputs
  if (!guildId || typeof guildId !== 'string' || guildId.trim().length === 0) {
    return {
      success: false,
      sort: 'total',
      page: 1,
      entries: [],
      error: 'Guild ID is required.',
      message: 'A valid server is required to view the leaderboard.',
    };
  }

  const sort: LeaderboardSort = ['total', 'cash', 'bank'].includes(requestedSort)
    ? requestedSort
    : 'total';

  const page = Math.max(1, Math.min(10, Math.floor(requestedPage || 1)));


  // 2. Enforce per-user query rate-limiting via Redis atomic rate limiter
  const rl = await cache.checkAndIncrementRateLimit(
    redisKeys.leaderboardRateLimit(userId),
    1,
    REDIS_TTL.LEADERBOARD_RATELIMIT
  );
  if (!rl.allowed) {
    const ttl = await cache.ttl(redisKeys.leaderboardRateLimit(userId));
    const remainingMs = Math.max(1000, ttl > 0 ? ttl * 1000 : LEADERBOARD_COOLDOWN_MS);
    const secondsRemaining = Math.max(1, Math.ceil(remainingMs / 1000));
    return {
      success: false,
      onCooldown: true,
      remainingMs,
      sort,
      page,
      entries: [],
      message: `You are checking the leaderboard too quickly. Please wait **${secondsRemaining}s** before querying again.`,
    };
  }

  // Record user query cooldown in memory mirror
  leaderboardCooldowns.set(userId, new Date());

  // 3. Check 60-second Redis cache
  const redisCacheKey = redisKeys.leaderboardCache(guildId, sort, page);
  const cachedRedis = await cache.get<LeaderboardResult>(redisCacheKey);
  if (cachedRedis) {
    return {
      ...cachedRedis,
      cached: true,
    };
  }

  // Check fallback local cache
  const cacheKey = `${guildId}:${sort}:${page}`;
  const now = Date.now();
  const cachedEntry = leaderboardCache.get(cacheKey);

  if (cachedEntry && cachedEntry.expiresAt > now) {
    return {
      ...cachedEntry.data,
      cached: true,
    };
  }

  // 4. Fetch fresh data from UnbelievaBoat (read-only GET)
  const ubbResponse = await client.getGuildLeaderboard(
    guildId,
    sort,
    LEADERBOARD_PAGE_LIMIT,
    page
  );

  if (!ubbResponse.success) {
    return {
      success: false,
      onCooldown: false,
      sort,
      page,
      entries: [],
      error: ubbResponse.error || 'Failed to retrieve leaderboard from economy provider.',
      message: `Could not retrieve leaderboard: ${ubbResponse.error || 'Unknown error'}`,
    };
  }

  // 5. Normalize response
  const normalized = normalizeLeaderboardResponse(
    ubbResponse.data,
    page,
    LEADERBOARD_PAGE_LIMIT
  );

  const result: LeaderboardResult = {
    success: true,
    sort,
    page,
    totalPages: normalized.totalPages,
    entries: normalized.entries,
    cached: false,
  };

  // 6. Store in Redis cache (60s TTL) and memory mirror
  await cache.set(redisCacheKey, result, REDIS_TTL.LEADERBOARD_CACHE).catch(() => {});
  leaderboardCache.set(cacheKey, {
    data: result,
    expiresAt: now + LEADERBOARD_CACHE_TTL_MS,
  });

  return result;
}

/**
 * Resets cooldowns for testing.
 */
export function _resetLeaderboardCooldowns(): void {
  leaderboardCooldowns.clear();
  cache.flush().catch(() => {});
}

/**
 * Sets a cooldown entry for testing.
 */
export function _setLeaderboardCooldown(userId: string, timestamp: Date): void {
  leaderboardCooldowns.set(userId, timestamp);
  const elapsed = Date.now() - timestamp.getTime();
  if (elapsed < LEADERBOARD_COOLDOWN_MS) {
    const remainingSec = Math.ceil((LEADERBOARD_COOLDOWN_MS - elapsed) / 1000);
    cache.set(redisKeys.leaderboardRateLimit(userId), { count: 1 }, remainingSec).catch(() => {});
  } else {
    cache.del(redisKeys.leaderboardRateLimit(userId)).catch(() => {});
  }
}

/**
 * Resets cache for testing.
 */
export function _resetLeaderboardCache(): void {
  leaderboardCache.clear();
  cache.flush().catch(() => {});
}

/**
 * Sets a cache entry for testing.
 */
export function _setLeaderboardCache(
  guildId: string,
  sort: LeaderboardSort,
  page: number,
  data: LeaderboardResult,
  ttlMs: number = LEADERBOARD_CACHE_TTL_MS
): void {
  const cacheKey = `${guildId}:${sort}:${page}`;
  leaderboardCache.set(cacheKey, {
    data,
    expiresAt: Date.now() + ttlMs,
  });
  const redisCacheKey = redisKeys.leaderboardCache(guildId, sort, page);
  cache.set(redisCacheKey, data, Math.ceil(ttlMs / 1000)).catch(() => {});
}
