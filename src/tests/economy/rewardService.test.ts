import {
  validateRewardAmount,
  validateRewardReason,
  isStaffRewardAuthorized,
  grantPersonalSparks,
  logRewardSparksAudit,
  MAX_REWARD_AMOUNT,
  MIN_REWARD_AMOUNT,
  MIN_REASON_LENGTH,
  MAX_REASON_LENGTH,
} from '../../services/economy/rewardService';
import { IUnbelievaBoatClient } from '../../services/economy/unbelievaboatClient';
import { ChannelType, Collection } from 'discord.js';

describe('rewardService — Unit Tests', () => {
  // Role IDs from src/config/roles.json
  const FOUNDER_ROLE_ID = '1544750811207442532';
  const TEAM_KOSMO_ROLE_ID = '1544801399068434443';
  const MODERATOR_ROLE_ID = '1544801402247712868';
  const ADMIN_ROLE_ID = '1544801401000000000'; // Generic Admin not in founder/team
  const COMMUNITY_ROLE_ID = '1544801403000000000';

  describe('Amount Validation (validateRewardAmount)', () => {
    test('accepts minimum boundary amount of 1', () => {
      const res = validateRewardAmount(MIN_REWARD_AMOUNT);
      expect(res.valid).toBe(true);
      expect(res.value).toBe(1);
      expect(res.error).toBeUndefined();
    });

    test('accepts maximum boundary amount of 5,000', () => {
      const res = validateRewardAmount(MAX_REWARD_AMOUNT);
      expect(res.valid).toBe(true);
      expect(res.value).toBe(5000);
      expect(res.error).toBeUndefined();
    });

    test('accepts typical intermediate amounts (e.g. 100, 2500)', () => {
      expect(validateRewardAmount(100).valid).toBe(true);
      expect(validateRewardAmount(2500).valid).toBe(true);
    });

    test('rejects 0', () => {
      const res = validateRewardAmount(0);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('at least 1 Spark');
    });

    test('rejects negative amounts', () => {
      const res = validateRewardAmount(-50);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('at least 1 Spark');
    });

    test('rejects amounts exceeding 5,000 (e.g. 5,001)', () => {
      const res = validateRewardAmount(5001);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('cannot exceed 5,000');
    });

    test('rejects decimal amounts', () => {
      const res = validateRewardAmount(99.99);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('must be an integer');
    });

    test('rejects NaN', () => {
      const res = validateRewardAmount(NaN);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('valid finite number');
    });

    test('rejects Infinity and -Infinity', () => {
      expect(validateRewardAmount(Infinity).valid).toBe(false);
      expect(validateRewardAmount(-Infinity).valid).toBe(false);
    });

    test('rejects non-numeric values', () => {
      expect(validateRewardAmount('1000' as any).valid).toBe(false);
      expect(validateRewardAmount(null as any).valid).toBe(false);
      expect(validateRewardAmount(undefined as any).valid).toBe(false);
      expect(validateRewardAmount({} as any).valid).toBe(false);
    });
  });

  describe('Reason Validation (validateRewardReason)', () => {
    test('accepts valid 10-character reason', () => {
      const res = validateRewardReason('1234567890');
      expect(res.valid).toBe(true);
      expect(res.value).toBe('1234567890');
    });

    test('accepts valid typical reason and trims whitespace', () => {
      const res = validateRewardReason('   Community contribution award for documentation   ');
      expect(res.valid).toBe(true);
      expect(res.value).toBe('Community contribution award for documentation');
    });

    test('accepts maximum boundary reason of 500 characters', () => {
      const longReason = 'A'.repeat(MAX_REASON_LENGTH);
      const res = validateRewardReason(longReason);
      expect(res.valid).toBe(true);
      expect(res.value).toHaveLength(500);
    });

    test('rejects empty string', () => {
      const res = validateRewardReason('');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('empty or whitespace-only');
    });

    test('rejects whitespace-only string', () => {
      const res = validateRewardReason('          ');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('empty or whitespace-only');
    });

    test('rejects reason shorter than 10 characters', () => {
      const res = validateRewardReason('Short');
      expect(res.valid).toBe(false);
      expect(res.error).toContain(`at least ${MIN_REASON_LENGTH} characters`);
    });

    test('rejects reason longer than 500 characters', () => {
      const res = validateRewardReason('A'.repeat(501));
      expect(res.valid).toBe(false);
      expect(res.error).toContain(`cannot exceed ${MAX_REASON_LENGTH} characters`);
    });

    test('rejects non-string input', () => {
      expect(validateRewardReason(12345 as any).valid).toBe(false);
      expect(validateRewardReason(null as any).valid).toBe(false);
      expect(validateRewardReason(undefined as any).valid).toBe(false);
    });
  });

  describe('Authorization Check (isStaffRewardAuthorized)', () => {
    test('allows Kosmo Founder role ID', () => {
      expect(isStaffRewardAuthorized([FOUNDER_ROLE_ID])).toBe(true);
    });

    test('allows Kosmo Founder role by name alias', () => {
      expect(isStaffRewardAuthorized(['Founder'])).toBe(true);
      expect(isStaffRewardAuthorized(['Kosmo Founder'])).toBe(true);
    });

    test('allows Team Kosmo role ID', () => {
      expect(isStaffRewardAuthorized([TEAM_KOSMO_ROLE_ID])).toBe(true);
    });

    test('allows Team Kosmo role by name alias', () => {
      expect(isStaffRewardAuthorized(['Team Kosmo'])).toBe(true);
    });

    test('denies Moderator role', () => {
      expect(isStaffRewardAuthorized([MODERATOR_ROLE_ID])).toBe(false);
      expect(isStaffRewardAuthorized(['Moderator'])).toBe(false);
    });

    test('denies generic Admin role unless also Founder/Team', () => {
      expect(isStaffRewardAuthorized([ADMIN_ROLE_ID])).toBe(false);
      expect(isStaffRewardAuthorized(['Admin'])).toBe(false);
      expect(isStaffRewardAuthorized(['Administrator'])).toBe(false);
    });

    test('allows Admin if member ALSO has Founder or Team Kosmo', () => {
      expect(isStaffRewardAuthorized(['Admin', FOUNDER_ROLE_ID])).toBe(true);
      expect(isStaffRewardAuthorized(['Administrator', TEAM_KOSMO_ROLE_ID])).toBe(true);
    });

    test('denies community and regular members', () => {
      expect(isStaffRewardAuthorized([COMMUNITY_ROLE_ID])).toBe(false);
      expect(isStaffRewardAuthorized(['Kosmosian'])).toBe(false);
      expect(isStaffRewardAuthorized(['High-Karma'])).toBe(false);
      expect(isStaffRewardAuthorized([])).toBe(false);
      expect(isStaffRewardAuthorized(null as any)).toBe(false);
    });
  });

  describe('grantPersonalSparks Execution', () => {
    test('successfully calls UBB client and returns balance delta data', async () => {
      const mockClient: IUnbelievaBoatClient = {
        grantSparks: jest.fn().mockResolvedValue({
          success: true,
          status: 200,
          data: {
            cash: 6500,
            bank: 10000,
            total: 16500,
          },
        }),
        getUserBalance: jest.fn(),
        getGuildLeaderboard: jest.fn(),
      };

      const result = await grantPersonalSparks(
        mockClient,
        'guild-123',
        'user-founder-1',
        5000,
        'Testing operational grant'
      );

      expect(mockClient.grantSparks).toHaveBeenCalledWith(
        'guild-123',
        'user-founder-1',
        5000,
        'Testing operational grant'
      );
      expect(result.success).toBe(true);
      expect(result.amount).toBe(5000);
      expect(result.cash).toBe(6500);
      expect(result.total).toBe(16500);
    });

    test('returns failure details when UBB client fails', async () => {
      const mockClient: IUnbelievaBoatClient = {
        grantSparks: jest.fn().mockResolvedValue({
          success: false,
          status: 429,
          error: 'Rate limit exceeded with economy service.',
        }),
        getUserBalance: jest.fn(),
        getGuildLeaderboard: jest.fn(),
      };

      const result = await grantPersonalSparks(
        mockClient,
        'guild-123',
        'user-founder-1',
        1000,
        'Testing operational grant'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Rate limit exceeded with economy service.');
      expect(result.cash).toBeUndefined();
    });
  });

  describe('Audit Logging (logRewardSparksAudit)', () => {
    test('posts rich embed to #mod-logs on successful grant', async () => {
      const sendMock = jest.fn().mockResolvedValue({});
      const modLogsChannel: any = {
        id: 'chan-mod-logs',
        name: 'mod-logs',
        type: ChannelType.GuildText,
        send: sendMock,
      };

      const channelsCache = new Collection<string, any>();
      channelsCache.set('chan-mod-logs', modLogsChannel);

      const guild: any = {
        id: 'guild-123',
        channels: { cache: channelsCache },
      };

      await logRewardSparksAudit(guild, {
        actorId: 'user-founder-1',
        actorTag: 'Founder#0001',
        guildId: 'guild-123',
        amount: 2500,
        reason: 'Operational rewards test',
        actionId: 'uuid-1234',
        timestamp: '2026-09-05T08:00:00.000Z',
        result: 'SUCCESS',
        newCash: 7500,
        newTotal: 17500,
      });

      expect(sendMock).toHaveBeenCalledTimes(1);
      const callArg = sendMock.mock.calls[0][0];
      expect(callArg.embeds).toBeDefined();
      const embed = callArg.embeds[0].data;
      expect(embed.title).toBe('✨ Staff Sparks Grant');
      expect(embed.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Action', value: '`STAFF_REWARD_SPARKS`' }),
          expect.objectContaining({ name: 'Result', value: '`SUCCESS`' }),
          expect.objectContaining({ name: 'Amount', value: '**+2,500 Sparks**' }),
        ])
      );
    });

    test('posts failure embed to #mod-logs on error', async () => {
      const sendMock = jest.fn().mockResolvedValue({});
      const modLogsChannel: any = {
        id: 'chan-mod-logs',
        name: 'mod-logs',
        type: ChannelType.GuildText,
        send: sendMock,
      };

      const channelsCache = new Collection<string, any>();
      channelsCache.set('chan-mod-logs', modLogsChannel);

      const guild: any = {
        id: 'guild-123',
        channels: { cache: channelsCache },
      };

      await logRewardSparksAudit(guild, {
        actorId: 'user-founder-1',
        actorTag: 'Founder#0001',
        guildId: 'guild-123',
        amount: 5000,
        reason: 'Operational test fail',
        actionId: 'uuid-5678',
        timestamp: '2026-09-05T08:00:00.000Z',
        result: 'FAILED',
        error: 'UBB 429 Rate Limit',
      });

      expect(sendMock).toHaveBeenCalledTimes(1);
      const embed = sendMock.mock.calls[0][0].embeds[0].data;
      expect(embed.title).toBe('❌ Staff Sparks Grant Failed');
      expect(embed.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Result', value: '`FAILED`' }),
          expect.objectContaining({ name: 'Error Details', value: 'UBB 429 Rate Limit' }),
        ])
      );
    });

    test('gracefully succeeds without throwing when #mod-logs channel does not exist', async () => {
      const guild: any = {
        id: 'guild-123',
        channels: { cache: new Collection() },
      };

      await expect(
        logRewardSparksAudit(guild, {
          actorId: 'user-founder-1',
          guildId: 'guild-123',
          amount: 500,
          reason: 'Testing silent audit',
          actionId: 'uuid-noop',
          timestamp: '2026-09-05T08:00:00.000Z',
          result: 'SUCCESS',
        })
      ).resolves.not.toThrow();
    });
  });

  describe('modConfirmation markFailed Terminal State', () => {
    const {
      createPendingModAction,
      atomicConfirmModAction,
      markFailed,
      getPendingModAction,
      _resetModConfirmationStore,
    } = require('../../services/discord/modConfirmation');

    beforeEach(() => {
      _resetModConfirmationStore();
    });

    test('transitions action from CONFIRMED to FAILED terminal state', () => {
      const action = createPendingModAction({
        guildId: 'guild-1',
        moderatorId: 'mod-1',
        actionType: 'REWARD_SPARKS',
        amount: 1000,
        reason: 'Test grant failure',
      });

      // Confirm
      const confirmRes = atomicConfirmModAction(action.id, 'mod-1', 'guild-1');
      expect(confirmRes.success).toBe(true);
      expect(getPendingModAction(action.id)?.status).toBe('CONFIRMED');

      // Mark Failed
      const failedRes = markFailed(action.id);
      expect(failedRes).toBe(true);
      expect(getPendingModAction(action.id)?.status).toBe('FAILED');

      // Attempt second confirmation after failure must be rejected
      const retryConfirm = atomicConfirmModAction(action.id, 'mod-1', 'guild-1');
      expect(retryConfirm.success).toBe(false);
      expect(retryConfirm.error).toContain('cannot be confirmed again');
    });

    test('markFailed returns false for non-existent actionId', () => {
      expect(markFailed('non-existent-id')).toBe(false);
    });

    test('markFailed does not transition from already EXECUTED or CANCELLED', () => {
      const action = createPendingModAction({
        guildId: 'guild-1',
        moderatorId: 'mod-1',
        actionType: 'REWARD_SPARKS',
        amount: 500,
        reason: 'Test terminal state',
      });

      const { markExecuted } = require('../../services/discord/modConfirmation');
      atomicConfirmModAction(action.id, 'mod-1', 'guild-1');
      markExecuted(action.id);
      expect(getPendingModAction(action.id)?.status).toBe('EXECUTED');

      // Calling markFailed on already executed action returns false
      expect(markFailed(action.id)).toBe(false);
      expect(getPendingModAction(action.id)?.status).toBe('EXECUTED');
    });
  });
});
