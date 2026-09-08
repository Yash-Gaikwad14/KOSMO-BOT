import {
  getLeaderboard,
  normalizeLeaderboardResponse,
  _resetLeaderboardCooldowns,
  _setLeaderboardCooldown,
  _resetLeaderboardCache,
  _setLeaderboardCache,
  LEADERBOARD_COOLDOWN_MS,
  LEADERBOARD_CACHE_TTL_MS,
} from '../../services/economy/leaderboardService';
import {
  IUnbelievaBoatClient,
  UnbelievaBoatResponse,
} from '../../services/economy/unbelievaboatClient';

describe('Leaderboard Service', () => {
  let mockClient: jest.Mocked<IUnbelievaBoatClient>;

  beforeEach(() => {
    _resetLeaderboardCooldowns();
    _resetLeaderboardCache();

    mockClient = {
      grantSparks: jest.fn().mockResolvedValue({
        success: true,
        status: 200,
        data: { cash: 500 },
      } as UnbelievaBoatResponse),
      getUserBalance: jest.fn().mockResolvedValue({
        success: true,
        status: 200,
        data: { cash: 100, bank: 200, total: 300 },
      } as UnbelievaBoatResponse),
      getGuildLeaderboard: jest.fn().mockResolvedValue({
        success: true,
        status: 200,
        data: [
          { rank: 1, user_id: '111111111111111111', cash: 5000, bank: 15000, total: 20000 },
          { rank: 2, user_id: '222222222222222222', cash: 3000, bank: 7000, total: 10000 },
          { rank: 3, user_id: '333333333333333333', cash: 1000, bank: 4000, total: 5000 },
        ],
      } as UnbelievaBoatResponse),
    };
  });

  describe('Leaderboard Querying & Sorting', () => {
    test('retrieves default total sparks leaderboard', async () => {
      const result = await getLeaderboard('user-1', 'guild-1', 'total', 1, mockClient);

      expect(result.success).toBe(true);
      expect(result.sort).toBe('total');
      expect(result.page).toBe(1);
      expect(result.entries).toHaveLength(3);
      expect(result.entries[0].userId).toBe('111111111111111111');
      expect(result.entries[0].total).toBe(20000);
      expect(mockClient.getGuildLeaderboard).toHaveBeenCalledWith('guild-1', 'total', 10, 1);
      expect(mockClient.grantSparks).not.toHaveBeenCalled();
    });

    test('supports cash sort mode', async () => {
      const result = await getLeaderboard('user-1', 'guild-1', 'cash', 1, mockClient);

      expect(result.success).toBe(true);
      expect(result.sort).toBe('cash');
      expect(mockClient.getGuildLeaderboard).toHaveBeenCalledWith('guild-1', 'cash', 10, 1);
    });

    test('supports bank sort mode', async () => {
      const result = await getLeaderboard('user-1', 'guild-1', 'bank', 1, mockClient);

      expect(result.success).toBe(true);
      expect(result.sort).toBe('bank');
      expect(mockClient.getGuildLeaderboard).toHaveBeenCalledWith('guild-1', 'bank', 10, 1);
    });

    test('falls back to total sort if invalid sort is requested', async () => {
      const result = await getLeaderboard('user-1', 'guild-1', 'invalid' as any, 1, mockClient);

      expect(result.success).toBe(true);
      expect(result.sort).toBe('total');
      expect(mockClient.getGuildLeaderboard).toHaveBeenCalledWith('guild-1', 'total', 10, 1);
    });

    test('clamps page numbers to range [1, 10]', async () => {
      await getLeaderboard('user-1', 'guild-1', 'total', 0, mockClient);
      expect(mockClient.getGuildLeaderboard).toHaveBeenCalledWith('guild-1', 'total', 10, 1);

      _resetLeaderboardCooldowns();
      await getLeaderboard('user-1', 'guild-1', 'total', 99, mockClient);
      expect(mockClient.getGuildLeaderboard).toHaveBeenCalledWith('guild-1', 'total', 10, 10);
    });
  });

  describe('Response Normalization & Parsing', () => {
    test('normalizes array response and preserves ranks', () => {
      const raw = [
        { rank: 1, user_id: '111111111111111111', cash: 100, bank: 200, total: 300 },
        { rank: 2, user_id: '222222222222222222', cash: 50, bank: 50, total: 100 },
      ];

      const res = normalizeLeaderboardResponse(raw, 1);
      expect(res.entries).toHaveLength(2);
      expect(res.entries[0].rank).toBe(1);
      expect(res.entries[1].rank).toBe(2);
      expect(res.totalPages).toBeUndefined();
    });

    test('normalizes paginated object response with total_pages', () => {
      const raw = {
        users: [
          { rank: 1, user_id: '111111111111111111', cash: 100, bank: 200, total: 300 },
        ],
        total_pages: 8,
      };

      const res = normalizeLeaderboardResponse(raw, 1);
      expect(res.entries).toHaveLength(1);
      expect(res.totalPages).toBe(8);
    });

    test('derives rank from page position when rank is absent', () => {
      const raw = [
        { user_id: '111111111111111111', cash: 100, bank: 200, total: 300 },
        { user_id: '222222222222222222', cash: 50, bank: 50, total: 100 },
      ];

      // Page 2, limit 10: ranks should be 11 and 12
      const res = normalizeLeaderboardResponse(raw, 2, 10);
      expect(res.entries[0].rank).toBe(11);
      expect(res.entries[1].rank).toBe(12);
    });

    test('calculates total dynamically if total is absent', () => {
      const raw = [
        { rank: 1, user_id: '111111111111111111', cash: 700, bank: 800 },
      ];

      const res = normalizeLeaderboardResponse(raw, 1);
      expect(res.entries[0].total).toBe(1500); // 700 + 800
    });

    test('skips malformed entries and invalid user IDs safely', () => {
      const raw = [
        null,
        {},
        { user_id: 'invalid-string', cash: 100 },
        { user_id: '111111111111111111', cash: 500, bank: 500, total: 1000 },
      ];

      const res = normalizeLeaderboardResponse(raw, 1);
      expect(res.entries).toHaveLength(1);
      expect(res.entries[0].userId).toBe('111111111111111111');
    });

    test('enforces maximum 10 entries limit', () => {
      const raw = Array.from({ length: 15 }, (_, i) => ({
        rank: i + 1,
        user_id: `11111111111111111${i}`,
        cash: 100,
        bank: 100,
        total: 200,
      }));

      const res = normalizeLeaderboardResponse(raw, 1, 10);
      expect(res.entries).toHaveLength(10);
    });
  });

  describe('In-Memory 60-Second Cache', () => {
    test('serves repeated requests within 60s TTL from cache without calling provider', async () => {
      // First query calls provider
      const first = await getLeaderboard('user-1', 'guild-1', 'total', 1, mockClient);
      expect(first.success).toBe(true);
      expect(first.cached).toBe(false);
      expect(mockClient.getGuildLeaderboard).toHaveBeenCalledTimes(1);

      // Reset user cooldown so user-2 queries
      const second = await getLeaderboard('user-2', 'guild-1', 'total', 1, mockClient);
      expect(second.success).toBe(true);
      expect(second.cached).toBe(true);

      // Client must NOT have been called a second time
      expect(mockClient.getGuildLeaderboard).toHaveBeenCalledTimes(1);
    });

    test('fetches fresh data after cache TTL expires', async () => {
      const first = await getLeaderboard('user-1', 'guild-1', 'total', 1, mockClient);
      expect(first.success).toBe(true);
      expect(mockClient.getGuildLeaderboard).toHaveBeenCalledTimes(1);

      // Expire cache manually
      _resetLeaderboardCache();

      const second = await getLeaderboard('user-2', 'guild-1', 'total', 1, mockClient);
      expect(second.success).toBe(true);
      expect(second.cached).toBe(false);
      expect(mockClient.getGuildLeaderboard).toHaveBeenCalledTimes(2);
    });
  });

  describe('Per-User Cooldown Rate Limiting', () => {
    test('enforces 10-second per-user cooldown on consecutive queries', async () => {
      const first = await getLeaderboard('user-spam', 'guild-1', 'total', 1, mockClient);
      expect(first.success).toBe(true);

      const second = await getLeaderboard('user-spam', 'guild-1', 'total', 1, mockClient);
      expect(second.success).toBe(false);
      expect(second.onCooldown).toBe(true);
      expect(second.remainingMs).toBeGreaterThan(0);
      expect(second.message).toContain('too quickly');
    });

    test('cooldown applies even when result is cached', async () => {
      // Warm cache
      await getLeaderboard('user-prime', 'guild-1', 'total', 1, mockClient);

      // User queries once
      await getLeaderboard('user-target', 'guild-1', 'total', 1, mockClient);

      // User immediately queries again for cached result
      const rapidQuery = await getLeaderboard('user-target', 'guild-1', 'total', 1, mockClient);
      expect(rapidQuery.success).toBe(false);
      expect(rapidQuery.onCooldown).toBe(true);
    });

    test('allows query after cooldown expires', async () => {
      const tenSecondsAgo = new Date(Date.now() - (LEADERBOARD_COOLDOWN_MS + 2000));
      _setLeaderboardCooldown('user-wait', tenSecondsAgo);

      const res = await getLeaderboard('user-wait', 'guild-1', 'total', 1, mockClient);
      expect(res.success).toBe(true);
    });
  });

  describe('Provider Failures & Security Invariants', () => {
    test('handles UnbelievaBoat 404 guild not found gracefully', async () => {
      mockClient.getGuildLeaderboard.mockResolvedValueOnce({
        success: false,
        status: 404,
        error: 'Target guild not found on economy service.',
      });

      const result = await getLeaderboard('user-1', 'guild-404', 'total', 1, mockClient);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('handles UnbelievaBoat 429 rate limiting gracefully', async () => {
      mockClient.getGuildLeaderboard.mockResolvedValueOnce({
        success: false,
        status: 429,
        error: 'Rate limit exceeded with economy service. Please try again in a few moments.',
      });

      const result = await getLeaderboard('user-1', 'guild-429', 'total', 1, mockClient);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Rate limit exceeded');
    });

    test('handles UnbelievaBoat 500 server error gracefully', async () => {
      mockClient.getGuildLeaderboard.mockResolvedValueOnce({
        success: false,
        status: 500,
        error: 'Economy service encountered a server error (HTTP 500).',
      });

      const result = await getLeaderboard('user-1', 'guild-500', 'total', 1, mockClient);
      expect(result.success).toBe(false);
      expect(result.error).toContain('server error');
    });

    test('handles network failure gracefully', async () => {
      mockClient.getGuildLeaderboard.mockResolvedValueOnce({
        success: false,
        error: 'Failed to connect to economy service: ETIMEDOUT',
      });

      const result = await getLeaderboard('user-1', 'guild-net', 'total', 1, mockClient);
      expect(result.success).toBe(false);
      expect(result.error).toContain('ETIMEDOUT');
    });

    test('handles empty leaderboard safely', async () => {
      mockClient.getGuildLeaderboard.mockResolvedValueOnce({
        success: true,
        status: 200,
        data: [],
      });

      const result = await getLeaderboard('user-1', 'guild-empty', 'total', 1, mockClient);
      expect(result.success).toBe(true);
      expect(result.entries).toHaveLength(0);
    });

    test('NEVER mutates user balances or calls grantSparks during leaderboard queries', async () => {
      await getLeaderboard('user-nomutate', 'guild-1', 'total', 1, mockClient);
      expect(mockClient.grantSparks).not.toHaveBeenCalled();
    });
  });
});
