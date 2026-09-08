import {
  getUserBalanceInfo,
  checkBalanceCooldown,
  _resetBalanceCooldowns,
  _setBalanceCooldown,
  BALANCE_COOLDOWN_MS,
} from '../../services/economy/balanceService';
import {
  _resetDailyCooldowns,
  _setDailyCooldown,
} from '../../services/economy/dailyService';
import {
  IUnbelievaBoatClient,
  UnbelievaBoatResponse,
} from '../../services/economy/unbelievaboatClient';

describe('Balance Service', () => {
  const HIGH_KARMA_ID = '999888777666555';
  const originalEnv = process.env;

  let mockClient: jest.Mocked<IUnbelievaBoatClient>;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, HIGH_KARMA_ROLE_ID: HIGH_KARMA_ID };
    _resetBalanceCooldowns();
    _resetDailyCooldowns();

    mockClient = {
      grantSparks: jest.fn().mockResolvedValue({
        success: true,
        status: 200,
        data: { cash: 500 },
      } as UnbelievaBoatResponse),
      getUserBalance: jest.fn().mockResolvedValue({
        success: true,
        status: 200,
        data: {
          rank: 1,
          user_id: 'user-123',
          cash: 1500,
          bank: 3500,
          total: 5000,
        },
      } as UnbelievaBoatResponse),
      getGuildLeaderboard: jest.fn().mockResolvedValue({
        success: true,
        status: 200,
        data: [],
      } as UnbelievaBoatResponse),
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Balance Parsing & Calculations', () => {
    test('correctly parses cash, bank, and explicit total from UnbelievaBoat response', async () => {
      const result = await getUserBalanceInfo('user-123', 'guild-1', [], mockClient);

      expect(result.success).toBe(true);
      expect(result.balance).toBeDefined();
      expect(result.balance?.cash).toBe(1500);
      expect(result.balance?.bank).toBe(3500);
      expect(result.balance?.total).toBe(5000);
      expect(mockClient.getUserBalance).toHaveBeenCalledWith('guild-1', 'user-123');
      expect(mockClient.grantSparks).not.toHaveBeenCalled();
    });

    test('calculates total dynamically if total is not directly provided or undefined', async () => {
      mockClient.getUserBalance.mockResolvedValueOnce({
        success: true,
        status: 200,
        data: {
          user_id: 'user-no-total',
          cash: 400,
          bank: 600,
        },
      });

      const result = await getUserBalanceInfo('user-no-total', 'guild-1', [], mockClient);

      expect(result.success).toBe(true);
      expect(result.balance?.cash).toBe(400);
      expect(result.balance?.bank).toBe(600);
      expect(result.balance?.total).toBe(1000); // 400 + 600
    });

    test('handles missing or non-numeric cash/bank values defaulting to 0', async () => {
      mockClient.getUserBalance.mockResolvedValueOnce({
        success: true,
        status: 200,
        data: {
          user_id: 'user-empty',
        },
      });

      const result = await getUserBalanceInfo('user-empty', 'guild-1', [], mockClient);

      expect(result.success).toBe(true);
      expect(result.balance?.cash).toBe(0);
      expect(result.balance?.bank).toBe(0);
      expect(result.balance?.total).toBe(0);
    });
  });

  describe('Tier Evaluation', () => {
    test('reports Standard tier if caller lacks High-Karma role', async () => {
      const result = await getUserBalanceInfo('user-std', 'guild-1', ['standard-role'], mockClient);
      expect(result.success).toBe(true);
      expect(result.isHighKarma).toBe(false);
    });

    test('reports High-Karma tier if caller has High-Karma role', async () => {
      const result = await getUserBalanceInfo('user-hk', 'guild-1', [HIGH_KARMA_ID], mockClient);
      expect(result.success).toBe(true);
      expect(result.isHighKarma).toBe(true);
    });
  });

  describe('Daily Allowance Status Reporting', () => {
    test('reports daily claim as available when no daily cooldown exists', async () => {
      const result = await getUserBalanceInfo('user-avail', 'guild-1', [], mockClient);
      expect(result.success).toBe(true);
      expect(result.dailyEligible).toBe(true);
      expect(result.dailyNextClaimAt).toBeUndefined();
    });

    test('reports daily claim as on cooldown with nextClaimAt when already claimed today', async () => {
      const claimTime = new Date();
      _setDailyCooldown('user-claimed', claimTime);

      const result = await getUserBalanceInfo('user-claimed', 'guild-1', [], mockClient);
      expect(result.success).toBe(true);
      expect(result.dailyEligible).toBe(false);
      expect(result.dailyNextClaimAt).toBeDefined();
    });
  });

  describe('Per-User Balance Query Rate Limiting', () => {
    test('enforces query rate limit on rapid consecutive queries', async () => {
      // First query succeeds
      const first = await getUserBalanceInfo('user-rapid', 'guild-1', [], mockClient);
      expect(first.success).toBe(true);
      expect(mockClient.getUserBalance).toHaveBeenCalledTimes(1);

      // Immediate second query is rate limited
      const second = await getUserBalanceInfo('user-rapid', 'guild-1', [], mockClient);
      expect(second.success).toBe(false);
      expect(second.onCooldown).toBe(true);
      expect(second.remainingMs).toBeGreaterThan(0);
      expect(second.message).toContain('too quickly');

      // UnbelievaBoat client must NOT be called a second time
      expect(mockClient.getUserBalance).toHaveBeenCalledTimes(1);
    });

    test('allows query after cooldown expires', async () => {
      // Simulate query 15 seconds ago
      const fifteenSecondsAgo = new Date(Date.now() - (BALANCE_COOLDOWN_MS + 5000));
      _setBalanceCooldown('user-expired', fifteenSecondsAgo);

      const status = checkBalanceCooldown('user-expired');
      expect(status.onCooldown).toBe(false);

      const result = await getUserBalanceInfo('user-expired', 'guild-1', [], mockClient);
      expect(result.success).toBe(true);
      expect(mockClient.getUserBalance).toHaveBeenCalledTimes(1);
    });
  });

  describe('Provider Failure & Security Resilience', () => {
    test('handles UnbelievaBoat 404 user not found gracefully', async () => {
      mockClient.getUserBalance.mockResolvedValueOnce({
        success: false,
        status: 404,
        error: 'Target user or guild not found on economy service.',
      });

      const result = await getUserBalanceInfo('user-404', 'guild-1', [], mockClient);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
      expect(result.message).toContain('not found');
    });

    test('handles UnbelievaBoat 429 rate limiting gracefully', async () => {
      mockClient.getUserBalance.mockResolvedValueOnce({
        success: false,
        status: 429,
        error: 'Rate limit exceeded with economy service. Please try again in a few moments.',
      });

      const result = await getUserBalanceInfo('user-429', 'guild-1', [], mockClient);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Rate limit exceeded');
    });

    test('handles UnbelievaBoat 500 server error gracefully', async () => {
      mockClient.getUserBalance.mockResolvedValueOnce({
        success: false,
        status: 500,
        error: 'Economy service encountered a server error (HTTP 500).',
      });

      const result = await getUserBalanceInfo('user-500', 'guild-1', [], mockClient);
      expect(result.success).toBe(false);
      expect(result.error).toContain('server error');
    });

    test('handles network failure gracefully', async () => {
      mockClient.getUserBalance.mockResolvedValueOnce({
        success: false,
        error: 'Failed to connect to economy service: ECONNRESET',
      });

      const result = await getUserBalanceInfo('user-net', 'guild-1', [], mockClient);
      expect(result.success).toBe(false);
      expect(result.error).toContain('ECONNRESET');
    });

    test('NEVER mutates user balance during balance lookups', async () => {
      await getUserBalanceInfo('user-nomutate', 'guild-1', [], mockClient);
      expect(mockClient.grantSparks).not.toHaveBeenCalled();
    });
  });
});
