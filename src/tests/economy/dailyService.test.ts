import {
  claimDaily,
  checkDailyEligibility,
  isHighKarmaMember,
  formatRemainingTime,
  _resetDailyCooldowns,
  _setDailyCooldown,
  SPARKS_NORMAL,
  SPARKS_HIGH_KARMA,
  DAILY_COOLDOWN_MS,
} from '../../services/economy/dailyService';
import { IUnbelievaBoatClient, UnbelievaBoatResponse } from '../../services/economy/unbelievaboatClient';

describe('Daily Sparks Service', () => {
  const HIGH_KARMA_ID = '999888777666555';
  const originalEnv = process.env;

  let mockClient: jest.Mocked<IUnbelievaBoatClient>;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, HIGH_KARMA_ROLE_ID: HIGH_KARMA_ID };
    _resetDailyCooldowns();

    mockClient = {
      grantSparks: jest.fn().mockResolvedValue({
        success: true,
        status: 200,
        data: { cash: 500 },
      } as UnbelievaBoatResponse),
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('High-Karma Role Evaluation', () => {
    test('returns true only if caller possesses the configured HIGH_KARMA_ROLE_ID', () => {
      expect(isHighKarmaMember([HIGH_KARMA_ID])).toBe(true);
      expect(isHighKarmaMember(['role-1', HIGH_KARMA_ID, 'role-2'])).toBe(true);
    });

    test('returns false if caller lacks the HIGH_KARMA_ROLE_ID', () => {
      expect(isHighKarmaMember(['role-1', 'role-2'])).toBe(false);
      expect(isHighKarmaMember([])).toBe(false);
      expect(isHighKarmaMember(null)).toBe(false);
      expect(isHighKarmaMember(undefined)).toBe(false);
    });

    test('returns false if HIGH_KARMA_ROLE_ID environment variable is missing', () => {
      delete process.env.HIGH_KARMA_ROLE_ID;
      expect(isHighKarmaMember([HIGH_KARMA_ID])).toBe(false);
    });
  });

  describe('formatRemainingTime helper', () => {
    test('formats milliseconds into human readable hours, minutes, and seconds', () => {
      const ms = (23 * 3600 + 45 * 60 + 15) * 1000;
      expect(formatRemainingTime(ms)).toBe('23h 45m 15s');

      const msOnlyMinutes = (30 * 60 + 5) * 1000;
      expect(formatRemainingTime(msOnlyMinutes)).toBe('30m 5s');

      const msOnlySeconds = 42 * 1000;
      expect(formatRemainingTime(msOnlySeconds)).toBe('42s');
    });
  });

  describe('Reward Calculation and Granting', () => {
    test('grants 500 Sparks to standard members', async () => {
      const result = await claimDaily('user-standard', 'guild-1', ['standard-role'], mockClient);

      expect(result.success).toBe(true);
      expect(result.isHighKarma).toBe(false);
      expect(result.sparksAwarded).toBe(SPARKS_NORMAL);
      expect(result.message).toContain('Standard Tier');
      expect(result.message).toContain('500 Sparks');

      expect(mockClient.grantSparks).toHaveBeenCalledWith(
        'guild-1',
        'user-standard',
        500,
        expect.stringContaining('Standard Tier')
      );
    });

    test('grants 2,000 Sparks to High-Karma members', async () => {
      const result = await claimDaily('user-karma', 'guild-1', [HIGH_KARMA_ID], mockClient);

      expect(result.success).toBe(true);
      expect(result.isHighKarma).toBe(true);
      expect(result.sparksAwarded).toBe(SPARKS_HIGH_KARMA);
      expect(result.message).toContain('High-Karma Tier');
      expect(result.message).toContain('2,000 Sparks');

      expect(mockClient.grantSparks).toHaveBeenCalledWith(
        'guild-1',
        'user-karma',
        2000,
        expect.stringContaining('High-Karma Tier')
      );
    });
  });

  describe('24-Hour Cooldown Enforcement', () => {
    test('first claim succeeds and records cooldown', async () => {
      const result = await claimDaily('user-1', 'guild-1', [], mockClient);
      expect(result.success).toBe(true);
      expect(result.nextClaimAt).toBeDefined();

      const eligibility = checkDailyEligibility('user-1');
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.remainingMs).toBeGreaterThan(0);
    });

    test('second claim within 24 hours is rejected on cooldown without contacting UBB', async () => {
      // First claim
      await claimDaily('user-1', 'guild-1', [], mockClient);
      expect(mockClient.grantSparks).toHaveBeenCalledTimes(1);

      // Second claim immediately
      const secondResult = await claimDaily('user-1', 'guild-1', [], mockClient);

      expect(secondResult.success).toBe(false);
      expect(secondResult.onCooldown).toBe(true);
      expect(secondResult.sparksAwarded).toBe(0);
      expect(secondResult.message).toContain('already claimed');
      expect(secondResult.remainingMs).toBeGreaterThan(0);
      expect(secondResult.nextClaimAt).toBeDefined();

      // UBB must NOT have been called a second time
      expect(mockClient.grantSparks).toHaveBeenCalledTimes(1);
    });

    test('claim after 24 hours expires succeeds', async () => {
      // Simulate claim 25 hours ago
      const twentyFiveHoursAgo = new Date(Date.now() - (DAILY_COOLDOWN_MS + 3600000));
      _setDailyCooldown('user-1', twentyFiveHoursAgo);

      const eligibility = checkDailyEligibility('user-1');
      expect(eligibility.eligible).toBe(true);

      const result = await claimDaily('user-1', 'guild-1', [], mockClient);
      expect(result.success).toBe(true);
      expect(mockClient.grantSparks).toHaveBeenCalledTimes(1);
    });
  });

  describe('Failure Safety & Cooldown Protection', () => {
    test('does NOT consume cooldown when UnbelievaBoat synchronization fails', async () => {
      mockClient.grantSparks.mockResolvedValueOnce({
        success: false,
        status: 500,
        error: 'Economy provider unreachable',
      });

      const result = await claimDaily('user-fail', 'guild-1', [], mockClient);

      expect(result.success).toBe(false);
      expect(result.onCooldown).toBe(false);
      expect(result.sparksAwarded).toBe(0);
      expect(result.error).toContain('Economy provider unreachable');
      expect(result.message).toContain('not consumed');

      // Invariant: User is STILL eligible for daily claim! Cooldown was NOT saved!
      const eligibility = checkDailyEligibility('user-fail');
      expect(eligibility.eligible).toBe(true);

      // Subsequent attempt when UBB recovers succeeds immediately
      mockClient.grantSparks.mockResolvedValueOnce({
        success: true,
        status: 200,
        data: { cash: 500 },
      });

      const retryResult = await claimDaily('user-fail', 'guild-1', [], mockClient);
      expect(retryResult.success).toBe(true);
      expect(retryResult.sparksAwarded).toBe(500);
    });

    test('does NOT consume cooldown on rate limit error', async () => {
      mockClient.grantSparks.mockResolvedValueOnce({
        success: false,
        status: 429,
        error: 'Rate limit exceeded',
      });

      const result = await claimDaily('user-rate-limited', 'guild-1', [], mockClient);
      expect(result.success).toBe(false);

      const eligibility = checkDailyEligibility('user-rate-limited');
      expect(eligibility.eligible).toBe(true);
    });
  });
});
