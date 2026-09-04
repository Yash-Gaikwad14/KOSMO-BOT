// src/tests/discord/audit_command.test.ts

import { data, execute } from '../../commands/kosmo/manage';
import { nlManager } from '../../services/discord/nl_manager';
import { ChatInputCommandInteraction, Collection, Guild, Role, GuildChannel, ApplicationCommand } from 'discord.js';

// Helper to create mock guild
function createMockGuild(): Guild {
  return {
    id: 'guild123',
    name: 'TestGuild',
    ownerId: 'owner123',
    roles: {
      cache: new Collection<string, Role>([
        [
          '111111111111111111',
          {
            id: '111111111111111111',
            name: 'Founder',
            position: 10,
            permissions: { bitfield: 8n },
          } as any,
        ],
        [
          'role2',
          {
            id: 'role2',
            name: 'Member',
            position: 1,
            permissions: { bitfield: 0n },
          } as any,
        ],
      ]),
    },
    channels: {
      cache: new Collection<string, GuildChannel>([
        [
          'chan1',
          {
            id: 'chan1',
            name: 'announcements',
            type: '0',
            parentId: null,
            permissionOverwrites: { cache: new Collection() },
          } as any,
        ],
        [
          'chan2',
          {
            id: 'chan2',
            name: 'General Voice',
            type: '2',
            parentId: null,
            permissionOverwrites: { cache: new Collection() },
          } as any,
        ],
      ]),
    },
    commands: {
      fetch: jest.fn().mockResolvedValue(
        new Collection<string, ApplicationCommand>([
          [
            'cmd1',
            {
              id: 'cmd1',
              name: 'kosmo',
              description: 'Kosmo Bot Administration Commands',
              defaultPermission: true,
            } as any,
          ],
        ])
      ),
    },
  } as unknown as Guild;
}

