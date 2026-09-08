// src/services/cache/redisKeys.ts
/**
 * Authoritative Centralized Redis Key Builders and TTL Constants.
 * Hardened under H-09:
 * - Eliminates scattered string templates and hardcoded numbers across services
 * - Guarantees strict tenant and user isolation
 * - Preserves EXACT production key namespaces, formats, and TTL values
 */

/**
 * Authoritative TTL constants in seconds.
 */
export const REDIS_TTL = {
  /** Distributed lock for user daily claim coordination (15s) */
  DAILY_CLAIM_LOCK: 15,
  /** 24-hour speed-layer cooldown timestamp for daily claims (86400s) */
  DAILY_COOLDOWN: 86400,
  /** Distributed lock for member premium role synchronization (15s) */
  PREMIUM_SYNC_LOCK: 15,
  /** Distributed lock for moderation strike issuance on a member (15s) */
  MODERATION_LOCK: 15,
  /** Ephemeral pending moderation action confirmation window (300s / 5m) */
  MOD_CONFIRMATION: 300,
  /** Post-decision/terminal moderation action state retention (60s) */
  MOD_CONFIRMATION_TERMINAL: 60,
  /** Ephemeral pending Discord action plan confirmation window (900s / 15m) */
  PLAN: 900,
  /** Expired plan state retention in Redis cache (60s) */
  PLAN_TERMINAL: 60,
  /** Distributed lock for proposal execution within a guild (60s) */
  PROPOSAL_EXEC_LOCK: 60,
  /** Cooldown window between staff community proposal creations (60s) */
  STAFF_PROPOSAL_COOLDOWN: 60,
  /** Rate limit window for AI channel summarization requests (30s) */
  SUMMARIZE_RATELIMIT: 30,
  /** Rate limit window for economy balance queries (10s) */
  BALANCE_RATELIMIT: 10,
  /** Rate limit window for member profile queries (10s) */
  PROFILE_RATELIMIT: 10,
  /** Rate limit window for economy leaderboard queries (10s) */
  LEADERBOARD_RATELIMIT: 10,
  /** Cache TTL for external UnbelievaBoat leaderboard pages (60s) */
  LEADERBOARD_CACHE: 60,
} as const;

/**
 * Authoritative Redis key builder functions.
 * All functions return exact, deterministic key strings matching production specifications.
 */
export const redisKeys = {
  // ── Distributed Locks ────────────────────────────────────────────────────────
  dailyClaimLock: (userId: string): string => `lock:user:${userId}:daily_claim`,
  premiumSyncLock: (guildId: string, targetId: string): string =>
    `lock:member:${guildId}:${targetId}:premium_sync`,
  moderationLock: (memberKey: string): string => `lock:member:${memberKey}:mod`,
  proposalExecLock: (guildId: string): string => `lock:guild:${guildId}:proposal_exec`,

  // ── Cooldowns & Rate Limits ──────────────────────────────────────────────────
  dailyCooldown: (userId: string): string => `cooldown:daily:${userId}`,
  staffProposalCooldown: (userId: string): string => `cooldown:staff:${userId}:proposal`,
  summarizeRateLimit: (userId: string): string => `ratelimit:summarize:${userId}`,
  balanceRateLimit: (userId: string): string => `ratelimit:balance:${userId}`,
  profileRateLimit: (userId: string): string => `ratelimit:profile:${userId}`,
  leaderboardRateLimit: (userId: string): string => `ratelimit:leaderboard:${userId}`,

  // ── Ephemeral State & Cache ──────────────────────────────────────────────────
  modAction: (actionId: string): string => `mod_action:${actionId}`,
  plan: (planId: string): string => `plan:${planId}`,
  proposal: (planId: string): string => `proposal:${planId}`,
  guildProposals: (guildId: string): string => `proposals:guild:${guildId}`,
  leaderboardCache: (guildId: string, sort: string, page: number | string): string =>
    `cache:ubb:leaderboard:${guildId}:${sort}:${page}`,
} as const;
