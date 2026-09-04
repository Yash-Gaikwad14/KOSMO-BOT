// src/tests/discord/confirmation.test.ts

import { Guild, ButtonInteraction } from 'discord.js';
import { PlanService } from '../../services/discord/plan';
import { confirmAndExecutePlan, cancelPlan } from '../../services/discord/confirmation';
import { handleConfirmationButton } from '../../commands/kosmo/manage';
import { DiscordAction, Plan } from '../../services/discord/types';

describe('Phase 3D Human Confirmation & Controlled Discord Execution', () => {
  const founderRoleIds = ['111111111111111111'];
  const teamKosmoRoleIds = ['222222222222222222'];
  const adminRoleIds = ['333333333333333333'];
  const moderatorRoleIds = ['444444444444444444'];
  const unauthorizedRoleIds = ['999999999999999999'];
  const emptyRoleIds: string[] = [];

  let mockGuild: any;

  beforeEach(() => {
    PlanService.clearPendingPlans();
    jest.clearAllMocks();

    mockGuild = {
      id: 'guild-123',
      name: 'Test Guild',
      ownerId: 'owner-id-123',
      roles: {
        cache: new Map(),
        create: jest.fn().mockResolvedValue({ id: 'new-role-id', name: 'CreatedRole' }),
      },
      channels: {
        cache: new Map(),
        create: jest.fn().mockResolvedValue({ id: 'new-chan-id', name: 'created-channel' }),
      },
      members: {
        fetch: jest.fn().mockResolvedValue({
          roles: { cache: new Map(), add: jest.fn().mockResolvedValue(undefined) },
          user: { tag: 'TestUser#0001' },
        }),
      },
    } as unknown as Guild;
  });

  // Helper to create and store a valid test plan
  function createTestPlan(actions: DiscordAction[] = []): Plan {
    const defaultActions: DiscordAction[] = actions.length > 0 ? actions : [
      { type: 'createRole', payload: { name: 'TestRole' } },
    ];
    const plan = PlanService.createPlan('Test Plan', 'A test plan for confirmation', defaultActions, 'user-creator');
    PlanService.storePlan(plan);
    return plan;
  }

  // =========================================================================
  // 1. AUTHORIZED CONFIRMATION
  // =========================================================================
  describe('Authorized Confirmation & Execution', () => {
    test('1. Server OWNER can confirm and execute even without configured roles', async () => {
      const plan = createTestPlan();
      const ownerContext = { userId: 'owner-id-123', guildOwnerId: 'owner-id-123' };

      const result = await confirmAndExecutePlan(mockGuild, plan.id, emptyRoleIds, ownerContext);

      expect(result.success).toBe(true);
      expect(result.status).toBe('EXECUTED');
      expect(plan.status).toBe('EXECUTED');
      expect(result.message).toContain('Action confirmed and executed');
      expect(mockGuild.roles.create).toHaveBeenCalledTimes(1);
    });

    test('2. FOUNDER can confirm and execute a valid plan', async () => {
      const plan = createTestPlan();
      const nonOwnerContext = { userId: 'founder-user', guildOwnerId: 'owner-id-123' };

      const result = await confirmAndExecutePlan(mockGuild, plan.id, founderRoleIds, nonOwnerContext);

      expect(result.success).toBe(true);
      expect(result.status).toBe('EXECUTED');
      expect(plan.status).toBe('EXECUTED');
      expect(mockGuild.roles.create).toHaveBeenCalledTimes(1);
    });

    test('3. TEAM_KOSMO can confirm and execute a valid plan', async () => {
      const plan = createTestPlan();
      const nonOwnerContext = { userId: 'team-user', guildOwnerId: 'owner-id-123' };

      const result = await confirmAndExecutePlan(mockGuild, plan.id, teamKosmoRoleIds, nonOwnerContext);

      expect(result.success).toBe(true);
      expect(result.status).toBe('EXECUTED');
      expect(plan.status).toBe('EXECUTED');
      expect(mockGuild.roles.create).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // 2. UNAUTHORIZED CONFIRMATION
  // =========================================================================
  describe('Unauthorized Confirmation Rejection', () => {
    test('4. Unauthorized user cannot confirm a plan; plan remains PROPOSED and actions do not run', async () => {
      const plan = createTestPlan();
      const nonOwnerContext = { userId: 'unauthorized-user', guildOwnerId: 'owner-id-123' };

      const result = await confirmAndExecutePlan(mockGuild, plan.id, unauthorizedRoleIds, nonOwnerContext);

      expect(result.success).toBe(false);
      expect(result.unauthorized).toBe(true);
      expect(result.status).toBe('PROPOSED');
      expect(plan.status).toBe('PROPOSED');
      expect(mockGuild.roles.create).not.toHaveBeenCalled();
    });

    test('5. MODERATOR cannot confirm actions; plan remains PROPOSED', async () => {
      const plan = createTestPlan();
      const nonOwnerContext = { userId: 'mod-user', guildOwnerId: 'owner-id-123' };

      const result = await confirmAndExecutePlan(mockGuild, plan.id, moderatorRoleIds, nonOwnerContext);

      expect(result.success).toBe(false);
      expect(result.unauthorized).toBe(true);
      expect(result.status).toBe('PROPOSED');
      expect(plan.status).toBe('PROPOSED');
      expect(mockGuild.roles.create).not.toHaveBeenCalled();
    });

    test('6. ADMIN cannot bypass REQUIRES_FOUNDERS_APPROVAL rule; plan remains PROPOSED', async () => {
      const plan = createTestPlan();
      const nonOwnerContext = { userId: 'admin-user', guildOwnerId: 'owner-id-123' };

      const result = await confirmAndExecutePlan(mockGuild, plan.id, adminRoleIds, nonOwnerContext);

      expect(result.success).toBe(false);
      expect(result.requiresFounderApproval).toBe(true);
      expect(result.status).toBe('PROPOSED');
      expect(plan.status).toBe('PROPOSED');
      expect(result.message).toMatch(/Founder or Team Kosmo approval/i);
      expect(mockGuild.roles.create).not.toHaveBeenCalled();
    });

    test('7. NONE (empty roles, non-owner) cannot confirm', async () => {
      const plan = createTestPlan();
      const nonOwnerContext = { userId: 'nobody', guildOwnerId: 'owner-id-123' };

      const result = await confirmAndExecutePlan(mockGuild, plan.id, emptyRoleIds, nonOwnerContext);

      expect(result.success).toBe(false);
      expect(result.unauthorized).toBe(true);
      expect(plan.status).toBe('PROPOSED');
      expect(mockGuild.roles.create).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. EXECUTION SAFETY & PERMISSION VALIDATOR ENFORCEMENT
  // =========================================================================
  describe('Execution Safety & Tamper Protection', () => {
    test('8. PermissionValidator runs immediately before execution; tampered plan with Administrator grant is blocked', async () => {
      const tamperedAction: DiscordAction = {
        type: 'applyPermissionTemplate',
        payload: {
          targetName: 'general',
          permissionOverwrites: [
            { id: 'role-1', allow: ['Administrator'] },
          ],
        },
      };

      const plan = createTestPlan([tamperedAction]);
      // Force status to PROPOSED to test pre-execution safety check
      plan.status = 'PROPOSED';

      const ownerContext = { userId: 'owner-id-123', guildOwnerId: 'owner-id-123' };
      const result = await confirmAndExecutePlan(mockGuild, plan.id, emptyRoleIds, ownerContext);

      expect(result.success).toBe(false);
      expect(result.status).toBe('REJECTED');
      expect(plan.status).toBe('REJECTED');
      expect(result.message).toMatch(/Administrator/i);
    });

    test('9. Protected role deletion is blocked during execution', async () => {
      const deleteFounderAction: DiscordAction = {
        type: 'deleteRole',
        payload: { roleName: 'Founder' },
      };

      const plan = createTestPlan([deleteFounderAction]);
      plan.status = 'PROPOSED';

      const ownerContext = { userId: 'owner-id-123', guildOwnerId: 'owner-id-123' };
      const result = await confirmAndExecutePlan(mockGuild, plan.id, emptyRoleIds, ownerContext);

      expect(result.success).toBe(false);
      expect(result.status).toBe('REJECTED');
      expect(result.message).toMatch(/privileged role/i);
    });
  });

  // =========================================================================
  // 4. PLAN LIFECYCLE, DUPLICATE CONFIRMATION & CANCELLATION
  // =========================================================================
  describe('Plan Lifecycle & Double Confirmation Prevention', () => {
    test('10. Confirm executes exactly once; double confirmation does not execute twice', async () => {
      const plan = createTestPlan();
      const ownerContext = { userId: 'owner-id-123', guildOwnerId: 'owner-id-123' };

      // First confirmation
      const firstResult = await confirmAndExecutePlan(mockGuild, plan.id, emptyRoleIds, ownerContext);
      expect(firstResult.success).toBe(true);
      expect(firstResult.status).toBe('EXECUTED');
      expect(mockGuild.roles.create).toHaveBeenCalledTimes(1);

      // Second confirmation attempt
      const secondResult = await confirmAndExecutePlan(mockGuild, plan.id, emptyRoleIds, ownerContext);
      expect(secondResult.success).toBe(false);
      expect(secondResult.message).toMatch(/already been executed/i);
      // Ensure roles.create was NOT called again
      expect(mockGuild.roles.create).toHaveBeenCalledTimes(1);
    });

    test('11. Cancel prevents execution; cancelled plan cannot be confirmed', async () => {
      const plan = createTestPlan();
      const ownerContext = { userId: 'owner-id-123', guildOwnerId: 'owner-id-123' };

      // Cancel the plan
      const cancelResult = cancelPlan(plan.id, emptyRoleIds, ownerContext);
      expect(cancelResult.success).toBe(true);
      expect(cancelResult.status).toBe('CANCELLED');
      expect(plan.status).toBe('CANCELLED');

      // Attempting to confirm cancelled plan must fail
      const confirmResult = await confirmAndExecutePlan(mockGuild, plan.id, emptyRoleIds, ownerContext);
      expect(confirmResult.success).toBe(false);
      expect(confirmResult.message).toMatch(/cancelled/i);
      expect(mockGuild.roles.create).not.toHaveBeenCalled();
    });

    test('12. Invalid or stale plan IDs cannot be confirmed', async () => {
      const ownerContext = { userId: 'owner-id-123', guildOwnerId: 'owner-id-123' };
      const result = await confirmAndExecutePlan(mockGuild, 'non-existent-plan-id', emptyRoleIds, ownerContext);

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/not found or expired/i);
    });
  });

  // =========================================================================
  // 5. DISCORD BUTTON INTERACTION HANDLER
  // =========================================================================
  describe('Discord Button Interaction Handler (handleConfirmationButton)', () => {
    test('13. Clicking [Confirm] button as Founder confirms and updates embed', async () => {
      const plan = createTestPlan();

      const mockButtonInteraction = {
        customId: `kosmo_confirm_${plan.id}`,
        guild: mockGuild,
        user: { id: 'founder-user', username: 'FounderUser' },
        member: { roles: founderRoleIds },
        reply: jest.fn(),
        update: jest.fn(),
      } as unknown as ButtonInteraction;

      await handleConfirmationButton(mockButtonInteraction);

      expect(mockButtonInteraction.update).toHaveBeenCalledTimes(1);
      const updatePayload = (mockButtonInteraction.update as jest.Mock).mock.calls[0][0];
      expect(updatePayload.embeds).toBeDefined();
      expect(updatePayload.embeds[0].data.title).toContain('CONFIRMED & EXECUTED');
      expect(plan.status).toBe('EXECUTED');
      expect(mockGuild.roles.create).toHaveBeenCalledTimes(1);
    });

    test('14. Clicking [Confirm] button as Unauthorized user sends ephemeral error', async () => {
      const plan = createTestPlan();

      const mockButtonInteraction = {
        customId: `kosmo_confirm_${plan.id}`,
        guild: mockGuild,
        user: { id: 'random-user', username: 'RandomUser' },
        member: { roles: unauthorizedRoleIds },
        reply: jest.fn(),
        update: jest.fn(),
      } as unknown as ButtonInteraction;

      await handleConfirmationButton(mockButtonInteraction);

      expect(mockButtonInteraction.reply).toHaveBeenCalledWith({
        content: expect.stringMatching(/not authorized/i),
        ephemeral: true,
      });
      expect(mockButtonInteraction.update).not.toHaveBeenCalled();
      expect(plan.status).toBe('PROPOSED');
      expect(mockGuild.roles.create).not.toHaveBeenCalled();
    });

    test('15. Clicking [Cancel] button cancels plan and updates embed', async () => {
      const plan = createTestPlan();

      const mockButtonInteraction = {
        customId: `kosmo_cancel_${plan.id}`,
        guild: mockGuild,
        user: { id: 'founder-user', username: 'FounderUser' },
        member: { roles: founderRoleIds },
        reply: jest.fn(),
        update: jest.fn(),
      } as unknown as ButtonInteraction;

      await handleConfirmationButton(mockButtonInteraction);

      expect(mockButtonInteraction.update).toHaveBeenCalledTimes(1);
      const updatePayload = (mockButtonInteraction.update as jest.Mock).mock.calls[0][0];
      expect(updatePayload.embeds[0].data.title).toContain('CANCELLED');
      expect(plan.status).toBe('CANCELLED');
      expect(mockGuild.roles.create).not.toHaveBeenCalled();
    });
  });
});