describe('/kosmo audit command', () => {
  test('registers both manage and audit subcommands under /kosmo', () => {
    const json = data.toJSON();
    expect(json.name).toBe('kosmo');

    const subcommands = (json.options || []).map((opt: any) => opt.name);
    expect(subcommands).toContain('manage');
    expect(subcommands).toContain('audit');

    const auditSubcommand = (json.options || []).find((opt: any) => opt.name === 'audit');
    expect(auditSubcommand?.description).toMatch(/read-only audit/i);
  });

  test('Test 1: Guild owner with no recognized role -> ALLOW audit and returns read-only embed', async () => {
    const mockGuild = createMockGuild();
    let repliedPayload: any = null;

    const mockInteraction = {
      options: {
        getSubcommand: jest.fn().mockReturnValue('audit'),
      },
      guild: mockGuild,
      user: {
        id: 'owner123', // Matches guild.ownerId
        username: 'GuildOwner',
      },
      member: {
        roles: [], // No roles in roles.json
      },
      reply: jest.fn().mockImplementation(async (payload) => {
        repliedPayload = payload;
      }),
      followUp: jest.fn(),
    } as unknown as ChatInputCommandInteraction;

    await execute(mockInteraction);

    expect(mockInteraction.reply).toHaveBeenCalledTimes(1);
    expect(repliedPayload?.embeds).toBeDefined();
    expect(repliedPayload.embeds).toHaveLength(1);

    const embed = repliedPayload.embeds[0].data;
    expect(embed.title).toContain('READ-ONLY');
    expect(embed.description).toContain('TestGuild');
    expect(embed.footer?.text).toMatch(/READ-ONLY/i);

    const serverInfo = embed.fields.find((f: any) => f.name === 'Server Information');
    expect(serverInfo.value).toContain('TestGuild');
    expect(serverInfo.value).toContain('guild123');

    const resourceCounts = embed.fields.find((f: any) => f.name === 'Resource Counts');
    expect(resourceCounts.value).toContain('**Roles:** 2');
    expect(resourceCounts.value).toContain('**Channels:** 2');
    expect(resourceCounts.value).toContain('**Commands:** 1');

    const desiredStateField = embed.fields.find((f: any) => f.name === 'Desired-State Config');
    expect(desiredStateField.value).toContain('✅ Detected (`desiredState.json`)');
  });

  test('Test 2: Guild owner with Founder role -> ALLOW audit and returns read-only embed', async () => {
    const mockGuild = createMockGuild();
    let repliedPayload: any = null;

    const mockInteraction = {
      options: {
        getSubcommand: jest.fn().mockReturnValue('audit'),
      },
      guild: mockGuild,
      user: {
        id: 'owner123', // Matches guild.ownerId
        username: 'GuildOwner',
      },
      member: {
        roles: ['111111111111111111'], // Founder role from roles.json
      },
      reply: jest.fn().mockImplementation(async (payload) => {
        repliedPayload = payload;
      }),
      followUp: jest.fn(),
    } as unknown as ChatInputCommandInteraction;

    await execute(mockInteraction);

    expect(mockInteraction.reply).toHaveBeenCalledTimes(1);
    expect(repliedPayload?.embeds).toBeDefined();
    expect(repliedPayload.embeds).toHaveLength(1);

    const embed = repliedPayload.embeds[0].data;
    expect(embed.title).toContain('READ-ONLY');
  });

  test('Test 3: Non-owner with authorized audit role -> ALLOW audit', async () => {
    const mockGuild = createMockGuild();
    let repliedPayload: any = null;

    const mockInteraction = {
      options: {
        getSubcommand: jest.fn().mockReturnValue('audit'),
      },
      guild: mockGuild,
      user: {
        id: 'nonowner456', // Different from guild.ownerId
        username: 'AuthorizedUser',
      },
      member: {
        roles: ['111111111111111111'], // Founder role from roles.json
      },
      reply: jest.fn().mockImplementation(async (payload) => {
        repliedPayload = payload;
      }),
      followUp: jest.fn(),
    } as unknown as ChatInputCommandInteraction;

    await execute(mockInteraction);

    expect(mockInteraction.reply).toHaveBeenCalledTimes(1);
    expect(repliedPayload?.embeds).toBeDefined();
    expect(repliedPayload.embeds).toHaveLength(1);

    const embed = repliedPayload.embeds[0].data;
    expect(embed.title).toContain('READ-ONLY');
  });

  test('Test 4: Non-owner with no authorized role -> DENY with ephemeral error', async () => {
    const mockGuild = createMockGuild();
    let repliedPayload: any = null;

    const mockInteraction = {
      options: {
        getSubcommand: jest.fn().mockReturnValue('audit'),
      },
      guild: mockGuild,
      user: {
        id: 'nonowner456', // Different from guild.ownerId
        username: 'UnauthorizedUser',
      },
      member: {
        roles: ['999999999999999999'], // Non-privileged role
      },
      reply: jest.fn().mockImplementation(async (payload) => {
        repliedPayload = payload;
      }),
      followUp: jest.fn(),
    } as unknown as ChatInputCommandInteraction;

    await execute(mockInteraction);

    expect(mockInteraction.reply).toHaveBeenCalledTimes(1);
    expect(repliedPayload.ephemeral).toBe(true);
    expect(repliedPayload.content).toMatch(/Unauthorized/i);
  });

  test('Test 5: returns ephemeral error when invoked outside a guild', async () => {
    let repliedPayload: any = null;

    const mockInteraction = {
      options: {
        getSubcommand: jest.fn().mockReturnValue('audit'),
      },
      guild: null,
      user: {
        id: 'user123',
        username: 'User',
      },
      member: null,
      reply: jest.fn().mockImplementation(async (payload) => {
        repliedPayload = payload;
      }),
      followUp: jest.fn(),
    } as unknown as ChatInputCommandInteraction;

    await execute(mockInteraction);

    expect(mockInteraction.reply).toHaveBeenCalledTimes(1);
    expect(repliedPayload.ephemeral).toBe(true);
    expect(repliedPayload.content).toMatch(/only be used within a server/i);
  });

  test('Test 6: Existing /kosmo manage behavior remains unchanged', async () => {
    const generatePlanSpy = jest.spyOn(nlManager, 'generatePlan').mockResolvedValue({
      success: true,
      explanation: 'Test plan created',
      validation: { valid: true, errors: [] },
      plan: {
        id: 'plan-test-123',
        name: 'Test Plan',
        description: 'Test Description',
        actions: [],
        riskLevel: 'LOW',
        status: 'PROPOSED',
        createdAt: new Date(),
      },
    });

    const mockInteraction = {
      options: {
        getSubcommand: jest.fn().mockReturnValue('manage'),
        getString: jest.fn().mockReturnValue('create channel test'),
      },
      guildId: 'guild123',
      channelId: 'chan1',
      user: {
        id: 'user123',
        username: 'User',
      },
      member: {
        roles: ['admin'],
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;

    await execute(mockInteraction);

    expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: false });
    expect(generatePlanSpy).toHaveBeenCalledWith('create channel test', expect.objectContaining({
      userId: 'user123',
    }));
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array),
    }));

    generatePlanSpy.mockRestore();
  });
});
