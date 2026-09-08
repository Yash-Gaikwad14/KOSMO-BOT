import {
  _resetDailyCooldowns,
  claimDaily,
  SPARKS_NORMAL,
  SPARKS_HIGH_KARMA,
} from '../../services/economy/dailyService';
import { getUserBalanceInfo } from '../../services/economy/balanceService';
import { getLeaderboard } from '../../services/economy/leaderboardService';
import { getProfile } from '../../services/economy/profileService';
import {
  validateRewardAmount,
  validateRewardReason,
  isStaffRewardAuthorized,
  grantPersonalSparks,
  MIN_REWARD_AMOUNT,
  MAX_REWARD_AMOUNT,
} from '../../services/economy/rewardService';
import {
  createPendingModAction,
  atomicConfirmModAction,
  cancelModAction,
  markExecuted,
  markFailed,
  getPendingModAction,
  _resetModConfirmationStore,
} from '../../services/discord/modConfirmation';
import { IUnbelievaBoatClient, UnbelievaBoatClient } from '../../services/economy/unbelievaboatClient';

describe('Phase 5.5 — Anti-Abuse & Economy Safeguards Matrix', () => {
  const FOUNDER_ROLE_ID = '1544750811207442532';
  const TEAM_KOSMO_ROLE_ID = '1544801399068434443';
  const MODERATOR_ROLE_ID = '1544801402247712868';
  const ADMIN_ROLE_ID = '1544801401000000000';
  const COMMUNITY_ROLE_ID = '1544801403000000000';

  beforeEach(() => {
    jest.clearAllMocks();
    _resetDailyCooldowns();
    _resetModConfirmationStore();
  });

  // =========================================================================
  // 1. AUTHORIZATION SAFEGUARDS
  // =========================================================================
  describe('1. Authorization Matrix', () => {
    test('Kosmo Founder is authorized for currency operations', () => {
      expect(isStaffRewardAuthorized([FOUNDER_ROLE_ID])).toBe(true);
      expect(isStaffRewardAuthorized(['Founder'])).toBe(true);
    });

    test('Team Kosmo is authorized for currency operations', () => {
      expect(isStaffRewardAuthorized([TEAM_KOSMO_ROLE_ID])).toBe(true);
      expect(isStaffRewardAuthorized(['Team Kosmo'])).toBe(true);
    });

    test('Moderator is strictly unauthorized for currency operations', () => {
      expect(isStaffRewardAuthorized([MODERATOR_ROLE_ID])).toBe(false);
      expect(isStaffRewardAuthorized(['Moderator'])).toBe(false);
    });

    test('Generic Admin is denied unless explicitly possessing Founder or Team role', () => {
      expect(isStaffRewardAuthorized([ADMIN_ROLE_ID])).toBe(false);
      expect(isStaffRewardAuthorized(['Admin'])).toBe(false);
      expect(isStaffRewardAuthorized(['Administrator'])).toBe(false);
      expect(isStaffRewardAuthorized([ADMIN_ROLE_ID, FOUNDER_ROLE_ID])).toBe(true);
    });

    test('Normal community members and empty roles are denied', () => {
      expect(isStaffRewardAuthorized([COMMUNITY_ROLE_ID])).toBe(false);
      expect(isStaffRewardAuthorized(['Kosmosian'])).toBe(false);
      expect(isStaffRewardAuthorized(['High-Karma'])).toBe(false);
      expect(isStaffRewardAuthorized([])).toBe(false);
    });
  });

  // =========================================================================
  // 2. CONFIRMATION & LIFECYCLE SAFEGUARDS
  // =========================================================================
  describe('2. Confirmation & Lifecycle Security', () => {
    test('valid confirmation successfully claims PENDING state and transitions to CONFIRMED', () => {
      const action = createPendingModAction({
        guildId: 'guild-1',
        moderatorId: 'user-1',
        actionType: 'REWARD_SPARKS',
        amount: 2500,
        reason: 'Operational test grant',
      });

      const res = atomicConfirmModAction(action.id, 'user-1', 'guild-1');
      expect(res.success).toBe(true);
      expect(res.action?.status).toBe('CONFIRMED');
    });

    test('confirmation fails if clicked by wrong actor', () => {
      const action = createPendingModAction({
        guildId: 'guild-1',
        moderatorId: 'user-1',
        actionType: 'REWARD_SPARKS',
        amount: 1000,
        reason: 'Operational test grant',
      });

      const res = atomicConfirmModAction(action.id, 'imposter-99', 'guild-1');
      expect(res.success).toBe(false);
      expect(res.error).toContain('Only the moderator who initiated this action can confirm it');
      expect(getPendingModAction(action.id)?.status).toBe('PENDING');
    });

    test('confirmation fails if clicked in wrong guild', () => {
      const action = createPendingModAction({
        guildId: 'guild-1',
        moderatorId: 'user-1',
        actionType: 'REWARD_SPARKS',
        amount: 1000,
        reason: 'Operational test grant',
      });

      const res = atomicConfirmModAction(action.id, 'user-1', 'wrong-guild-99');
      expect(res.success).toBe(false);
      expect(res.error).toContain('Action does not belong to this server');
    });

    test('expired action cannot be confirmed', () => {
      const action = createPendingModAction({
        guildId: 'guild-1',
        moderatorId: 'user-1',
        actionType: 'REWARD_SPARKS',
        amount: 1000,
        reason: 'Operational test grant',
      });

      action.expiresAt = new Date(Date.now() - 1000);
      const res = atomicConfirmModAction(action.id, 'user-1', 'guild-1');
      expect(res.success).toBe(false);
      expect(res.error).toContain('expired');
    });

    test('cancelled action cannot be confirmed', () => {
      const action = createPendingModAction({
        guildId: 'guild-1',
        moderatorId: 'user-1',
        actionType: 'REWARD_SPARKS',
        amount: 1000,
        reason: 'Operational test grant',
      });

      cancelModAction(action.id, 'user-1', 'guild-1');
      expect(getPendingModAction(action.id)?.status).toBe('CANCELLED');

      const res = atomicConfirmModAction(action.id, 'user-1', 'guild-1');
      expect(res.success).toBe(false);
      expect(res.error).toContain('cannot be confirmed again');
    });

    test('executed action cannot be confirmed again (replay protection)', () => {
      const action = createPendingModAction({
        guildId: 'guild-1',
        moderatorId: 'user-1',
        actionType: 'REWARD_SPARKS',
        amount: 1000,
        reason: 'Operational test grant',
      });

      atomicConfirmModAction(action.id, 'user-1', 'guild-1');
      markExecuted(action.id);
      expect(getPendingModAction(action.id)?.status).toBe('EXECUTED');

      const res = atomicConfirmModAction(action.id, 'user-1', 'guild-1');
      expect(res.success).toBe(false);
      expect(res.error).toContain('cannot be confirmed again');
    });

    test('failed action cannot be confirmed again or retried on existing token', () => {
      const action = createPendingModAction({
        guildId: 'guild-1',
        moderatorId: 'user-1',
        actionType: 'REWARD_SPARKS',
        amount: 1000,
        reason: 'Operational test grant',
      });

      atomicConfirmModAction(action.id, 'user-1', 'guild-1');
      markFailed(action.id);
      expect(getPendingModAction(action.id)?.status).toBe('FAILED');

      const res = atomicConfirmModAction(action.id, 'user-1', 'guild-1');
      expect(res.success).toBe(false);
      expect(res.error).toContain('cannot be confirmed again');
    });

    test('atomic double-confirmation only permits first caller to succeed', () => {
      const action = createPendingModAction({
        guildId: 'guild-1',
        moderatorId: 'user-1',
        actionType: 'REWARD_SPARKS',
        amount: 5000,
        reason: 'Atomic race test',
      });

      const first = atomicConfirmModAction(action.id, 'user-1', 'guild-1');
      const second = atomicConfirmModAction(action.id, 'user-1', 'guild-1');

      expect(first.success).toBe(true);
      expect(second.success).toBe(false);
      expect(second.error).toContain('cannot be confirmed again');
    });
  });

  // =========================================================================
  // 3. AMOUNT VALIDATION SAFEGUARDS
  // =========================================================================
  describe('3. Amount Validation Guardrails', () => {
    test('accepts minimum 1', () => {
      expect(validateRewardAmount(1).valid).toBe(true);
    });

    test('accepts maximum 5,000', () => {
      expect(validateRewardAmount(5000).valid).toBe(true);
    });

    test('rejects 5,001', () => {
      const res = validateRewardAmount(5001);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('cannot exceed 5,000');
    });

    test('rejects 0', () => {
      const res = validateRewardAmount(0);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('at least 1 Spark');
    });

    test('rejects negative numbers', () => {
      const res = validateRewardAmount(-100);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('at least 1 Spark');
    });

    test('rejects decimal values', () => {
      const res = validateRewardAmount(10.5);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('must be an integer');
    });

    test('rejects NaN, Infinity, -Infinity, and non-numeric types', () => {
      expect(validateRewardAmount(NaN).valid).toBe(false);
      expect(validateRewardAmount(Infinity).valid).toBe(false);
      expect(validateRewardAmount(-Infinity).valid).toBe(false);
      expect(validateRewardAmount('5000' as any).valid).toBe(false);
      expect(validateRewardAmount(null as any).valid).toBe(false);
    });
  });

  // =========================================================================
  // 4. PROVIDER SAFETY & ERROR HANDLING
  // =========================================================================
  describe('4. UnbelievaBoat Client Safety & HTTP Handling', () => {
    test('handles HTTP 200 success defensively with JSON payload', async () => {
      const mockFetch: any = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ cash: 1000, bank: 2000, total: 3000 }),
      });

      const client = new UnbelievaBoatClient({
        apiKey: 'test-api-key',
        fetchFn: mockFetch,
      });

      const res = await client.grantSparks('guild-1', 'user-1', 500, 'Test reason here');
      expect(res.success).toBe(true);
      expect(res.data.cash).toBe(1000);
    });

    test('handles HTTP 401 / 403 authorization failures', async () => {
      const mockFetch: any = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
      });

      const client = new UnbelievaBoatClient({ apiKey: 'invalid-key', fetchFn: mockFetch });
      const res = await client.grantSparks('guild-1', 'user-1', 500, 'Test reason');
      expect(res.success).toBe(false);
      expect(res.error).toContain('authorization failed');
    });

    test('handles HTTP 404 user/guild not found', async () => {
      const mockFetch: any = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      const client = new UnbelievaBoatClient({ apiKey: 'valid-key', fetchFn: mockFetch });
      const res = await client.grantSparks('guild-1', 'user-1', 500, 'Test reason');
      expect(res.success).toBe(false);
      expect(res.error).toContain('not found');
    });

    test('handles HTTP 429 rate limit exceeded gracefully', async () => {
      const mockFetch: any = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
      });

      const client = new UnbelievaBoatClient({ apiKey: 'valid-key', fetchFn: mockFetch });
      const res = await client.grantSparks('guild-1', 'user-1', 500, 'Test reason');
      expect(res.success).toBe(false);
      expect(res.error).toContain('Rate limit exceeded');
    });

    test('handles HTTP 5xx server errors gracefully', async () => {
      const mockFetch: any = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
      });

      const client = new UnbelievaBoatClient({ apiKey: 'valid-key', fetchFn: mockFetch });
      const res = await client.grantSparks('guild-1', 'user-1', 500, 'Test reason');
      expect(res.success).toBe(false);
      expect(res.error).toContain('server error (HTTP 503)');
    });

    test('handles network failure without throwing unhandled exceptions', async () => {
      const mockFetch: any = jest.fn().mockRejectedValue(new Error('ECONNRESET socket hang up'));

      const client = new UnbelievaBoatClient({ apiKey: 'valid-key', fetchFn: mockFetch });
      const res = await client.grantSparks('guild-1', 'user-1', 500, 'Test reason');
      expect(res.success).toBe(false);
      expect(res.error).toContain('Failed to connect to economy service');
    });

    test('handles malformed / non-JSON responses gracefully', async () => {
      const mockFetch: any = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Unexpected token < in JSON at position 0');
        },
      });

      const client = new UnbelievaBoatClient({ apiKey: 'valid-key', fetchFn: mockFetch });
      const res = await client.grantSparks('guild-1', 'user-1', 500, 'Test reason');
      expect(res.success).toBe(true);
      expect(res.data).toBeNull();
    });
  });

  // =========================================================================
  // 5. DAILY SPARKS SAFEGUARDS & CONCURRENCY
  // =========================================================================
  describe('5. Daily Sparks Safeguards', () => {
    test('awards 500 Sparks to standard tier member', async () => {
      const mockClient: IUnbelievaBoatClient = {
        grantSparks: jest.fn().mockResolvedValue({ success: true, data: { cash: 500 } }),
        getUserBalance: jest.fn(),
        getGuildLeaderboard: jest.fn(),
      };

      const res = await claimDaily('user-standard', 'guild-1', [], mockClient);
      expect(res.success).toBe(true);
      expect(res.sparksAwarded).toBe(SPARKS_NORMAL);
      expect(mockClient.grantSparks).toHaveBeenCalledWith('guild-1', 'user-standard', 500, expect.any(String));
    });

    test('awards 2,000 Sparks to High-Karma tier member', async () => {
      process.env.HIGH_KARMA_ROLE_ID = 'role-high-karma-123';
      const mockClient: IUnbelievaBoatClient = {
        grantSparks: jest.fn().mockResolvedValue({ success: true, data: { cash: 2000 } }),
        getUserBalance: jest.fn(),
        getGuildLeaderboard: jest.fn(),
      };

      const res = await claimDaily('user-karma', 'guild-1', ['role-high-karma-123'], mockClient);
      expect(res.success).toBe(true);
      expect(res.sparksAwarded).toBe(SPARKS_HIGH_KARMA);
      expect(mockClient.grantSparks).toHaveBeenCalledWith('guild-1', 'user-karma', 2000, expect.any(String));
    });

    test('second claim within 24 hours is rejected on cooldown without UBB call', async () => {
      const mockClient: IUnbelievaBoatClient = {
        grantSparks: jest.fn().mockResolvedValue({ success: true }),
        getUserBalance: jest.fn(),
        getGuildLeaderboard: jest.fn(),
      };

      const first = await claimDaily('user-1', 'guild-1', [], mockClient);
      expect(first.success).toBe(true);
      expect(mockClient.grantSparks).toHaveBeenCalledTimes(1);

      const second = await claimDaily('user-1', 'guild-1', [], mockClient);
      expect(second.success).toBe(false);
      expect(second.onCooldown).toBe(true);
      expect(mockClient.grantSparks).toHaveBeenCalledTimes(1); // Not called again!
    });

    test('failed UBB request does NOT consume the daily cooldown', async () => {
      const mockClient: IUnbelievaBoatClient = {
        grantSparks: jest.fn().mockResolvedValue({ success: false, error: 'UBB timeout' }),
        getUserBalance: jest.fn(),
        getGuildLeaderboard: jest.fn(),
      };

      const res = await claimDaily('user-1', 'guild-1', [], mockClient);
      expect(res.success).toBe(false);
      expect(res.onCooldown).toBe(false);

      // Subsequent attempt is still eligible (not on cooldown)
      const mockClientSuccess: IUnbelievaBoatClient = {
        grantSparks: jest.fn().mockResolvedValue({ success: true }),
        getUserBalance: jest.fn(),
        getGuildLeaderboard: jest.fn(),
      };

      const retryRes = await claimDaily('user-1', 'guild-1', [], mockClientSuccess);
      expect(retryRes.success).toBe(true);
    });

    test('concurrent in-flight daily claims for same user are rejected (double-claim safeguard)', async () => {
      let resolveUbb: (val: any) => void;
      const ubbPromise = new Promise((resolve) => {
        resolveUbb = resolve;
      });

      const mockClient: IUnbelievaBoatClient = {
        grantSparks: jest.fn().mockImplementation(() => ubbPromise),
        getUserBalance: jest.fn(),
        getGuildLeaderboard: jest.fn(),
      };

      // Launch first request (hangs until resolved)
      const req1 = claimDaily('user-race-1', 'guild-1', [], mockClient);

      // Launch concurrent second request for same user
      const req2 = await claimDaily('user-race-1', 'guild-1', [], mockClient);

      // Second request must be rejected immediately due to in-flight processing
      expect(req2.success).toBe(false);
      expect(req2.onCooldown).toBe(true);
      expect(req2.message).toContain('currently being processed');

      // Resolve first request
      resolveUbb!({ success: true });
      const res1 = await req1;
      expect(res1.success).toBe(true);
      expect(mockClient.grantSparks).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // 6. READ-ONLY INVARIANTS (/balance, /leaderboard, /profile)
  // =========================================================================
  describe('6. Read-Only Invariants (Zero Mutation Guarantees)', () => {
    test('/balance never calls grantSparks or performs currency writes', async () => {
      const mockClient: IUnbelievaBoatClient = {
        grantSparks: jest.fn(),
        getUserBalance: jest.fn().mockResolvedValue({
          success: true,
          data: { cash: 100, bank: 200, total: 300 },
        }),
        getGuildLeaderboard: jest.fn(),
      };

      const res = await getUserBalanceInfo('user-read-1', 'guild-1', [], mockClient);
      expect(res.success).toBe(true);
      expect(mockClient.getUserBalance).toHaveBeenCalledTimes(1);
      expect(mockClient.grantSparks).not.toHaveBeenCalled();
    });

    test('/leaderboard never calls grantSparks or performs currency writes', async () => {
      const mockClient: IUnbelievaBoatClient = {
        grantSparks: jest.fn(),
        getUserBalance: jest.fn(),
        getGuildLeaderboard: jest.fn().mockResolvedValue({
          success: true,
          data: [{ user_id: '123456789012345678', cash: 500, bank: 500, total: 1000 }],
        }),
      };

      const res = await getLeaderboard('user-read-1', 'guild-1', 'total', 1, mockClient);
      expect(res.success).toBe(true);
      expect(mockClient.getGuildLeaderboard).toHaveBeenCalledTimes(1);
      expect(mockClient.grantSparks).not.toHaveBeenCalled();
    });

    test('/profile never calls grantSparks or performs currency writes', async () => {
      const mockClient: IUnbelievaBoatClient = {
        grantSparks: jest.fn(),
        getUserBalance: jest.fn().mockResolvedValue({
          success: true,
          data: { cash: 1500, bank: 3500, total: 5000 },
        }),
        getGuildLeaderboard: jest.fn(),
      };

      const res = await getProfile('user-read-1', 'guild-1', [], mockClient);
      expect(res.success).toBe(true);
      expect(mockClient.getUserBalance).toHaveBeenCalledTimes(1);
      expect(mockClient.grantSparks).not.toHaveBeenCalled();
    });
  });
});
