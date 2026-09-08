// src/tests/discord/proposalExecution.test.ts

import { Guild, ButtonInteraction } from 'discord.js';
import {
  CommunityProposalService,
  MemoryProposalStorage,
  proposalService,
} from '../../services/ai/proposalService';
import { CommunityActionProposal } from '../../types/proposal';
import { DiscordAction } from '../../services/discord/types';
import { AuthLevel } from '../../services/discord/policy';
import { handleProposalButton } from '../../commands/community/community';
import * as actionsModule from '../../services/discord/actions';

describe('Phase 9.8: Proposal Confirmation, Controlled Non-Atomic Execution & Verification', () => {
  const founderRoleIds = ['111111111111111111'];
  const teamKosmoRoleIds = ['222222222222222222'];
  const adminRoleIds = ['333333333333333333'];
  const moderatorRoleIds = ['444444444444444444'];
  const emptyRoleIds: string[] = [];

  let service: CommunityProposalService;
  let mockStorage: MemoryProposalStorage;
  let mockGuild: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage = new MemoryProposalStorage();
    service = new CommunityProposalService(jest.fn(), mockStorage);

    mockGuild = {
      id: 'guild-abc',
      name: 'Kosmo Community',
      ownerId: 'owner-id-123',
      roles: {
        cache: new Map([
          ['role-artist', { id: 'role-artist', name: 'Community Artist' }],
        ]),
        create: jest.fn().mockResolvedValue({ id: 'role-artist', name: 'Community Artist' }),
      },
      channels: {
        cache: new Map([
          ['chan-1', { id: 'chan-1', name: 'creative-showcase' }],
        ]),
        create: jest.fn().mockResolvedValue({ id: 'chan-1', name: 'creative-showcase' }),
        fetch: jest.fn().mockResolvedValue({ id: 'chan-1', name: 'creative-showcase' }),
      },
      members: {
        cache: new Map(),
        fetch: jest.fn().mockResolvedValue({
          id: 'user-member-1',
          roles: {
            cache: new Map([['role-artist', { id: 'role-artist', name: 'Community Artist' }]]),
            add: jest.fn().mockResolvedValue(undefined),
            remove: jest.fn().mockResolvedValue(undefined),
          },
          user: { tag: 'TestMember#0001' },
        }),
      },
    } as unknown as Guild;
  });

  function createTestProposal(
    actions: DiscordAction[],
    overrides: Partial<CommunityActionProposal> = {}
  ): CommunityActionProposal {
    const createdAt = new Date();
    return {
      planId: `prop-9.8-test-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      guildId: 'guild-abc',
      creator: {
        userId: 'admin-user-1',
        username: 'AdminCreator',
        authLevel: AuthLevel.ADMIN,
      },
      expiration: new Date(createdAt.getTime() + 15 * 60 * 1000),
      sourceIntelligence: {
        summaryScope: 'COMMUNITY',
        messageCountAnalyzed: 50,
        diagnosticsTimestamp: createdAt.toISOString(),
      },
      rationale: 'Optimization proposal for test coverage.',
      actions,
      actionRisk: actions.some((a) => a.type === 'applyPermissionTemplate' || a.type === 'assignRole' || a.type === 'removeRole')
        ? 'HIGH'
        : 'LOW',
      validationStatus: { valid: true, errors: [] },
      createdAt,
      status: 'PENDING',
      ...overrides,
    };
  }

  describe('1. Authorization & Founder Approval for High-Risk Actions', () => {
    test('1a: Admin cannot confirm HIGH-RISK proposal; remains PENDING requiring Founder approval', async () => {
      const highRiskAction: DiscordAction = {
        type: 'applyPermissionTemplate',
        payload: {
          targetName: 'creative-showcase',
          permissionOverwrites: [{ id: '@everyone', allow: ['ViewChannel'] }],
        },
      };

      const proposal = createTestProposal([highRiskAction]);
      await mockStorage.storeProposal(proposal);

      const adminContext = { userId: 'admin-user-1', guildOwnerId: 'owner-id-123' };
      const result = await service.confirmAndExecuteProposal(
        mockGuild,
        proposal.planId,
        adminRoleIds,
        adminContext
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe('PENDING');
      expect(result.requiresFounderApproval).toBe(true);
      expect(result.message).toMatch(/Founder or Team Kosmo approval/i);

      // Proposal state in storage remains PENDING
      const stored = await mockStorage.getProposal(proposal.planId);
      expect(stored?.status).toBe('PENDING');
    });

    test('1b: Founder confirms Admin-created HIGH-RISK proposal (Creator/Confirmer separation)', async () => {
      const highRiskAction: DiscordAction = {
        type: 'createChannel',
        payload: { name: 'creative-showcase', type: 'GUILD_TEXT' },
      };

      const proposal = createTestProposal([highRiskAction]);
      await mockStorage.storeProposal(proposal);

      const founderContext = { userId: 'founder-user-1', guildOwnerId: 'owner-id-123' };
      const result = await service.confirmAndExecuteProposal(
        mockGuild,
        proposal.planId,
        founderRoleIds,
        founderContext
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe('VERIFIED');
      expect(result.proposal?.confirmedBy).toBe('founder-user-1');

      const stored = await mockStorage.getProposal(proposal.planId);
      expect(stored?.status).toBe('VERIFIED');
      expect(stored?.confirmedBy).toBe('founder-user-1');
    });

    test('1c: Server Owner confirms proposal without configured roles', async () => {
      const action: DiscordAction = {
        type: 'createRole',
        payload: { name: 'Community Artist' },
      };

      const proposal = createTestProposal([action]);
      await mockStorage.storeProposal(proposal);

      const ownerContext = { userId: 'owner-id-123', guildOwnerId: 'owner-id-123' };
      const result = await service.confirmAndExecuteProposal(
        mockGuild,
        proposal.planId,
        emptyRoleIds,
        ownerContext
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe('VERIFIED');
    });

    test('1d: Team Kosmo confirms proposal successfully', async () => {
      const action: DiscordAction = {
        type: 'createRole',
        payload: { name: 'Community Artist' },
      };

      const proposal = createTestProposal([action]);
      await mockStorage.storeProposal(proposal);

      const teamContext = { userId: 'team-user-1', guildOwnerId: 'owner-id-123' };
      const result = await service.confirmAndExecuteProposal(
        mockGuild,
        proposal.planId,
        teamKosmoRoleIds,
        teamContext
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe('VERIFIED');
    });

    test('1e: Moderator cannot confirm mutations (unauthorized)', async () => {
      const action: DiscordAction = {
        type: 'createRole',
        payload: { name: 'Community Artist' },
      };

      const proposal = createTestProposal([action]);
      await mockStorage.storeProposal(proposal);

      const modContext = { userId: 'mod-user-1', guildOwnerId: 'owner-id-123' };
      const result = await service.confirmAndExecuteProposal(
        mockGuild,
        proposal.planId,
        moderatorRoleIds,
        modContext
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe('PENDING');
      expect(result.unauthorized).toBe(true);
      expect(result.message).toMatch(/not authorized to confirm/i);
    });
  });

  describe('2. Replay Protection, Expiration & Guild Isolation', () => {
    test('2a: Replay prevention: cannot confirm an already confirmed/verified proposal', async () => {
      const action: DiscordAction = {
        type: 'createRole',
        payload: { name: 'Community Artist' },
      };

      const proposal = createTestProposal([action]);
      await mockStorage.storeProposal(proposal);

      const ownerContext = { userId: 'owner-id-123', guildOwnerId: 'owner-id-123' };

      // First confirmation succeeds
      const first = await service.confirmAndExecuteProposal(mockGuild, proposal.planId, emptyRoleIds, ownerContext);
      expect(first.success).toBe(true);

      // Second confirmation rejected
      const second = await service.confirmAndExecuteProposal(mockGuild, proposal.planId, emptyRoleIds, ownerContext);
      expect(second.success).toBe(false);
      expect(second.message).toMatch(/already been verified/i);
    });

    test('2b: Expiration: proposal older than 15-minute TTL transitions to EXPIRED and cannot execute', async () => {
      const action: DiscordAction = {
        type: 'createRole',
        payload: { name: 'Community Artist' },
      };

      const pastDate = new Date(Date.now() - 1000); // 1 second in the past
      const proposal = createTestProposal([action], { expiration: pastDate });
      await mockStorage.storeProposal(proposal);

      const ownerContext = { userId: 'owner-id-123', guildOwnerId: 'owner-id-123' };
      const result = await service.confirmAndExecuteProposal(mockGuild, proposal.planId, emptyRoleIds, ownerContext);

      expect(result.success).toBe(false);
      expect(result.status).toBe('EXPIRED');
      expect(result.message).toMatch(/has expired/i);
    });

    test('2c: Guild isolation: cross-guild confirmation attempts are rejected', async () => {
      const action: DiscordAction = {
        type: 'createRole',
        payload: { name: 'Community Artist' },
      };

      const proposal = createTestProposal([action], { guildId: 'different-guild-999' });
      await mockStorage.storeProposal(proposal);

      const ownerContext = { userId: 'owner-id-123', guildOwnerId: 'owner-id-123' };
      const result = await service.confirmAndExecuteProposal(mockGuild, proposal.planId, emptyRoleIds, ownerContext);

      expect(result.success).toBe(false);
      expect(result.status).toBe('REJECTED');
      expect(result.message).toMatch(/does not belong to this server/i);
    });
  });

  describe('3. Non-Atomic Sequential Execution & Partial Failure Handling', () => {
    test('3a: Partial failure stops execution; earlier actions remain; later actions NOT executed', async () => {
      const action1: DiscordAction = { type: 'createRole', payload: { name: 'Community Artist' } };
      const action2: DiscordAction = { type: 'createRole', payload: { name: 'ExplodingRole' } };
      const action3: DiscordAction = { type: 'createRole', payload: { name: 'ThirdActionNeverReached' } };

      const proposal = createTestProposal([action1, action2, action3]);
      await mockStorage.storeProposal(proposal);

      // Mock runAction: Action 1 succeeds, Action 2 throws error
      jest.spyOn(actionsModule, 'runAction').mockImplementation(async (guild, action) => {
        if ((action.payload as any).name === 'ExplodingRole') {
          throw new Error('Discord API 50013: Missing Permissions');
        }
        return `Created role "${(action.payload as any).name}".`;
      });

      const ownerContext = { userId: 'owner-id-123', guildOwnerId: 'owner-id-123' };
      const result = await service.confirmAndExecuteProposal(mockGuild, proposal.planId, emptyRoleIds, ownerContext);

      // Verify non-atomic partial failure
      expect(result.success).toBe(false);
      expect(result.status).toBe('PARTIALLY_FAILED');
      expect(result.failedActionIndex).toBe(1);
      expect(result.executionResults).toEqual(['Created role "Community Artist".']);
      expect(result.message).toContain('Missing Permissions');

      // Verify Action 3 was NEVER executed
      const stored = await mockStorage.getProposal(proposal.planId);
      expect(stored?.status).toBe('PARTIALLY_FAILED');
      expect(stored?.executionResults).toHaveLength(1);
    });

    test('3b: Immediate failure on Action 1 transitions status to FAILED', async () => {
      const action1: DiscordAction = { type: 'createRole', payload: { name: 'FailingFirstAction' } };
      const proposal = createTestProposal([action1]);
      await mockStorage.storeProposal(proposal);

      jest.spyOn(actionsModule, 'runAction').mockRejectedValue(new Error('Discord 403 Forbidden'));

      const ownerContext = { userId: 'owner-id-123', guildOwnerId: 'owner-id-123' };
      const result = await service.confirmAndExecuteProposal(mockGuild, proposal.planId, emptyRoleIds, ownerContext);

      expect(result.success).toBe(false);
      expect(result.status).toBe('FAILED');
      expect(result.failedActionIndex).toBe(0);
      expect(result.executionResults).toEqual([]);
    });

    test('3c: Verification failure after mutation stops execution and marks VERIFICATION_FAILED', async () => {
      const action1: DiscordAction = { type: 'createRole', payload: { name: 'GhostRole' } };
      const action2: DiscordAction = { type: 'createRole', payload: { name: 'NeverExecutedRole' } };

      const proposal = createTestProposal([action1, action2]);
      await mockStorage.storeProposal(proposal);

      // runAction succeeds
      jest.spyOn(actionsModule, 'runAction').mockResolvedValue('Role created.');

      // Mock verifyActionState returning failure
      jest.spyOn(service, 'verifyActionState').mockResolvedValue({
        success: false,
        reason: 'Role "GhostRole" not found in Discord after creation.',
      });

      const ownerContext = { userId: 'owner-id-123', guildOwnerId: 'owner-id-123' };
      const result = await service.confirmAndExecuteProposal(mockGuild, proposal.planId, emptyRoleIds, ownerContext);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Verification failed for action 1');

      const stored = await mockStorage.getProposal(proposal.planId);
      expect((stored?.status as any)).toBe('VERIFICATION_FAILED');
    });
  });

  describe('4. Execution Locks & Redis Failure Resilience', () => {
    test('4a: Distributed execution lock prevents concurrent proposal runs on same guild', async () => {
      const action: DiscordAction = { type: 'createRole', payload: { name: 'Community Artist' } };
      const proposal1 = createTestProposal([action]);
      const proposal2 = createTestProposal([action]);

      await mockStorage.storeProposal(proposal1);
      await mockStorage.storeProposal(proposal2);

      // Acquire lock for guild artificially to simulate ongoing execution
      await mockStorage.acquireExecutionLock(mockGuild.id, 60);

      const ownerContext = { userId: 'owner-id-123', guildOwnerId: 'owner-id-123' };
      const result = await service.confirmAndExecuteProposal(mockGuild, proposal1.planId, emptyRoleIds, ownerContext);

      expect(result.success).toBe(false);
      expect(result.status).toBe('FAILED');
      expect(result.message).toMatch(/Another proposal execution is currently active/i);
    });

    test('4b: Storage/Redis failure fails closed without modifying Discord state', async () => {
      const action: DiscordAction = { type: 'createRole', payload: { name: 'Community Artist' } };
      const proposal = createTestProposal([action]);
      await mockStorage.storeProposal(proposal);

      // Simulate storage outage
      mockStorage.setSimulateUnavailable(true);

      const ownerContext = { userId: 'owner-id-123', guildOwnerId: 'owner-id-123' };
      const result = await service.confirmAndExecuteProposal(mockGuild, proposal.planId, emptyRoleIds, ownerContext);

      expect(result.success).toBe(false);
      expect(result.status).toBe('FAILED');
      expect(result.message).toMatch(/Storage infrastructure \(Redis\) unavailable/i);
    });
  });

  describe('5. Discord Button UI Interaction Handling', () => {
    test('5a: handleProposalButton correctly processes cancellation', async () => {
      const action: DiscordAction = { type: 'createRole', payload: { name: 'Community Artist' } };
      const proposal = createTestProposal([action]);
      await proposalService.getStorage().storeProposal(proposal);

      const mockInteraction = {
        customId: `community_cancel_${proposal.planId}`,
        guild: mockGuild,
        user: { id: 'admin-user-1', username: 'AdminUser' },
        member: { roles: adminRoleIds },
        update: jest.fn().mockResolvedValue(undefined),
        reply: jest.fn().mockResolvedValue(undefined),
        deferred: false,
        replied: false,
      } as unknown as ButtonInteraction;

      await handleProposalButton(mockInteraction);

      expect(mockInteraction.update).toHaveBeenCalled();
      const updatePayload = (mockInteraction.update as jest.Mock).mock.calls[0][0];
      expect(updatePayload.embeds[0].data.title).toMatch(/Cancelled/i);

      const stored = await proposalService.getStorage().getProposal(proposal.planId);
      expect(stored?.status).toBe('CANCELLED');
    });
  });
});
