import { NLManager, LLMCompletionFn, NL_SYSTEM_PROMPT } from '../../services/discord/nl_manager';
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

  test('TEST 4b: Founder with configured role ID can invoke /kosmo manage', async () => {
    const mockLLM: LLMCompletionFn = jest.fn().mockResolvedValue(JSON.stringify({
      planName: 'Founder Plan',
      explanation: 'Founder explanation',
      actions: [{ type: 'createRole', payload: { name: 'NewRole' } }],
    }));
    const manager = new NLManager(mockLLM);

    const founderContext: NLContext = {
      userId: 'founder-user',
      username: 'FounderUser',
      roles: ['111111111111111111'],
      guildId: 'guild-123',
    };

    const result = await manager.generatePlan('create role NewRole', founderContext);
    expect(result.success).toBe(true);
    expect(mockLLM).toHaveBeenCalledTimes(1);
  });

  test('TEST 4c: Team Kosmo with configured role ID can invoke /kosmo manage', async () => {
    const mockLLM: LLMCompletionFn = jest.fn().mockResolvedValue(JSON.stringify({
      planName: 'Team Plan',
      explanation: 'Team explanation',
      actions: [{ type: 'createRole', payload: { name: 'TeamRole' } }],
    }));
    const manager = new NLManager(mockLLM);

    const teamContext: NLContext = {
      userId: 'team-user',
      username: 'TeamUser',
      roles: ['222222222222222222'],
      guildId: 'guild-123',
    };

    const result = await manager.generatePlan('create role TeamRole', teamContext);
    expect(result.success).toBe(true);
    expect(mockLLM).toHaveBeenCalledTimes(1);
  });

  test('TEST 4d: Server Owner can invoke /kosmo manage even without configured roles', async () => {
    const mockLLM: LLMCompletionFn = jest.fn().mockResolvedValue(JSON.stringify({
      planName: 'Owner Plan',
      explanation: 'Owner explanation',
      actions: [{ type: 'createRole', payload: { name: 'OwnerRole' } }],
    }));
    const manager = new NLManager(mockLLM);

    const ownerContext: NLContext = {
      userId: 'guild-owner-id',
      username: 'GuildOwner',
      roles: [],
      guildId: 'guild-123',
      guildOwnerId: 'guild-owner-id',
    };

    const result = await manager.generatePlan('create role OwnerRole', ownerContext);
    expect(result.success).toBe(true);
    expect(mockLLM).toHaveBeenCalledTimes(1);
  });

  test('TEST 4e: Admin can invoke /kosmo manage according to policy', async () => {
    const mockLLM: LLMCompletionFn = jest.fn().mockResolvedValue(JSON.stringify({
      planName: 'Admin Plan',
      explanation: 'Admin explanation',
      actions: [{ type: 'createRole', payload: { name: 'AdminRole' } }],
    }));
    const manager = new NLManager(mockLLM);

    const adminContext: NLContext = {
      userId: 'admin-user',
      username: 'AdminUser',
      roles: ['333333333333333333'],
      guildId: 'guild-123',
    };

    const result = await manager.generatePlan('create role AdminRole', adminContext);
    expect(result.success).toBe(true);
    expect(mockLLM).toHaveBeenCalledTimes(1);
  });

  test('TEST 4f: Moderator is rejected from /kosmo manage', async () => {
    const mockLLM: LLMCompletionFn = jest.fn();
    const manager = new NLManager(mockLLM);

    const modContext: NLContext = {
      userId: 'mod-user',
      username: 'ModUser',
      roles: ['444444444444444444'],
      guildId: 'guild-123',
    };

    const result = await manager.generatePlan('create role ModRole', modContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Permission denied');
    expect(mockLLM).not.toHaveBeenCalled();
  });

  test('TEST 4g: Unrecognized user is rejected from /kosmo manage', async () => {
    const mockLLM: LLMCompletionFn = jest.fn();
    const manager = new NLManager(mockLLM);

    const unknownContext: NLContext = {
      userId: 'unknown-user',
      username: 'UnknownUser',
      roles: ['999999999999999999'],
      guildId: 'guild-123',
    };

    const result = await manager.generatePlan('create role SomeRole', unknownContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Permission denied');
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

  // -------------------------------------------------------------------------
  // TEST 6 — OpenRouter Provider Integration (defaultLLMCaller)
  // -------------------------------------------------------------------------
  describe('TEST 6: OpenRouter Provider Integration (defaultLLMCaller)', () => {
    const originalFetch = global.fetch;
    const originalEnv = { ...process.env };

    afterEach(() => {
      global.fetch = originalFetch;
      process.env = { ...originalEnv };
      jest.restoreAllMocks();
    });

    test('6a: Fails safely when OPENROUTER_API_KEY is missing without exposing keys', async () => {
      delete process.env.OPENROUTER_API_KEY;
      const manager = new NLManager();

      await expect(
        manager.defaultLLMCaller({
          messages: [{ role: 'user', content: 'test prompt' }],
        })
      ).rejects.toThrow('OPENROUTER_API_KEY environment variable is not set.');
    });

    test('6b: Sends request to OpenRouter endpoint with correct headers, model, and body', async () => {
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
      process.env.OPENROUTER_MODEL = 'meta-llama/llama-3.3-70b-instruct';

      const mockResponseData = {
        choices: [
          {
            message: {
              content: '{"planName": "OpenRouter Test Plan", "explanation": "Generated via OpenRouter", "actions": []}',
            },
          },
        ],
      };

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockResponseData),
      });
      global.fetch = mockFetch as any;

      const manager = new NLManager();
      const rawOutput = await manager.defaultLLMCaller({
        messages: [
          { role: 'system', content: 'System instruction' },
          { role: 'user', content: 'User prompt' },
        ],
        temperature: 0.2,
        max_tokens: 1024,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, requestInit] = mockFetch.mock.calls[0];

      // 1. Endpoint
      expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');

      // 2. Headers
      expect(requestInit.method).toBe('POST');
      expect(requestInit.headers['Authorization']).toBe('Bearer test-openrouter-key');
      expect(requestInit.headers['Content-Type']).toBe('application/json');
      expect(requestInit.headers['HTTP-Referer']).toBe('https://github.com/Yash-Gaikwad14/KOSMO-BOT');
      expect(requestInit.headers['X-Title']).toBe('Kosmo Discord Bot');

      // 3. Body structure
      const parsedBody = JSON.parse(requestInit.body);
      expect(parsedBody.model).toBe('meta-llama/llama-3.3-70b-instruct');
      expect(parsedBody.messages).toEqual([
        { role: 'system', content: 'System instruction' },
        { role: 'user', content: 'User prompt' },
      ]);
      expect(parsedBody.temperature).toBe(0.2);
      expect(parsedBody.max_tokens).toBe(1024);

      // 4. Response parsing
      expect(rawOutput).toBe('{"planName": "OpenRouter Test Plan", "explanation": "Generated via OpenRouter", "actions": []}');
    });

    test('6c: Handles API error without leaking the API key in the error message', async () => {
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
      process.env.OPENROUTER_MODEL = 'meta-llama/llama-3.3-70b-instruct';

      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: jest.fn().mockResolvedValue('{"error":{"message":"Invalid API key provided"}}'),
      });
      global.fetch = mockFetch as any;

      const manager = new NLManager();
      let errorThrown: any;
      try {
        await manager.defaultLLMCaller({
          messages: [{ role: 'user', content: 'hello' }],
        });
      } catch (err: any) {
        errorThrown = err;
      }

      expect(errorThrown).toBeDefined();
      expect(errorThrown.message).toContain('OpenRouter API request failed [401 Unauthorized]');
      expect(errorThrown.message).not.toContain('test-openrouter-key');
    });

    test('6d: End-to-end generatePlan via defaultLLMCaller with OpenRouter produces valid Plan', async () => {
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
      process.env.OPENROUTER_MODEL = 'meta-llama/llama-3.3-70b-instruct';

      const mockResponseData = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                planName: 'OpenRouter Role Plan',
                explanation: 'Created role via OpenRouter',
                actions: [{ type: 'createRole', payload: { name: 'CommunityGuest' } }],
              }),
            },
          },
        ],
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockResponseData),
      }) as any;

      // Default constructor uses defaultLLMCaller
      const manager = new NLManager();
      const result = await manager.generatePlan('create role CommunityGuest', authorizedContext);

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();
      expect(result.plan?.name).toBe('OpenRouter Role Plan');
      expect(result.plan?.actions[0].type).toBe('createRole');
    });
  });

  // -------------------------------------------------------------------------
  // TEST 7 — Robust AI JSON Extraction & Prose Handling (Phase 3D.1)
  // -------------------------------------------------------------------------
  describe('TEST 7: Robust AI JSON Extraction & Prose Handling', () => {
    test('7a: Pure JSON string parses directly', () => {
      const manager = new NLManager();
      const pureJson = JSON.stringify({
        actions: [{ type: 'createRole', payload: { name: 'PureRole' } }],
      });
      const parsed = manager.extractAndParseJSON(pureJson);
      expect(parsed.actions).toHaveLength(1);
      expect(parsed.actions[0].payload.name).toBe('PureRole');
    });

    test('7b: Fenced JSON with conversational prose before and after parses correctly', () => {
      const manager = new NLManager();
      const input = `Sure thing! Here's a test plan for your server:
\`\`\`json
{
  "planName": "Fenced Plan",
  "actions": [
    {
      "type": "createRole",
      "payload": { "name": "VIP" }
    }
  ]
}
\`\`\`
Let me know if you want any adjustments!`;

      const parsed = manager.extractAndParseJSON(input);
      expect(parsed.planName).toBe('Fenced Plan');
      expect(parsed.actions).toHaveLength(1);
      expect(parsed.actions[0].payload.name).toBe('VIP');
    });

    test('7c: Unfenced JSON surrounded by conversational prose parses correctly (Exact Phase 3D Failure Case)', () => {
      const manager = new NLManager();
      const input = `Here's a test plan:

{
  "actions": [
    {
      "type": "createChannel",
      "payload": {
        "channelName": "test-channel"
      }
    }
  ]
}

Hope this helps!`;

      const parsed = manager.extractAndParseJSON(input);
      expect(parsed.actions).toHaveLength(1);
      expect(parsed.actions[0].payload.channelName).toBe('test-channel');
    });

    test('7d: Bare array of actions is wrapped into { actions: [...] }', () => {
      const manager = new NLManager();
      const input = `Here are the actions:
[
  {
    "type": "createRole",
    "payload": { "name": "BareArrayRole" }
  }
]`;

      const parsed = manager.extractAndParseJSON(input);
      expect(parsed.actions).toBeDefined();
      expect(Array.isArray(parsed.actions)).toBe(true);
      expect(parsed.actions[0].payload.name).toBe('BareArrayRole');
    });

    test('7e: JSON with trailing commas is safely parsed', () => {
      const manager = new NLManager();
      const input = `
{
  "planName": "Trailing Comma Plan",
  "actions": [
    {
      "type": "createRole",
      "payload": { "name": "CommaRole", },
    },
  ],
}`;

      const parsed = manager.extractAndParseJSON(input);
      expect(parsed.planName).toBe('Trailing Comma Plan');
      expect(parsed.actions).toHaveLength(1);
      expect(parsed.actions[0].payload.name).toBe('CommaRole');
    });

    test('7f: End-to-end generatePlan normalizes channelName to name and default GUILD_TEXT type', async () => {
      const conversationalOutput = `Here's a test plan:

{
  "actions": [
    {
      "type": "createChannel",
      "payload": {
        "channelName": "test-channel"
      }
    }
  ]
}

Let me know if this looks good!`;

      const mockLLM: LLMCompletionFn = jest.fn().mockResolvedValue(conversationalOutput);
      const manager = new NLManager(mockLLM);

      const result = await manager.generatePlan('create a test channel', authorizedContext);

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();
      const action = result.plan?.actions[0];
      expect(action?.type).toBe('createChannel');
      if (action?.type === 'createChannel') {
        expect(action.payload.name).toBe('test-channel');
        expect(action.payload.type).toBe('GUILD_TEXT');
      }
    });

    test('7g: Completely non-JSON response fails safely with descriptive error', () => {
      const manager = new NLManager();
      const nonJson = 'I am sorry, I cannot fulfill this request because I am just an AI.';

      expect(() => manager.extractAndParseJSON(nonJson)).toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // TEST 8 — Nemotron JSON Output Reliability & Anti-Pattern Rejection (Phase 3D)
  // -------------------------------------------------------------------------
  describe('TEST 8: Nemotron JSON Output Reliability & Contract Enforcement', () => {
    test('8a: System prompt contains explicit JSON-only and anti-placeholder directives', () => {
      expect(NL_SYSTEM_PROMPT).toContain('ONLY one valid JSON object');
      expect(NL_SYSTEM_PROMPT).toContain('No Markdown code fences');
      expect(NL_SYSTEM_PROMPT).toContain('No explanation');
      expect(NL_SYSTEM_PROMPT).toContain('No introductory text');
      expect(NL_SYSTEM_PROMPT).toContain('No concluding text');
      expect(NL_SYSTEM_PROMPT).toContain('Do not output TypeScript');
      expect(NL_SYSTEM_PROMPT).toContain('Do not output JSON Schema');
      expect(NL_SYSTEM_PROMPT).toContain('Do not output type declarations');
      expect(NL_SYSTEM_PROMPT).toContain('Every property value must be an actual JSON value');
      expect(NL_SYSTEM_PROMPT).toContain('parseable directly by JSON.parse()');
      expect(NL_SYSTEM_PROMPT).toContain('Do not invent unsupported action types');
      expect(NL_SYSTEM_PROMPT).toContain('Follow the existing action schema');
      expect(NL_SYSTEM_PROMPT).toContain('Notice that `string` above is a TypeScript/schema placeholder and MUST NEVER be emitted');
      expect(NL_SYSTEM_PROMPT).toContain('Do not use `...` because ellipsis is not valid JSON');
    });

    test('8b: TEST A — Valid JSON parses cleanly and creates valid proposed plan', async () => {
      const validJson = JSON.stringify({
        actions: [
          {
            type: 'createChannel',
            payload: {
              name: 'test-channel',
              type: 'GUILD_TEXT',
            },
          },
        ],
      });

      const mockLLM: LLMCompletionFn = jest.fn().mockResolvedValue(validJson);
      const manager = new NLManager(mockLLM);

      const result = await manager.generatePlan('create a channel named test-channel', authorizedContext);

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();
      expect(result.plan?.actions).toHaveLength(1);
      expect(result.plan?.actions[0].type).toBe('createChannel');
      if (result.plan?.actions[0].type === 'createChannel') {
        expect(result.plan.actions[0].payload.name).toBe('test-channel');
        expect(result.plan.actions[0].payload.type).toBe('GUILD_TEXT');
      }
    });

    test('8c: TEST B — Prose + JSON handled successfully by existing extractor', async () => {
      const manager = new NLManager();
      const conversationalEmpty = `Here is the plan:

{
  "actions": []
}`;

      // 1. Existing extractor handles prose + JSON successfully
      const parsed = manager.extractAndParseJSON(conversationalEmpty);
      expect(parsed.actions).toBeDefined();
      expect(parsed.actions).toHaveLength(0);

      // 2. End-to-end generatePlan with prose + valid actions
      const conversationalWithActions = `Here is the plan:

{
  "actions": [
    {
      "type": "createChannel",
      "payload": {
        "name": "prose-channel",
        "type": "GUILD_TEXT"
      }
    }
  ]
}

Hope this helps!`;

      const mockLLM: LLMCompletionFn = jest.fn().mockResolvedValue(conversationalWithActions);
      const managerWithLLM = new NLManager(mockLLM);

      const result = await managerWithLLM.generatePlan('create prose-channel', authorizedContext);
      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();
      expect(result.plan?.actions).toHaveLength(1);
      expect(result.plan?.actions[0].type).toBe('createChannel');
    });

    test('8d: TEST C — TypeScript-style invalid output ({ name: string }) is rejected safely', async () => {
      const typeScriptInvalid = `{
  "actions": [
    {
      "type": "createChannel",
      "payload": {
        "name": string
      }
    }
  ]
}`;

      const mockLLM: LLMCompletionFn = jest.fn().mockResolvedValue(typeScriptInvalid);
      const manager = new NLManager(mockLLM);

      const result = await manager.generatePlan('create a channel', authorizedContext);

      // Must fail safely without converting string placeholder into a valid channel name
      expect(result.success).toBe(false);
      expect(result.plan).toBeUndefined();
      expect(result.error).toMatch(/Failed to parse AI JSON response/i);
    });

    test('8e: TEST D — JSON Schema style output is rejected as invalid action structure', async () => {
      const jsonSchemaOutput = JSON.stringify({
        name: {
          type: 'string',
        },
      });

      const mockLLM: LLMCompletionFn = jest.fn().mockResolvedValue(jsonSchemaOutput);
      const manager = new NLManager(mockLLM);

      const result = await manager.generatePlan('define name field', authorizedContext);

      // Even though syntax is valid JSON, missing actions array must cause safe rejection
      expect(result.success).toBe(false);
      expect(result.plan).toBeUndefined();
      expect(result.error).toMatch(/actions array missing/i);
    });

    test('8f: TEST E — Normal Discord instruction end-to-end plan generation', async () => {
      const mockNemotronResponse = `{
  "planName": "Create test-channel Channel",
  "explanation": "Create a new text channel named test-channel for guild members.",
  "actions": [
    {
      "type": "createChannel",
      "payload": {
        "name": "test-channel",
        "type": "GUILD_TEXT"
      }
    }
  ]
}`;

      const mockLLM: LLMCompletionFn = jest.fn().mockResolvedValue(mockNemotronResponse);
      const manager = new NLManager(mockLLM);

      const result = await manager.generatePlan('Create a channel called test-channel.', authorizedContext);

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();
      expect(result.plan?.name).toBe('Create test-channel Channel');
      expect(result.plan?.status).toBe('PROPOSED');
      expect(result.plan?.actions).toHaveLength(1);
      const action = result.plan?.actions[0];
      expect(action?.type).toBe('createChannel');
      if (action?.type === 'createChannel') {
        expect(action.payload.name).toBe('test-channel');
        expect(action.payload.type).toBe('GUILD_TEXT');
      }
    });
  });

  // -------------------------------------------------------------------------
  // TEST 9 — Category Parenting in NL Plan Generation (Phase 3D)
  // -------------------------------------------------------------------------
  describe('TEST 9: Category Parenting in NL Plan Generation', () => {
    test('9a: TEST E — AI plan category extraction preserves category requirement', async () => {
      const mockResponse = `{
  "planName": "Create test2 channel in KOSMO Testing category",
  "explanation": "Create text channel test2 inside KOSMO Testing category.",
  "actions": [
    {
      "type": "createChannel",
      "payload": {
        "name": "test2",
        "type": "GUILD_TEXT",
        "category": "KOSMO Testing"
      }
    }
  ]
}`;

      const mockLLM: LLMCompletionFn = jest.fn().mockResolvedValue(mockResponse);
      const manager = new NLManager(mockLLM);

      const result = await manager.generatePlan('create test2 inside KOSMO Testing', authorizedContext);

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();
      expect(result.plan?.actions).toHaveLength(1);
      const action = result.plan?.actions[0];
      expect(action?.type).toBe('createChannel');
      if (action?.type === 'createChannel') {
        expect(action.payload.name).toBe('test2');
        expect(action.payload.type).toBe('GUILD_TEXT');
        expect(action.payload.category).toBe('KOSMO Testing');
      }
    });

    test('9b: TEST F — Normalizes parent and categoryName into category', async () => {
      // Test "parent" variation
      const parentResponse = JSON.stringify({
        actions: [
          {
            type: 'createChannel',
            payload: {
              name: 'chan-a',
              type: 'GUILD_TEXT',
              parent: 'KOSMO Testing',
            },
          },
        ],
      });

      const manager1 = new NLManager(jest.fn().mockResolvedValue(parentResponse));
      const res1 = await manager1.generatePlan('create chan-a inside KOSMO Testing', authorizedContext);
      expect(res1.success).toBe(true);
      const act1 = res1.plan?.actions[0];
      if (act1?.type === 'createChannel') {
        expect(act1.payload.category).toBe('KOSMO Testing');
      }

      // Test "categoryName" variation
      const categoryNameResponse = JSON.stringify({
        actions: [
          {
            type: 'createChannel',
            payload: {
              name: 'chan-b',
              type: 'GUILD_TEXT',
              categoryName: 'KOSMO Testing',
            },
          },
        ],
      });

      const manager2 = new NLManager(jest.fn().mockResolvedValue(categoryNameResponse));
      const res2 = await manager2.generatePlan('create chan-b inside KOSMO Testing', authorizedContext);
      expect(res2.success).toBe(true);
      const act2 = res2.plan?.actions[0];
      if (act2?.type === 'createChannel') {
        expect(act2.payload.category).toBe('KOSMO Testing');
      }
    });

    test('9c: TEST G — Category support preserves all safety rules and PermissionValidator constraints', async () => {
      // Attempting to create privileged role alongside channel inside category must still be blocked
      const unsafePlan = JSON.stringify({
        actions: [
          {
            type: 'createChannel',
            payload: {
              name: 'safe-channel',
              type: 'GUILD_TEXT',
              category: 'KOSMO Testing',
            },
          },
          {
            type: 'createRole',
            payload: {
              name: 'Founder',
            },
          },
        ],
      });

      const manager = new NLManager(jest.fn().mockResolvedValue(unsafePlan));
      const result = await manager.generatePlan('create channel and founder role', authorizedContext);

      // Must be blocked by PermissionValidator
      expect(result.success).toBe(false);
      expect(result.validation.blocked).toBe(true);
      expect(result.plan?.status).toBe('REJECTED');
      expect(result.plan?.riskLevel).toBe('BLOCKED');
    });
  });
});
