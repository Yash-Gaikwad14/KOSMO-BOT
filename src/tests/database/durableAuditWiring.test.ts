// src/tests/database/durableAuditWiring.test.ts

import {
  setAuditRepository,
  InMemoryAuditRepository,
  IAuditRepository,
} from '../../services/database/auditRepository';
import { logTicketAudit } from '../../services/support/ticketService';
import { logSummaryAudit } from '../../services/ai/summarizerService';
import { proposalService } from '../../services/ai/proposalService';
import { logRewardSparksAudit } from '../../services/economy/rewardService';
import { premiumSyncService } from '../../services/payments/premiumService';
import {
  MockPremiumEntitlementProvider,
  setPremiumEntitlementProvider,
} from '../../services/payments/entitlementProvider';
import { execute as executeModCommand } from '../../commands/moderation/mod';
import { ChannelType, Collection, PermissionFlagsBits } from 'discord.js';
import { AuthLevel } from '../../services/discord/policy';

describe('DB-3A: Durable Audit Repository Wiring', () => {
  let memoryAuditRepo: InMemoryAuditRepository;

  beforeEach(async () => {
    memoryAuditRepo = new InMemoryAuditRepository();
    setAuditRepository(memoryAuditRepo);
  });

  afterEach(() => {
    setAuditRepository(null);
  });

  describe('1. logTicketAudit wiring', () => {
    test('successful ticket action persists structured metadata-only event to PostgreSQL and calls #mod-logs', async () => {
      const mockSend = jest.fn().mockResolvedValue({});
      const modLogsChannel = {
        id: 'chan-mod-logs',
        name: 'mod-logs',
        send: mockSend,
      };
      const mockGuild: any = {
        id: 'guild-ticket-1',
        channels: { cache: new Map([['chan-mod-logs', modLogsChannel]]) },
      };

      await logTicketAudit(mockGuild, {
        guildId: 'guild-ticket-1',
        channelId: 'chan-ticket-99',
        channelName: 'ticket-alice',
        actorId: 'mod-123',
        actorTag: 'ModUser#1234',
        action: 'TICKET_ROUTE',
        destinationCategory: 'FEEDBACK & SUPPORT',
        details: 'Routing ticket based on staff inspection',
        status: 'SUCCESS',
        timestamp: new Date(),
      });

      // 1. Verify Discord #mod-logs received embed
      expect(mockSend).toHaveBeenCalledTimes(1);

      // 2. Verify PostgreSQL auditRepository recorded event
      const events = await memoryAuditRepo.listRecentEvents('guild-ticket-1');
      expect(events.length).toBe(1);
      const ev = events[0];
      expect(ev.actionType).toBe('TICKET_TICKET_ROUTE');
      expect(ev.actorId).toBe('mod-123');
      expect(ev.targetId).toBe('chan-ticket-99');
      expect(ev.status).toBe('SUCCESS');
      expect(ev.metadata).toMatchObject({
        channelId: 'chan-ticket-99',
        channelName: 'ticket-alice',
        actorTag: 'ModUser#1234',
        destinationCategory: 'FEEDBACK & SUPPORT',
        details: 'Routing ticket based on staff inspection',
      });
      // Safety: ensure no raw messages or transcript text leaked
      expect(ev.metadata).not.toHaveProperty('transcript');
      expect(ev.metadata).not.toHaveProperty('rawMessages');
    });

    test('audit repository failure does not disrupt Discord #mod-logs logging or throw', async () => {
      const failingRepo: IAuditRepository = {
        recordEvent: jest.fn().mockRejectedValue(new Error('PostgreSQL connection timeout')),
        listRecentEvents: jest.fn().mockResolvedValue([]),
        listEventsByAction: jest.fn().mockResolvedValue([]),
      };
      setAuditRepository(failingRepo);

      const mockSend = jest.fn().mockResolvedValue({});
      const modLogsChannel = {
        id: 'chan-mod-logs',
        name: 'mod-logs',
        send: mockSend,
      };
      const mockGuild: any = {
        id: 'guild-ticket-2',
        channels: { cache: new Map([['chan-mod-logs', modLogsChannel]]) },
      };

      await expect(
        logTicketAudit(mockGuild, {
          guildId: 'guild-ticket-2',
          channelId: 'chan-ticket-100',
          channelName: 'ticket-bob',
          actorId: 'mod-456',
          actorTag: 'ModUser#4567',
          action: 'TICKET_CLOSE_REQUEST',
          status: 'SUCCESS',
          timestamp: new Date(),
        })
      ).resolves.not.toThrow();

      // Discord embed must still be dispatched even if DB recordEvent threw
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('2. logSummaryAudit wiring', () => {
    test('summary audit persists structured metadata-only event to PostgreSQL and calls #mod-logs', async () => {
      const mockSend = jest.fn().mockResolvedValue({});
      const modLogsChannel = {
        id: 'chan-mod-logs',
        name: 'mod-logs',
        send: mockSend,
      };
      const mockGuild: any = {
        id: 'guild-summary-1',
        channels: { cache: new Map([['chan-mod-logs', modLogsChannel]]) },
      };

      await logSummaryAudit(mockGuild, {
        actorId: 'user-sum-1',
        actorTag: 'SummaryCaller#0001',
        scope: 'CHANNEL',
        targetChannelId: 'chan-general',
        messagesAnalyzed: 50,
        authorsCount: 12,
        action: 'COMMUNITY_SUMMARY_REQUESTED',
        status: 'SUCCESS',
        truncated: false,
        executionTimeMs: 420,
        timestamp: new Date(),
      });

      expect(mockSend).toHaveBeenCalledTimes(1);

      const events = await memoryAuditRepo.listRecentEvents('guild-summary-1');
      expect(events.length).toBe(1);
      const ev = events[0];
      expect(ev.actionType).toBe('SUMMARY_COMMUNITY_SUMMARY_REQUESTED');
      expect(ev.actorId).toBe('user-sum-1');
      expect(ev.targetId).toBe('chan-general');
      expect(ev.status).toBe('SUCCESS');
      expect(ev.metadata).toMatchObject({
        scope: 'CHANNEL',
        targetChannelId: 'chan-general',
        messagesAnalyzed: 50,
        authorsCount: 12,
        truncated: false,
      });
      // Safety: Never store raw summaries, prompts, or content
      expect(ev.metadata).not.toHaveProperty('prompt');
      expect(ev.metadata).not.toHaveProperty('summaryText');
      expect(ev.metadata).not.toHaveProperty('rawContent');
    });

    test('summary audit persistence failure is non-blocking to Discord embed and execution', async () => {
      const failingRepo: IAuditRepository = {
        recordEvent: jest.fn().mockRejectedValue(new Error('DB pool exhausted')),
        listRecentEvents: jest.fn().mockResolvedValue([]),
        listEventsByAction: jest.fn().mockResolvedValue([]),
      };
      setAuditRepository(failingRepo);

      const mockSend = jest.fn().mockResolvedValue({});
      const modLogsChannel = {
        id: 'chan-mod-logs',
        name: 'mod-logs',
        send: mockSend,
      };
      const mockGuild: any = {
        id: 'guild-summary-2',
        channels: { cache: new Map([['chan-mod-logs', modLogsChannel]]) },
      };

      await expect(
        logSummaryAudit(mockGuild, {
          actorId: 'user-sum-2',
          actorTag: 'Caller#2',
          scope: 'CHANNEL',
          targetChannelId: 'chan-support',
          messagesAnalyzed: 25,
          authorsCount: 5,
          action: 'COMMUNITY_SUMMARY_REQUESTED',
          status: 'PARTIAL',
          truncated: true,
          executionTimeMs: 150,
          timestamp: new Date(),
        })
      ).resolves.not.toThrow();

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('3. proposalService audit wiring', () => {
    test('proposal logAudit persists structured audit records to PostgreSQL', async () => {
      await proposalService.logAudit({
        action: 'COMMUNITY_PROPOSAL_CONFIRMED',
        planId: 'prop-plan-123',
        guildId: 'guild-prop-test',
        actorId: 'user-founder-1',
        riskLevel: 'LOW',
        actionCount: 2,
        details: 'Community proposal approved',
        timestamp: new Date(),
      });

      const events = await memoryAuditRepo.listRecentEvents('guild-prop-test');
      expect(events.length).toBe(1);
      const ev = events[0];
      expect(ev.guildId).toBe('guild-prop-test');
      expect(ev.actionType).toBe('COMMUNITY_PROPOSAL_CONFIRMED');
      expect(ev.actorId).toBe('user-founder-1');
      expect(ev.status).toBe('SUCCESS');
      expect(ev.metadata).toMatchObject({
        planId: 'prop-plan-123',
        riskLevel: 'LOW',
        actionCount: 2,
        details: 'Community proposal approved',
      });
      expect(ev.metadata).not.toHaveProperty('systemPrompt');
      expect(ev.metadata).not.toHaveProperty('prompt');
    });

    test('proposal audit failure is non-blocking', async () => {
      const failingRepo: IAuditRepository = {
        recordEvent: jest.fn().mockRejectedValue(new Error('PostgreSQL timeout')),
        listRecentEvents: jest.fn().mockResolvedValue([]),
        listEventsByAction: jest.fn().mockResolvedValue([]),
      };
      setAuditRepository(failingRepo);

      expect(() => {
        proposalService.logAudit({
          action: 'COMMUNITY_PROPOSAL_REJECTED',
          planId: 'prop-plan-fail',
          guildId: 'guild-prop-fail',
          actorId: 'user-founder-2',
          timestamp: new Date(),
        });
      }).not.toThrow();
    });
  });

  describe('4. rewardService.logRewardSparksAudit wiring', () => {
    test('staff reward audit persists structured event and calls #mod-logs', async () => {
      const mockSend = jest.fn().mockResolvedValue({});
      const modLogsChannel = {
        id: 'chan-mod-logs',
        name: 'mod-logs',
        type: ChannelType.GuildText,
        send: mockSend,
      };
      const channelsCache = new Collection<string, any>();
      channelsCache.set('chan-mod-logs', modLogsChannel);
      const mockGuild: any = {
        id: 'guild-reward-1',
        channels: { cache: channelsCache },
      };

      await logRewardSparksAudit(mockGuild, {
        actorId: 'admin-1',
        actorTag: 'Admin#0001',
        guildId: 'guild-reward-1',
        amount: 250,
        reason: 'Community contribution bonus',
        actionId: 'act-reward-123',
        timestamp: new Date().toISOString(),
        result: 'SUCCESS',
        newCash: 500,
        newTotal: 500,
      });

      expect(mockSend).toHaveBeenCalledTimes(1);

      const events = await memoryAuditRepo.listRecentEvents('guild-reward-1');
      expect(events.length).toBe(1);
      const ev = events[0];
      expect(ev.actionType).toBe('STAFF_REWARD_SPARKS');
      expect(ev.actorId).toBe('admin-1');
      expect(ev.status).toBe('SUCCESS');
      expect(ev.metadata).toMatchObject({
        actionId: 'act-reward-123',
        actorTag: 'Admin#0001',
        amount: 250,
        reason: 'Community contribution bonus',
        newCash: 500,
        newTotal: 500,
      });
    });

    test('reward audit failure is non-blocking to Discord embed dispatch', async () => {
      const failingRepo: IAuditRepository = {
        recordEvent: jest.fn().mockRejectedValue(new Error('DB read-only mode')),
        listRecentEvents: jest.fn().mockResolvedValue([]),
        listEventsByAction: jest.fn().mockResolvedValue([]),
      };
      setAuditRepository(failingRepo);

      const mockSend = jest.fn().mockResolvedValue({});
      const modLogsChannel = {
        id: 'chan-mod-logs',
        name: 'mod-logs',
        type: ChannelType.GuildText,
        send: mockSend,
      };
      const channelsCache = new Collection<string, any>();
      channelsCache.set('chan-mod-logs', modLogsChannel);
      const mockGuild: any = {
        id: 'guild-reward-2',
        channels: { cache: channelsCache },
      };

      await expect(
        logRewardSparksAudit(mockGuild, {
          actorId: 'admin-2',
          actorTag: 'Admin#0002',
          guildId: 'guild-reward-2',
          amount: 100,
          reason: 'Trivia winner',
          actionId: 'act-reward-456',
          timestamp: new Date().toISOString(),
          result: 'SUCCESS',
        })
      ).resolves.not.toThrow();

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('5. premiumSyncService role sync durable audit wiring', () => {
    let mockProvider: MockPremiumEntitlementProvider;

    beforeEach(() => {
      mockProvider = new MockPremiumEntitlementProvider();
      setPremiumEntitlementProvider(mockProvider);
    });

    afterEach(() => {
      setPremiumEntitlementProvider(null);
    });

    test('syncMemberPremium records structured audit event to PostgreSQL and #mod-logs when roles change', async () => {
      const mockSend = jest.fn().mockResolvedValue({});
      const modLogsChannel = {
        id: 'chan-mod-logs',
        name: 'mod-logs',
        type: ChannelType.GuildText,
        send: mockSend,
      };

      const rolesMap = new Collection<string, any>();
      const botRole = { id: 'role-bot', name: 'KosmoBot', position: 50, permissions: { bitfield: BigInt(0), has: () => true } };
      const maxRole = { id: 'role-max', name: 'Kosmo Max', position: 30, permissions: { bitfield: BigInt(0), has: () => false } };
      const proRole = { id: 'role-pro', name: 'Kosmo Pro', position: 20, permissions: { bitfield: BigInt(0), has: () => false } };
      const vipRole = { id: 'role-vip', name: 'Kosmo VIP', position: 25, permissions: { bitfield: BigInt(0), has: () => false } };
      rolesMap.set(botRole.id, botRole);
      rolesMap.set(maxRole.id, maxRole);
      rolesMap.set(proRole.id, proRole);
      rolesMap.set(vipRole.id, vipRole);

      const memberRolesMap = new Collection<string, any>();
      const mockMember: any = {
        id: 'user-vip-1',
        user: { id: 'user-vip-1', tag: 'VipUser#1111', username: 'VipUser', bot: false },
        displayName: 'VipUser',
        roles: {
          cache: memberRolesMap,
          highest: { position: 5 },
          add: jest.fn().mockImplementation(async (r) => {
            memberRolesMap.set(r.id, r);
            return mockMember;
          }),
          remove: jest.fn().mockImplementation(async (r) => {
            memberRolesMap.delete(r.id);
            return mockMember;
          }),
        },
      };

      const membersMap = new Collection<string, any>();
      membersMap.set(mockMember.id, mockMember);

      const mockGuild: any = {
        id: 'guild-prem-1',
        name: 'Kosmo Community',
        roles: { cache: rolesMap },
        channels: { cache: new Collection([['chan-mod-logs', modLogsChannel]]) },
        members: {
          cache: membersMap,
          me: {
            id: 'bot-id',
            roles: { cache: new Collection([['role-bot', botRole]]), highest: botRole },
            permissions: { has: () => true },
          },
          fetch: jest.fn().mockResolvedValue(mockMember),
        },
      };

      await mockProvider.setEntitlement({
        targetId: 'user-vip-1',
        tier: 'MAX',
        status: 'ACTIVE',
        source: 'DATABASE_CACHE',
        updatedAt: new Date(),
      });

      const result = await premiumSyncService.syncMemberPremium(mockGuild, 'user-vip-1', {
        callerTag: 'Admin#0001',
      });

      expect(result.status).toBe('SUCCESS');
      expect(mockSend).toHaveBeenCalledTimes(1);

      const events = await memoryAuditRepo.listRecentEvents('guild-prem-1');
      expect(events.length).toBe(1);
      const ev = events[0];
      expect(ev.actionType).toBe('PREMIUM_ROLE_SYNC');
      expect(ev.targetId).toBe('user-vip-1');
      expect(ev.status).toBe('SUCCESS');
      expect(ev.metadata).toMatchObject({
        entitledTier: 'MAX',
        source: 'DATABASE_CACHE',
        callerTag: 'Admin#0001',
      });
      // Safety: ensure no tokens or secrets
      expect(ev.metadata).not.toHaveProperty('apiKey');
      expect(ev.metadata).not.toHaveProperty('secret');
    });
  });

  describe('6. moderation actions durable audit wiring', () => {
    test('moderation warn persists structured MOD_WARN event to PostgreSQL', async () => {
      const mockSend = jest.fn().mockResolvedValue({});
      const modLogsChannel = {
        id: 'chan-mod-logs',
        name: 'mod-logs',
        type: ChannelType.GuildText,
        send: mockSend,
      };

      const targetMember: any = {
        id: 'target-warn-1',
        user: { id: 'target-warn-1', tag: 'BadActor#0001', username: 'BadActor', bot: false },
        displayName: 'BadActor',
        roles: { cache: new Collection(), highest: { position: 1 } },
        send: jest.fn().mockResolvedValue({}),
      };

      const callerUser = { id: 'mod-user-1', tag: 'Staff#0001', username: 'Staff' };
      const callerRole = { id: 'role-mod', name: 'Moderator', position: 50 };
      const callerMember: any = {
        id: callerUser.id,
        user: callerUser,
        roles: {
          cache: new Collection([['role-mod', callerRole]]),
          highest: callerRole,
        },
      };

      const mockGuild: any = {
        id: 'guild-mod-test',
        name: 'Kosmo Community',
        ownerId: 'owner-id',
        channels: { cache: new Collection([['chan-mod-logs', modLogsChannel]]) },
        members: {
          cache: new Collection([
            [targetMember.id, targetMember],
            [callerMember.id, callerMember],
          ]),
          fetch: jest.fn().mockImplementation(async (id: string) => {
            if (id === targetMember.id) return targetMember;
            if (id === callerMember.id) return callerMember;
            throw new Error('Not found');
          }),
        },
      };

      const interaction: any = {
        guild: mockGuild,
        user: callerUser,
        member: callerMember,
        replied: false,
        deferred: false,
        options: {
          getSubcommand: jest.fn().mockReturnValue('warn'),
          getUser: jest.fn().mockReturnValue(targetMember.user),
          getMember: jest.fn().mockReturnValue(targetMember),
          getString: jest.fn().mockImplementation((name: string) => {
            if (name === 'reason') return 'Rule 1 violation';
            if (name === 'evidence') return 'https://example.com/evidence';
            return null;
          }),
        },
        reply: jest.fn().mockResolvedValue({}),
      };

      await executeModCommand(interaction);

      // Verify PostgreSQL received MOD_WARN
      const events = await memoryAuditRepo.listEventsByAction('guild-mod-test', 'MOD_WARN');
      expect(events.length).toBe(1);
      const ev = events[0];
      expect(ev.actionType).toBe('MOD_WARN');
      expect(ev.actorId).toBe('mod-user-1');
      expect(ev.targetId).toBe('target-warn-1');
      expect(ev.status).toBe('SUCCESS');
      expect(ev.metadata).toMatchObject({
        targetTag: 'BadActor#0001',
        moderatorTag: 'Staff#0001',
        reason: 'Rule 1 violation',
        hasEvidence: true,
        dmSent: true,
      });

      // Operational Discord log must have also been sent
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });
});
