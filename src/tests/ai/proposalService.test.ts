// src/tests/ai/proposalService.test.ts

import { Guild, ChannelType } from 'discord.js';
import {
  CommunityProposalService,
  MemoryProposalStorage,
} from '../../services/ai/proposalService';
import { AuthLevel } from '../../services/discord/policy';
import { contextService } from '../../services/ai/contextService';
import { PermissionValidator } from '../../services/discord/permissionValidator';

jest.mock('../../services/ai/contextService');

describe('Phase 9.8: CommunityProposalService', () => {
  let service: CommunityProposalService;
  let mockStorage: MemoryProposalStorage;
  let mockLLMCaller: jest.Mock;

  const mockGuild: Guild = {
    id: 'guild-test-99',
    name: 'Kosmo Community',
    ownerId: 'owner-user-1',
  } as unknown as Guild;

  const staffCreator = {
    userId: 'staff-user-1',
    username: 'StaffMember',
    authLevel: AuthLevel.MODERATOR,
  };

  const adminCreator = {
    userId: 'admin-user-1',
    username: 'AdminMember',
    authLevel: AuthLevel.ADMIN,
  };

  const unprivilegedCreator = {
    userId: 'guest-user-1',
    username: 'GuestMember',
    authLevel: AuthLevel.NONE,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage = new MemoryProposalStorage();
    mockLLMCaller = jest.fn();
    service = new CommunityProposalService(mockLLMCaller, mockStorage);
    service.resetStaffCooldowns();

    // Default mock for contextService returning safe public channels
    (contextService.getCommunityContext as jest.Mock).mockResolvedValue({
      guildId: 'guild-test-99',
      guildName: 'Kosmo Community',
      timestamp: new Date().toISOString(),
      channelsAnalyzed: 2,
      totalMessagesAnalyzed: 30,
      channels: [
        {
          channelId: 'chan-1',
          channelName: 'tech-and-engineering',
          classification: 'PUBLIC_COMMUNITY',
          messageCount: 20,
          activeAuthors: ['user-1', 'user-2'],
          status: 'SUCCESS',
        },
        {
          channelId: 'chan-2',
          channelName: 'creatives-lounge',
          classification: 'PUBLIC_COMMUNITY',
          messageCount: 10,
          activeAuthors: ['user-3'],
          status: 'SUCCESS',
        },
      ],
      truncated: false,
    });
  });

  describe('1. Proposal Generation & Schema Enforcement', () => {
    test('1a: Generates valid proposal with safe low-risk actions', async () => {
      mockLLMCaller.mockResolvedValue(
        JSON.stringify({
          planName: 'Expand Creative Discussions',
          rationale: 'High discussion density in creatives-lounge warrants dedicated showcase channel.',
          actions: [
            {
              type: 'createChannel',
              payload: {
                name: 'creative-showcase',
                type: 'GUILD_TEXT',
              },
            },
            {
              type: 'createRole',
              payload: {
                name: 'Community Artist',
                color: 0x3498db,
              },
            },
          ],
        })
      );

      const result = await service.generateProposal({
        guild: mockGuild,
        scope: 'COMMUNITY',
        creator: staffCreator,
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('PENDING');
      expect(result.proposal).toBeDefined();
      expect(result.proposal?.actions).toHaveLength(2);
      expect(result.proposal?.actionRisk).toBe('LOW');
      expect(result.proposal?.planId).toMatch(/^prop-9\.8-/);
      expect(result.proposal?.expiration.getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
    });

    test('1b: Rejects unknown or unapproved action types', async () => {
      mockLLMCaller.mockResolvedValue(
        JSON.stringify({
          planName: 'Invented Action Proposal',
          rationale: 'Trying to execute an unknown action.',
          actions: [
            {
              type: 'arbitraryWebhookExploit',
              payload: { url: 'https://attacker.com' },
            },
          ],
        })
      );

      const result = await service.generateProposal({
        guild: mockGuild,
        scope: 'COMMUNITY',
        creator: staffCreator,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('REJECTED');
      expect(result.message).toMatch(/Unrecognized or disallowed action type/i);
    });

    test('1c: Rejects destructive actions (deleteChannel, deleteRole, etc.)', async () => {
      mockLLMCaller.mockResolvedValue(
        JSON.stringify({
          planName: 'Destructive Cleanup',
          rationale: 'Pruning old channels.',
          actions: [
            {
              type: 'deleteChannel',
              payload: { channelName: 'old-chat' },
            },
          ],
        })
      );

      const result = await service.generateProposal({
        guild: mockGuild,
        scope: 'COMMUNITY',
        creator: staffCreator,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('REJECTED');
      expect(result.message).toMatch(/prohibited in community action proposals/i);
    });

    test('1d: Rejects punitive moderation actions (timeout, kick, ban, purge)', async () => {
      const punitiveActions = ['timeoutMember', 'kickMember', 'banMember', 'purgeMessages'];

      for (const pType of punitiveActions) {
        mockLLMCaller.mockResolvedValue(
          JSON.stringify({
            planName: `Punitive ${pType}`,
            rationale: 'Moderating user via proposal.',
            actions: [
              {
                type: pType,
                payload: { targetId: 'user-1', reason: 'Spamming' },
              },
            ],
          })
        );

        // Reset storage cooldown for creator
        (service as any).staffCooldowns.clear();

        const result = await service.generateProposal({
          guild: mockGuild,
          scope: 'COMMUNITY',
          creator: staffCreator,
        });

        expect(result.success).toBe(false);
        expect(result.status).toBe('REJECTED');
        expect(result.message).toMatch(/prohibited in community action proposals/i);
      }
    });
  });

  describe('2. Role Target Safety & Premium Boundaries', () => {
    test('2a: Rejects creation of privileged roles (Founder, Moderator, KosmoBot, Admin)', async () => {
      const privilegedRoles = ['Kosmo Founder', 'Founder', 'Team Kosmo', 'Moderator', 'Administrator', 'Admin', 'Owner', 'KosmoBot'];

      for (const pRole of privilegedRoles) {
        mockLLMCaller.mockResolvedValue(
          JSON.stringify({
            planName: `Create ${pRole}`,
            rationale: 'Privilege escalation attempt.',
            actions: [
              {
                type: 'createRole',
                payload: { name: pRole },
              },
            ],
          })
        );

        (service as any).staffCooldowns.clear();

        const result = await service.generateProposal({
          guild: mockGuild,
          scope: 'COMMUNITY',
          creator: staffCreator,
        });

        expect(result.success).toBe(false);
        expect(result.status).toBe('REJECTED');
        expect(result.message).toMatch(/cannot create privileged or premium role/i);
      }
    });

    test('2b: Rejects creation of premium entitlement roles (VIP, Pro, Max)', async () => {
      const premiumRoles = ['VIP', 'Pro', 'Max'];

      for (const pRole of premiumRoles) {
        mockLLMCaller.mockResolvedValue(
          JSON.stringify({
            planName: `Create ${pRole}`,
            rationale: 'Bypassing premium entitlement provider.',
            actions: [
              {
                type: 'createRole',
                payload: { name: pRole },
              },
            ],
          })
        );

        (service as any).staffCooldowns.clear();

        const result = await service.generateProposal({
          guild: mockGuild,
          scope: 'COMMUNITY',
          creator: staffCreator,
        });

        expect(result.success).toBe(false);
        expect(result.status).toBe('REJECTED');
        expect(result.message).toMatch(/cannot create privileged or premium role/i);
      }
    });

    test('2c: Rejects assignment or removal of privileged/premium roles', async () => {
      const targetRoles = ['Moderator', 'Kosmo Founder', 'VIP', 'Pro', 'Max'];

      for (const targetRole of targetRoles) {
        mockLLMCaller.mockResolvedValue(
          JSON.stringify({
            planName: `Assign ${targetRole}`,
            rationale: 'Granting sensitive role.',
            actions: [
              {
                type: 'assignRole',
                payload: { roleName: targetRole, memberId: 'user-attacker-1' },
              },
            ],
          })
        );

        (service as any).staffCooldowns.clear();

        const result = await service.generateProposal({
          guild: mockGuild,
          scope: 'COMMUNITY',
          creator: staffCreator,
        });

        expect(result.success).toBe(false);
        expect(result.status).toBe('REJECTED');
        expect(result.message).toMatch(/cannot modify privileged or premium role/i);
      }
    });
  });

  describe('3. Permission Escalation & Template Safety', () => {
    test('3a: Rejects permission templates granting Administrator or ManageGuild', async () => {
      mockLLMCaller.mockResolvedValue(
        JSON.stringify({
          planName: 'Escalate Channel Permissions',
          rationale: 'Granting admin overwrite.',
          actions: [
            {
              type: 'applyPermissionTemplate',
              payload: {
                targetName: 'tech-and-engineering',
                permissionOverwrites: [
                  {
                    id: '@everyone',
                    allow: ['Administrator'],
                  },
                ],
              },
            },
          ],
        })
      );

      const result = await service.generateProposal({
        guild: mockGuild,
        scope: 'COMMUNITY',
        creator: staffCreator,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('REJECTED');
      expect(result.message).toMatch(/Administrator permission/i);
    });

    test('3b: Rejects permission template if target is a role name rather than channel', async () => {
      mockLLMCaller.mockResolvedValue(
        JSON.stringify({
          planName: 'Targeting role instead of channel',
          rationale: 'Invalid target.',
          actions: [
            {
              type: 'applyPermissionTemplate',
              payload: {
                targetName: 'Tech & Engineering',
                permissionOverwrites: [{ id: '@everyone', allow: ['ViewChannel'] }],
              },
            },
          ],
        })
      );

      const result = await service.generateProposal({
        guild: mockGuild,
        scope: 'COMMUNITY',
        creator: staffCreator,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('REJECTED');
      expect(result.message).toMatch(/resolves to a role instead of a channel/i);
    });
  });

  describe('4. Prompt Injection & Malformed LLM Defense', () => {
    test('4a: Untrusted diagnostics envelope contains malicious injection safely', async () => {
      // Mock diagnostics containing prompt injection attack
      (contextService.getCommunityContext as jest.Mock).mockResolvedValueOnce({
        guildId: 'guild-test-99',
        guildName: 'Kosmo Community',
        timestamp: new Date().toISOString(),
        channelsAnalyzed: 1,
        totalMessagesAnalyzed: 1,
        channels: [
          {
            channelId: 'chan-1',
            channelName: 'tech-and-engineering',
            classification: 'PUBLIC_COMMUNITY',
            messageCount: 1,
            activeAuthors: ['user-malicious'],
            status: 'SUCCESS',
          },
        ],
        truncated: false,
      });

      mockLLMCaller.mockImplementation(async (options: any) => {
        // Assert that diagnostics were properly wrapped in untrusted envelope
        const userMsg = options.messages.find((m: any) => m.role === 'user');
        expect(userMsg.content).toContain('<community_diagnostics>');
        expect(userMsg.content).toContain('</community_diagnostics>');

        // LLM follows system safety instructions and outputs a safe proposal
        return JSON.stringify({
          planName: 'Safe Channel Discussion',
          rationale: 'Safe response ignoring injection payload.',
          actions: [
            {
              type: 'createChannel',
              payload: { name: 'safe-chat', type: 'GUILD_TEXT' },
            },
          ],
        });
      });

      const result = await service.generateProposal({
        guild: mockGuild,
        scope: 'COMMUNITY',
        creator: staffCreator,
      });

      expect(result.success).toBe(true);
      expect(result.proposal?.actions[0].type).toBe('createChannel');
    });

    test('4b: Malformed non-JSON output fails closed cleanly without proposal creation', async () => {
      mockLLMCaller.mockResolvedValue('I am a conversational AI. Here is what you should do: create a channel.');

      const result = await service.generateProposal({
        guild: mockGuild,
        scope: 'COMMUNITY',
        creator: staffCreator,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('REJECTED');
      expect(result.message).toMatch(/malformed or unparseable JSON/i);
    });

    test('4c: LLM timeout or network outage fails closed', async () => {
      mockLLMCaller.mockRejectedValue(new Error('OpenRouter API request timed out after 10 seconds.'));

      const result = await service.generateProposal({
        guild: mockGuild,
        scope: 'COMMUNITY',
        creator: staffCreator,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('REJECTED');
      expect(result.message).toMatch(/planning service unavailable/i);
    });
  });

  describe('5. Rate Limits & Concurrency Protections', () => {
    test('5a: Enforces 60-second cooldown per staff creator', async () => {
      mockLLMCaller.mockResolvedValue(
        JSON.stringify({
          planName: 'Plan 1',
          rationale: 'First proposal.',
          actions: [{ type: 'createRole', payload: { name: 'Role A' } }],
        })
      );

      // First call succeeds
      const first = await service.generateProposal({
        guild: mockGuild,
        scope: 'COMMUNITY',
        creator: staffCreator,
      });
      expect(first.success).toBe(true);

      // Immediate second call from same user is blocked by cooldown
      const second = await service.generateProposal({
        guild: mockGuild,
        scope: 'COMMUNITY',
        creator: staffCreator,
      });
      expect(second.success).toBe(false);
      expect(second.message).toMatch(/cooldown active/i);

      // Call from different staff creator succeeds
      const differentStaff = await service.generateProposal({
        guild: mockGuild,
        scope: 'COMMUNITY',
        creator: adminCreator,
      });
      expect(differentStaff.success).toBe(true);
    });

    test('5b: Enforces maximum 3 pending proposals per guild', async () => {
      mockLLMCaller.mockResolvedValue(
        JSON.stringify({
          planName: 'Plan X',
          rationale: 'Proposal.',
          actions: [{ type: 'createRole', payload: { name: 'Role X' } }],
        })
      );

      // Create 3 pending proposals using different users
      for (let i = 1; i <= 3; i++) {
        const res = await service.generateProposal({
          guild: mockGuild,
          scope: 'COMMUNITY',
          creator: {
            userId: `staff-user-${i}`,
            username: `Staff${i}`,
            authLevel: AuthLevel.MODERATOR,
          },
        });
        expect(res.success).toBe(true);
      }

      // 4th proposal is blocked by pending limit
      const fourth = await service.generateProposal({
        guild: mockGuild,
        scope: 'COMMUNITY',
        creator: {
          userId: 'staff-user-4',
          username: 'Staff4',
          authLevel: AuthLevel.MODERATOR,
        },
      });

      expect(fourth.success).toBe(false);
      expect(fourth.message).toMatch(/Maximum pending proposals limit reached/i);
    });

    test('5c: Fails closed when Redis/storage is unavailable', async () => {
      mockStorage.setSimulateUnavailable(true);

      const result = await service.generateProposal({
        guild: mockGuild,
        scope: 'COMMUNITY',
        creator: staffCreator,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('REJECTED');
      expect(result.message).toMatch(/Storage infrastructure \(Redis\) unavailable/i);
    });
  });

  describe('6. Authorization & Privacy Isolation', () => {
    test('6a: Unprivileged users (AuthLevel.NONE) cannot generate proposals', async () => {
      const result = await service.generateProposal({
        guild: mockGuild,
        scope: 'COMMUNITY',
        creator: unprivilegedCreator,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('REJECTED');
      expect(result.message).toMatch(/permission to propose/i);
    });

    test('6b: Proposal cancellation succeeds for matching guild and is single-use', async () => {
      mockLLMCaller.mockResolvedValue(
        JSON.stringify({
          planName: 'To Be Cancelled',
          rationale: 'Testing cancellation.',
          actions: [{ type: 'createRole', payload: { name: 'Temp Role' } }],
        })
      );

      const gen = await service.generateProposal({
        guild: mockGuild,
        scope: 'COMMUNITY',
        creator: staffCreator,
      });

      const planId = gen.proposal!.planId;

      // Cancel
      const cancel = await service.cancelProposal(planId, staffCreator.userId, mockGuild.id);
      expect(cancel.success).toBe(true);

      const proposalAfter = await service.getProposal(planId);
      expect(proposalAfter?.status).toBe('CANCELLED');

      // Attempt second cancellation
      const secondCancel = await service.cancelProposal(planId, staffCreator.userId, mockGuild.id);
      expect(secondCancel.success).toBe(false);
      expect(secondCancel.message).toMatch(/already cancelled/i);
    });
  });
});
