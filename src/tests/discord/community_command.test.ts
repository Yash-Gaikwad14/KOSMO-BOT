import { data, execute, formatItemList } from '../../commands/community/community';
import { loadCommands } from '../../commands/loader';
import {
  ChatInputCommandInteraction,
  Collection,
  Guild,
  GuildChannel,
  Role,
  ChannelType,
} from 'discord.js';
import * as path from 'path';

describe('/community command (Phase 4C.1 Basic Community Help)', () => {
  function createMockGuild(overrides: any = {}): Guild {
    const roles = new Collection<string, Role>([
      [
        'guild-123',
        {
          id: 'guild-123',
          name: '@everyone',
          position: 0,
          delete: jest.fn(),
          edit: jest.fn(),
        } as unknown as Role,
      ],
      [
        'role-founder',
        {
          id: 'role-founder',
          name: 'Founder',
          position: 10,
          delete: jest.fn(),
          edit: jest.fn(),
        } as unknown as Role,
      ],
      [
        'role-member',
        {
          id: 'role-member',
          name: 'Member',
          position: 1,
          delete: jest.fn(),
          edit: jest.fn(),
        } as unknown as Role,
      ],
      [
        'role-mod',
        {
          id: 'role-mod',
          name: 'Moderator',
          position: 5,
          delete: jest.fn(),
          edit: jest.fn(),
        } as unknown as Role,
      ],
    ]);

    const channels = new Collection<string, GuildChannel>([
      [
        'cat-1',
        {
          id: 'cat-1',
          name: 'Information',
          type: ChannelType.GuildCategory,
          delete: jest.fn(),
          edit: jest.fn(),
        } as unknown as GuildChannel,
      ],
      [
        'chan-announcements',
        {
          id: 'chan-announcements',
          name: 'announcements',
          type: ChannelType.GuildAnnouncement,
          delete: jest.fn(),
          edit: jest.fn(),
        } as unknown as GuildChannel,
      ],
      [
        'chan-general',
        {
          id: 'chan-general',
          name: 'general',
          type: ChannelType.GuildText,
          delete: jest.fn(),
          edit: jest.fn(),
        } as unknown as GuildChannel,
      ],
      [
        'voice-lounge',
        {
          id: 'voice-lounge',
          name: 'Community Lounge',
          type: ChannelType.GuildVoice,
          delete: jest.fn(),
          edit: jest.fn(),
        } as unknown as GuildChannel,
      ],
    ]);

    return {
      id: 'guild-123',
      name: 'KOSMO Community',
      ownerId: 'user-owner-1',
      memberCount: 1542,
      roles: {
        cache: roles,
        create: jest.fn(),
      } as any,
      channels: {
        cache: channels,
        create: jest.fn(),
      } as any,
      iconURL: jest.fn().mockReturnValue('https://cdn.discordapp.com/icons/guild-123/icon.png'),
      ...overrides,
    } as unknown as Guild;
  }

  function createMockInteraction(options: {
    subcommand: string;
    guild?: Guild | null;
  }) {
    let replyData: any = null;
    let followUpData: any = null;

    const interaction = {
      guild: options.guild !== undefined ? options.guild : createMockGuild(),
      user: { id: 'user-regular-1', username: 'CommunityUser' },
      replied: false,
      deferred: false,
      options: {
        getSubcommand: jest.fn().mockReturnValue(options.subcommand),
      },
      reply: jest.fn().mockImplementation(async (payload) => {
        replyData = payload;
        interaction.replied = true;
      }),
      followUp: jest.fn().mockImplementation(async (payload) => {
        followUpData = payload;
      }),
      getReplyData: () => replyData,
      getFollowUpData: () => followUpData,
    };

    return interaction;
  }

  // -------------------------------------------------------------------------
  // 12. Command exports match the loader contract
  // -------------------------------------------------------------------------
  test('Test 12: Command definition conforms to loader contract and discovers subcommands', async () => {
    const json = data.toJSON();
    expect(json.name).toBe('community');
    expect(json.description).toMatch(/community/i);

    const subcommands = (json.options || []).map((opt: any) => opt.name);
    expect(subcommands).toContain('info');
    expect(subcommands).toContain('channels');
    expect(subcommands).toContain('roles');

    // Verify command loader discovers the command module
    const commandsRoot = path.join(__dirname, '../../commands');
    const commandMap = await loadCommands(commandsRoot);
    expect(commandMap.has('community')).toBe(true);

    const communityEntry = commandMap.get('community');
    expect(communityEntry?.data.name).toBe('community');
    expect(typeof communityEntry?.default).toBe('function');
  });

  // -------------------------------------------------------------------------
  // 1. /community info works in a guild
  // -------------------------------------------------------------------------
  test('Test 1: /community info works in a guild and delivers expected Embed', async () => {
    const mockGuild = createMockGuild();
    const interaction = createMockInteraction({ subcommand: 'info', guild: mockGuild });

    await execute(interaction as any);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const replyData = interaction.getReplyData();
    expect(replyData.embeds).toHaveLength(1);

    const embed = replyData.embeds[0].toJSON();
    expect(embed.title).toBe('Community Information — KOSMO Community');
    expect(embed.fields).toBeDefined();
    expect(embed.fields.length).toBeGreaterThanOrEqual(6);
  });

  // -------------------------------------------------------------------------
  // 2. /community info rejects non-guild execution
  // -------------------------------------------------------------------------
  test('Test 2: /community info rejects non-guild execution with ephemeral error', async () => {
    const interaction = createMockInteraction({ subcommand: 'info', guild: null });

    await execute(interaction as any);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const replyData = interaction.getReplyData();
    expect(replyData.ephemeral).toBe(true);
    expect(replyData.content).toBe('Command must be used in a guild.');
    expect(replyData.embeds).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 3. /community channels works in a guild
  // -------------------------------------------------------------------------
  test('Test 3: /community channels works in a guild and returns channels embed', async () => {
    const mockGuild = createMockGuild();
    const interaction = createMockInteraction({ subcommand: 'channels', guild: mockGuild });

    await execute(interaction as any);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const replyData = interaction.getReplyData();
    expect(replyData.embeds).toHaveLength(1);

    const embed = replyData.embeds[0].toJSON();
    expect(embed.title).toBe('Community Channels — KOSMO Community');
    expect(embed.description).toContain('Total channels: **4**');
  });

  // -------------------------------------------------------------------------
  // 4. /community roles works in a guild
  // -------------------------------------------------------------------------
  test('Test 4: /community roles works in a guild and returns roles embed', async () => {
    const mockGuild = createMockGuild();
    const interaction = createMockInteraction({ subcommand: 'roles', guild: mockGuild });

    await execute(interaction as any);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const replyData = interaction.getReplyData();
    expect(replyData.embeds).toHaveLength(1);

    const embed = replyData.embeds[0].toJSON();
    expect(embed.title).toBe('Community Roles — KOSMO Community');
    expect(embed.description).toContain('Total community roles: **3**');
  });

  // -------------------------------------------------------------------------
  // 5. Server information is correctly formatted
  // -------------------------------------------------------------------------
  test('Test 5: Server information fields are accurately populated from Guild', async () => {
    const mockGuild = createMockGuild();
    const interaction = createMockInteraction({ subcommand: 'info', guild: mockGuild });

    await execute(interaction as any);

    const replyData = interaction.getReplyData();
    const embed = replyData.embeds[0].toJSON();
    const fieldMap = new Map((embed.fields || []).map((f: any) => [f.name, f.value]));

    expect(fieldMap.get('Server Name')).toBe('KOSMO Community');
    expect(fieldMap.get('Server ID')).toBe('guild-123');
    expect(fieldMap.get('Server Owner')).toBe('<@user-owner-1>');
    expect(fieldMap.get('Members')).toBe('1,542');
    expect(fieldMap.get('Roles')).toBe('4');
    expect(fieldMap.get('Channels')).toBe('4');
  });

  // -------------------------------------------------------------------------
  // 6. Channels are grouped/formatted correctly
  // -------------------------------------------------------------------------
  test('Test 6: Channels are grouped into Categories, Text, and Voice sections', async () => {
    const mockGuild = createMockGuild();
    const interaction = createMockInteraction({ subcommand: 'channels', guild: mockGuild });

    await execute(interaction as any);

    const replyData = interaction.getReplyData();
    const embed = replyData.embeds[0].toJSON();
    const fieldMap = new Map((embed.fields || []).map((f: any) => [f.name, f.value]));

    expect(fieldMap.get('📁 Categories (1)')).toContain('Information');
    expect(fieldMap.get('💬 Text Channels (2)')).toContain('<#chan-announcements>');
    expect(fieldMap.get('💬 Text Channels (2)')).toContain('<#chan-general>');
    expect(fieldMap.get('🔊 Voice Channels (1)')).toContain('<#voice-lounge>');
  });

  // -------------------------------------------------------------------------
  // 7. Roles are formatted correctly (sorted descending by position)
  // -------------------------------------------------------------------------
  test('Test 7: Roles are sorted descending by hierarchy position', async () => {
    const mockGuild = createMockGuild();
    const interaction = createMockInteraction({ subcommand: 'roles', guild: mockGuild });

    await execute(interaction as any);

    const replyData = interaction.getReplyData();
    const embed = replyData.embeds[0].toJSON();
    const rolesField = (embed.fields || []).find((f: any) => f.name.startsWith('Roles'));

    // Position 10 (Founder) -> Position 5 (Moderator) -> Position 1 (Member)
    expect(rolesField?.value).toBe('Founder, Moderator, Member');
  });

  // -------------------------------------------------------------------------
  // 8. @everyone is not incorrectly displayed as a normal role
  // -------------------------------------------------------------------------
  test('Test 8: @everyone is excluded from community roles listing', async () => {
    const mockGuild = createMockGuild();
    const interaction = createMockInteraction({ subcommand: 'roles', guild: mockGuild });

    await execute(interaction as any);

    const replyData = interaction.getReplyData();
    const embed = replyData.embeds[0].toJSON();
    const rolesField = (embed.fields || []).find((f: any) => f.name.startsWith('Roles'));

    expect(rolesField?.value).not.toContain('@everyone');

    // Test when only @everyone exists in guild
    const onlyEveryoneGuild = createMockGuild({
      roles: {
        cache: new Collection<string, Role>([
          ['guild-123', { id: 'guild-123', name: '@everyone', position: 0 } as Role],
        ]),
      } as any,
    });

    const interaction2 = createMockInteraction({ subcommand: 'roles', guild: onlyEveryoneGuild });
    await execute(interaction2 as any);

    const embed2 = interaction2.getReplyData().embeds[0].toJSON();
    const rolesField2 = (embed2.fields || []).find((f: any) => f.name.startsWith('Roles'));
    expect(rolesField2?.value).toBe('No community roles found');
  });

  // -------------------------------------------------------------------------
  // 9. Large channel/role lists are safely truncated
  // -------------------------------------------------------------------------
  test('Test 9: formatItemList safely truncates long item lists within limits', () => {
    // 100 role items each of length ~20
    const manyRoles = Array.from({ length: 100 }, (_, i) => `CommunityRoleNumber${i + 1}`);
    const formatted = formatItemList(manyRoles, 500);

    expect(formatted.length).toBeLessThanOrEqual(520);
    expect(formatted).toMatch(/\(\+\d+ more\)/);
    expect(formatted).toContain('CommunityRoleNumber1');

    // Verify empty list returns 'None'
    expect(formatItemList([])).toBe('None');
  });

  // -------------------------------------------------------------------------
  // 10. No Discord mutation APIs are invoked
  // -------------------------------------------------------------------------
  test('Test 10: Strictly read-only; no Discord mutation APIs are called across any subcommand', async () => {
    const mockGuild = createMockGuild();

    for (const sub of ['info', 'channels', 'roles']) {
      const interaction = createMockInteraction({ subcommand: sub, guild: mockGuild });
      await execute(interaction as any);

      // Verify no channel mutations
      expect(mockGuild.channels.create).not.toHaveBeenCalled();
      for (const chan of mockGuild.channels.cache.values()) {
        expect(chan.delete).not.toHaveBeenCalled();
        expect(chan.edit).not.toHaveBeenCalled();
      }

      // Verify no role mutations
      expect(mockGuild.roles.create).not.toHaveBeenCalled();
      for (const role of mockGuild.roles.cache.values()) {
        expect(role.delete).not.toHaveBeenCalled();
        expect(role.edit).not.toHaveBeenCalled();
      }
    }
  });

  // -------------------------------------------------------------------------
  // 11. Expected Discord lookup failures are handled safely
  // -------------------------------------------------------------------------
  test('Test 11: Handles unexpected errors gracefully without unhandled crashes', async () => {
    const failingGuild = createMockGuild();
    Object.defineProperty(failingGuild, 'roles', {
      get: () => {
        throw new Error('Discord Gateway connection reset');
      },
    });

    const interaction = createMockInteraction({ subcommand: 'info', guild: failingGuild });
    await execute(interaction as any);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const replyData = interaction.getReplyData();
    expect(replyData.ephemeral).toBe(true);
    expect(replyData.content).toContain('Discord Gateway connection reset');
  });
});
