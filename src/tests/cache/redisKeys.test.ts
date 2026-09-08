import { redisKeys, REDIS_TTL } from '../../services/cache/redisKeys';
import { cache } from '../../services/cache';

describe('H-09 Redis Key & TTL Centralization', () => {
  describe('Authoritative Key Builders', () => {
    test('constructs exact distributed lock keys', () => {
      expect(redisKeys.dailyClaimLock('user-123')).toBe('lock:user:user-123:daily_claim');
      expect(redisKeys.premiumSyncLock('guild-456', 'user-789')).toBe(
        'lock:member:guild-456:user-789:premium_sync'
      );
      expect(redisKeys.moderationLock('guild-456:user-789')).toBe(
        'lock:member:guild-456:user-789:mod'
      );
      expect(redisKeys.proposalExecLock('guild-456')).toBe('lock:guild:guild-456:proposal_exec');
    });

    test('constructs exact cooldown and rate-limiting keys', () => {
      expect(redisKeys.dailyCooldown('user-123')).toBe('cooldown:daily:user-123');
      expect(redisKeys.staffProposalCooldown('user-123')).toBe('cooldown:staff:user-123:proposal');
      expect(redisKeys.summarizeRateLimit('user-123')).toBe('ratelimit:summarize:user-123');
      expect(redisKeys.balanceRateLimit('user-123')).toBe('ratelimit:balance:user-123');
      expect(redisKeys.profileRateLimit('user-123')).toBe('ratelimit:profile:user-123');
      expect(redisKeys.leaderboardRateLimit('user-123')).toBe('ratelimit:leaderboard:user-123');
    });

    test('constructs exact state and cache keys', () => {
      expect(redisKeys.modAction('action-abc')).toBe('mod_action:action-abc');
      expect(redisKeys.plan('plan-xyz')).toBe('plan:plan-xyz');
      expect(redisKeys.proposal('plan-xyz')).toBe('proposal:plan-xyz');
      expect(redisKeys.guildProposals('guild-456')).toBe('proposals:guild:guild-456');
      expect(redisKeys.leaderboardCache('guild-456', 'total', 1)).toBe(
        'cache:ubb:leaderboard:guild-456:total:1'
      );
      expect(redisKeys.leaderboardCache('guild-456', 'cash', 2)).toBe(
        'cache:ubb:leaderboard:guild-456:cash:2'
      );
    });
  });

  describe('Isolation & Tenant Safety', () => {
    test('enforces strict guild and target isolation in locks', () => {
      const lockA = redisKeys.premiumSyncLock('guild-1', 'user-A');
      const lockB = redisKeys.premiumSyncLock('guild-2', 'user-A');
      const lockC = redisKeys.premiumSyncLock('guild-1', 'user-B');

      expect(lockA).not.toBe(lockB);
      expect(lockA).not.toBe(lockC);
      expect(lockB).not.toBe(lockC);
    });

    test('enforces strict user isolation in cooldowns and rate limits', () => {
      const cd1 = redisKeys.dailyCooldown('user-1');
      const cd2 = redisKeys.dailyCooldown('user-2');
      expect(cd1).not.toBe(cd2);

      const rl1 = redisKeys.balanceRateLimit('user-1');
      const rl2 = redisKeys.balanceRateLimit('user-2');
      expect(rl1).not.toBe(rl2);
    });

    test('enforces parameter isolation in leaderboard cache keys', () => {
      const k1 = redisKeys.leaderboardCache('g1', 'total', 1);
      const k2 = redisKeys.leaderboardCache('g1', 'total', 2);
      const k3 = redisKeys.leaderboardCache('g1', 'bank', 1);
      const k4 = redisKeys.leaderboardCache('g2', 'total', 1);

      const set = new Set([k1, k2, k3, k4]);
      expect(set.size).toBe(4);
    });
  });

  describe('Authoritative TTL Constants', () => {
    test('verifies all TTL constant values match production specifications', () => {
      expect(REDIS_TTL.DAILY_CLAIM_LOCK).toBe(15);
      expect(REDIS_TTL.DAILY_COOLDOWN).toBe(86400);
      expect(REDIS_TTL.PREMIUM_SYNC_LOCK).toBe(15);
      expect(REDIS_TTL.MODERATION_LOCK).toBe(15);
      expect(REDIS_TTL.MOD_CONFIRMATION).toBe(300);
      expect(REDIS_TTL.MOD_CONFIRMATION_TERMINAL).toBe(60);
      expect(REDIS_TTL.PLAN).toBe(900);
      expect(REDIS_TTL.PLAN_TERMINAL).toBe(60);
      expect(REDIS_TTL.PROPOSAL_EXEC_LOCK).toBe(60);
      expect(REDIS_TTL.STAFF_PROPOSAL_COOLDOWN).toBe(60);
      expect(REDIS_TTL.SUMMARIZE_RATELIMIT).toBe(30);
      expect(REDIS_TTL.BALANCE_RATELIMIT).toBe(10);
      expect(REDIS_TTL.PROFILE_RATELIMIT).toBe(10);
      expect(REDIS_TTL.LEADERBOARD_RATELIMIT).toBe(10);
      expect(REDIS_TTL.LEADERBOARD_CACHE).toBe(60);
    });
  });

  describe('Cache Coordination with Centralized Keys', () => {
    test('acquireLock and releaseLock succeed with centralized keys', async () => {
      const lockKey = redisKeys.dailyClaimLock('test-user-lock');
      const lock = await cache.acquireLock(lockKey, REDIS_TTL.DAILY_CLAIM_LOCK);
      expect(lock.acquired).toBe(true);
      expect(lock.token).toBeDefined();

      const released = await cache.releaseLock(lockKey, lock.token!);
      expect(released).toBe(true);
    });

    test('rate limit and cooldown operations succeed with centralized keys', async () => {
      const key = redisKeys.balanceRateLimit('test-user-rl');
      const rl = await cache.checkAndIncrementRateLimit(key, 1, REDIS_TTL.BALANCE_RATELIMIT);
      expect(rl.allowed).toBe(true);

      const cachedKey = redisKeys.leaderboardCache('g-test', 'total', 1);
      await cache.set(cachedKey, { test: true }, REDIS_TTL.LEADERBOARD_CACHE);
      const retrieved = await cache.get<{ test: boolean }>(cachedKey);
      expect(retrieved).toEqual({ test: true });

      await cache.del(cachedKey);
      const afterDel = await cache.get(cachedKey);
      expect(afterDel).toBeNull();
    });
  });
});
