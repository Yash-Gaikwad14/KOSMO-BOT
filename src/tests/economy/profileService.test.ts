import {
  getProfile,
  resolveMemberRecognition,
  _resetProfileCooldowns,
  _setProfileCooldown,
  PROFILE_COOLDOWN_MS,
} from '../../services/economy/profileService';
import {
  _resetDailyCooldowns,
  _setDailyCooldown,
} from '../../services/economy/dailyService';
import {
  IUnbelievaBoatClient,
  UnbelievaBoatResponse,
} from '../../services/economy/unbelievaboatClient';

describe('Profile Service', () => {
  const HIGH_KARMA_ID = '999888777666555';
  const originalEnv = process.env;

  let mockClient: jest.Mocked<IUnbelievaBoatClient>;

  beforeEach(() => {
    process.env = { ...originalEnv, HIGH_KARMA_ROLE_ID: HIGH_KARMA_ID };
    _resetProfileCooldowns();
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
          cash: 1200,
          bank: 3800,
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

  describe('Recognition Resolution & Priority', () => {
    test('resolves empty recognition when member has no special roles', () => {
      const recognition = resolveMemberRecognition(['standard-role'], false);
      expect(recognition.badges).toHaveLength(0);
      expect(recognition.premiumTier).toBeUndefined();
      expect(recognition.domainRoles).toHaveLength(0);
    });

    test('resolves Feedback Champion badge', () => {
      const recognition = resolveMemberRecognition(['Feedback Champion'], false);
      expect(recognition.badges).toContain('🏆 Feedback Champion');
    });

    test('resolves Top Inviter badge', () => {
      const recognition = resolveMemberRecognition(['Top Inviter'], false);
      expect(recognition.badges).toContain('📨 Top Inviter');
    });

    test('resolves High Roller badge', () => {
      const recognition = resolveMemberRecognition(['High Roller'], false);
      expect(recognition.badges).toContain('🎰 High Roller');
    });

    test('resolves High-Karma badge when member has High-Karma status', () => {
      const recognition = resolveMemberRecognition([HIGH_KARMA_ID], true);
      expect(recognition.badges).toContain('⚡ High-Karma');
    });

    test('resolves Kosmo VIP premium tier', () => {
      const recognition = resolveMemberRecognition(['Kosmo VIP'], false);
      expect(recognition.premiumTier).toBe('💎 Kosmo VIP');
    });

    test('resolves Kosmo Pro premium tier', () => {
      const recognition = resolveMemberRecognition(['Kosmo Pro'], false);
      expect(recognition.premiumTier).toBe('💎 Kosmo Pro');
    });

    test('resolves Kosmo Max premium tier', () => {
      const recognition = resolveMemberRecognition(['Kosmo Max'], false);
      expect(recognition.premiumTier).toBe('💎 Kosmo Max');
    });

    test('enforces premium tier precedence: Max > Pro > VIP', () => {
      // User has Max and VIP -> Max wins
      const res1 = resolveMemberRecognition(['Kosmo Max', 'Kosmo VIP'], false);
      expect(res1.premiumTier).toBe('💎 Kosmo Max');

      // User has Pro and VIP -> Pro wins
      const res2 = resolveMemberRecognition(['Kosmo Pro', 'Kosmo VIP'], false);
      expect(res2.premiumTier).toBe('💎 Kosmo Pro');

      // User has all three -> Max wins
      const res3 = resolveMemberRecognition(['Kosmo Max', 'Kosmo Pro', 'Kosmo VIP'], false);
      expect(res3.premiumTier).toBe('💎 Kosmo Max');
    });

    test('resolves multiple domain guild roles if assigned', () => {
      const recognition = resolveMemberRecognition(
        ['Tech & Engineering', 'Creative & Design'],
        false
      );
      expect(recognition.domainRoles).toContain('💻 Tech & Engineering');
      expect(recognition.domainRoles).toContain('🎨 Creative & Design');
      expect(recognition.domainRoles).toHaveLength(2);
    });
  });

  describe('Full Profile Aggregation', () => {
    test('aggregates economy balance, standard tier, and daily ready status', async () => {
      const result = await getProfile('user-1', 'guild-1', ['standard-role'], mockClient);

      expect(result.success).toBe(true);
      expect(result.userId).toBe('user-1');
      expect(result.isHighKarma).toBe(false);
      expect(result.dailyAllowance).toBe(500);
      expect(result.dailyEligible).toBe(true);
      expect(result.dailyNextClaimAt).toBeUndefined();
      expect(result.balance).toEqual({
        cash: 1200,
        bank: 3800,
        total: 5000,
      });
      expect(mockClient.getUserBalance).toHaveBeenCalledWith('guild-1', 'user-1');
      expect(mockClient.grantSparks).not.toHaveBeenCalled();
    });

    test('aggregates High-Karma tier with 2,000 Sparks allowance and daily on cooldown', async () => {
      const claimTime = new Date();
      _setDailyCooldown('user-hk', claimTime);

      const result = await getProfile('user-hk', 'guild-1', [HIGH_KARMA_ID], mockClient);

      expect(result.success).toBe(true);
      expect(result.isHighKarma).toBe(true);
      expect(result.dailyAllowance).toBe(2000);
      expect(result.dailyEligible).toBe(false);
      expect(result.dailyNextClaimAt).toBeDefined();
      expect(result.recognition.badges).toContain('⚡ High-Karma');
    });

    test('handles malformed balance or missing total gracefully', async () => {
      mockClient.getUserBalance.mockResolvedValueOnce({
        success: true,
        status: 200,
        data: {
          cash: 250,
          bank: 750,
        },
      });

      const result = await getProfile('user-fallback', 'guild-1', [], mockClient);
      expect(result.success).toBe(true);
      expect(result.balance?.cash).toBe(250);
      expect(result.balance?.bank).toBe(750);
      expect(result.balance?.total).toBe(1000); // 250 + 750
    });
  });

  describe('Rate Limiting', () => {
    test('enforces 10-second per-user profile cooldown on rapid consecutive queries', async () => {
      const first = await getProfile('user-spam', 'guild-1', [], mockClient);
      expect(first.success).toBe(true);

      const second = await getProfile('user-spam', 'guild-1', [], mockClient);
      expect(second.success).toBe(false);
      expect(second.onCooldown).toBe(true);
      expect(second.remainingMs).toBeGreaterThan(0);
      expect(second.message).toContain('too quickly');

      // Client must NOT be called on second query
      expect(mockClient.getUserBalance).toHaveBeenCalledTimes(1);
    });

    test('allows query after cooldown expires', async () => {
      const tenSecondsAgo = new Date(Date.now() - (PROFILE_COOLDOWN_MS + 2000));
      _setProfileCooldown('user-cooldown-done', tenSecondsAgo);

      const res = await getProfile('user-cooldown-done', 'guild-1', [], mockClient);
      expect(res.success).toBe(true);
      expect(mockClient.getUserBalance).toHaveBeenCalledTimes(1);
    });
  });

  describe('Provider Failures & Safety', () => {
    test('handles UnbelievaBoat failure safely without crashing', async () => {
      mockClient.getUserBalance.mockResolvedValueOnce({
        success: false,
        status: 500,
        error: 'Upstream server error',
      });

      const result = await getProfile('user-fail', 'guild-1', [], mockClient);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Upstream server error');
      expect(result.balance).toBeUndefined();
    });

    test('never mutates balances or calls grantSparks during profile queries', async () => {
      await getProfile('user-read', 'guild-1', ['Feedback Champion', 'Kosmo Max'], mockClient);
      expect(mockClient.grantSparks).not.toHaveBeenCalled();
    });
  });
});
