import { NLManager, LLMCompletionFn } from '../../services/discord/nl_manager';
import { NLContext, DiscordAction } from '../../services/discord/types';
import { PermissionValidator } from '../../services/discord/permissionValidator';

describe('Phase 3 Natural Language Management (NLManager)', () => {
  const authorizedContext: NLContext = {
    userId: 'user-founder-1',
    username: 'KosmoFounder',
    roles: ['Founder', 'Admin'],
    guildId: 'guild-123',
    channelId: 'channel-456',
  };

  const unauthorizedContext: NLContext = {
    userId: 'user-regular-2',
    username: 'RandomMember',
    roles: ['Member'],
    guildId: 'guild-123',
    channelId: 'channel-456',
  };

  // -------------------------------------------------------------------------
  // TEST 1 — Valid NL request
  // -------------------------------------------------------------------------
  test('TEST 1: Valid NL request converts into expected Plan and DiscordAction[]', async () => {
    const mockOutput = JSON.stringify({
      planName: 'Configure Moderator Permissions for Announcements',
      explanation: 'Apply permission template to announcements channel.',
      actions: [
        {
          type: 'applyPermissionTemplate',
          payload: {
            targetName: 'announcements',
            permissionOverwrites: [
              {
                id: 'role-mod-id',
                allow: ['ManageMessages', 'SendMessages'],
                deny: [],
              },
            ],
          },
        },
        {
          type: 'createRole',
          payload: {
            name: 'CommunityBuilder',
            color: 0x3498db,
            hoist: true,
          },
        },
      ],
    });

    const mockLLM: LLMCompletionFn = jest.fn().mockResolvedValue(mockOutput);
    const manager = new NLManager(mockLLM);

    const result = await manager.generatePlan(
      'Make sure announcements has proper mod permissions and create CommunityBuilder role',
      authorizedContext
    );

    expect(result.success).toBe(true);
    expect(result.plan).toBeDefined();
    expect(result.plan?.name).toBe('Configure Moderator Permissions for Announcements');
    expect(result.plan?.actions).toHaveLength(2);
    expect(result.plan?.actions[0].type).toBe('applyPermissionTemplate');
    expect(result.plan?.actions[1].type).toBe('createRole');
    expect(result.plan?.status).toBe('PROPOSED');
    expect(result.plan?.riskLevel).toBe('MEDIUM');
    expect(result.validation.valid).toBe(true);
    expect(result.validation.blocked).toBe(false);
  });

  // -------------------------------------------------------------------------
  // TEST 2 — Dangerous action (blocked)
  // -------------------------------------------------------------------------
  test('TEST 2: Dangerous action (admin escalation / privileged role creation) is blocked', async () => {
    // 2a: Forbidden Administrator permission overwrite
    const adminEscalationOutput = JSON.stringify({
      planName: 'Grant Administrator Permission',
      explanation: 'Give Administrator permission in general channel.',
      actions: [
        {
          type: 'applyPermissionTemplate',
          payload: {
            targetName: 'general',
            permissionOverwrites: [
              {
                id: 'role-vip-id',
                allow: ['Administrator'],
                deny: [],
              },
            ],
          },
        },
      ],
    });

    const mockLLM1: LLMCompletionFn = jest.fn().mockResolvedValue(adminEscalationOutput);
    const manager1 = new NLManager(mockLLM1);

    const result1 = await manager1.generatePlan('Give VIP Administrator access in general', authorizedContext);

    expect(result1.success).toBe(false);
    expect(result1.plan?.riskLevel).toBe('BLOCKED');
    expect(result1.validation.blocked).toBe(true);
    expect(result1.validation.blockedReasons).toBeDefined();
    expect(result1.validation.blockedReasons?.some((r) => r.includes('Administrator'))).toBe(true);

    // 2b: Privileged role creation
    const privilegedRoleOutput = JSON.stringify({
      planName: 'Create Moderator Role',
      explanation: 'Create a new Moderator role.',
      actions: [
        {
          type: 'createRole',
          payload: {
            name: 'Moderator',
            hoist: true,
          },
        },
      ],
    });

    const mockLLM2: LLMCompletionFn = jest.fn().mockResolvedValue(privilegedRoleOutput);
    const manager2 = new NLManager(mockLLM2);

    const result2 = await manager2.generatePlan('Create a new Moderator role', authorizedContext);

    expect(result2.success).toBe(false);
    expect(result2.plan?.riskLevel).toBe('BLOCKED');
    expect(result2.validation.blocked).toBe(true);
    expect(result2.validation.blockedReasons?.some((r) => r.includes('privileged role'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // TEST 3 — Invalid JSON
  // -------------------------------------------------------------------------
  test('TEST 3: Malformed or non-JSON output is safely handled without crash', async () => {
    const invalidOutputs = [
      'I am an AI assistant and I cannot output JSON right now.',
      '{"planName": "Broken Plan", actions: [}',
      'Random conversational text with no JSON structure',
      '',
    ];

    for (const raw of invalidOutputs) {
      const mockLLM: LLMCompletionFn = jest.fn().mockResolvedValue(raw);
      const manager = new NLManager(mockLLM);

      const result = await manager.generatePlan('Do something complex', authorizedContext);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.validation.valid).toBe(false);
    }
  });

  // -------------------------------------------------------------------------
  // TEST 4 — Permission / policy integration
  // -------------------------------------------------------------------------
  test('TEST 4: Unauthorized management requests are rejected before LLM call', async () => {
    const mockLLM: LLMCompletionFn = jest.fn();
    const manager = new NLManager(mockLLM);

    const result = await manager.generatePlan(
      'Create a new private channel for me',
      unauthorizedContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Permission denied');
    expect(result.validation.blocked).toBe(true);
    expect(mockLLM).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // TEST 5 — Safety constraints & PermissionValidator adherence
  // -------------------------------------------------------------------------
  test('TEST 5: Protected role tampering and permissionValidator checks are strictly enforced', async () => {
    // 5a: Attempting to assign a privileged role (e.g. Founder)
    const assignPrivilegedOutput = JSON.stringify({
      planName: 'Assign Founder Role',
      explanation: 'Assign Founder role to user.',
      actions: [
        {
          type: 'assignRole',
          payload: {
            roleName: 'Founder',
            memberId: 'user-789',
          },
        },
      ],
    });

    const mockLLM: LLMCompletionFn = jest.fn().mockResolvedValue(assignPrivilegedOutput);
    const manager = new NLManager(mockLLM);

    const result = await manager.generatePlan('Make user-789 a Founder', authorizedContext);

    expect(result.success).toBe(false);
    expect(result.plan?.riskLevel).toBe('BLOCKED');
    expect(result.validation.blocked).toBe(true);
    expect(result.validation.blockedReasons?.some((r) => r.includes('privileged role'))).toBe(true);

    // 5b: Direct unit check on PermissionValidator for overwrite containing ManageGuild
    const forbiddenOverwriteAction: DiscordAction = {
      type: 'applyPermissionTemplate',
      payload: {
        targetName: 'staff-room',
        permissionOverwrites: [
          {
            id: 'role-123',
            allow: ['ManageGuild', 'ViewChannel'],
            deny: [],
          },
        ],
      },
    };

    const valResult = PermissionValidator.validateAction(forbiddenOverwriteAction);
    expect(valResult.valid).toBe(false);
    expect(valResult.blocked).toBe(true);
    expect(valResult.blockedReasons?.[0]).toContain('ManageGuild');
  });
});
