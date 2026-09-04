import {
  data,
  execute,
  formatItemList,
  findBestCommunityChannel,
  normalizeName,
  TOPIC_KEYWORDS,
  GuideTopic,
} from '../../commands/community/community';
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

describe('/community command (Phase 4C.1 Basic Community Help & 4C.2 Guidance)', () => {
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
          parentId: 'cat-1',
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
    topic?: string;
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
        getString: jest.fn().mockImplementation((name: string) => {
          if (name === 'topic') return options.topic;
          return null;
        }),
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
    expect(subcommands).toContain('guide');

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

    for (const sub of ['info', 'channels', 'roles', 'guide']) {
      const interaction = createMockInteraction({
        subcommand: sub,
        topic: 'general',
        guild: mockGuild,
      });
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

  // =========================================================================
  // PHASE 4C.2: COMMUNITY NAVIGATION & GUIDANCE TESTS
  // =========================================================================

  // -------------------------------------------------------------------------
  // Phase 4C.2 - 1: Subcommand definition and required option
  // -------------------------------------------------------------------------
  test('Phase 4C.2 - 1: /community guide requires topic choice option with 6 predefined choices', () => {
    const json = data.toJSON();
    const guideSubcommand = (json.options || []).find((opt: any) => opt.name === 'guide') as any;

    expect(guideSubcommand).toBeDefined();
    expect(guideSubcommand.description).toMatch(/find the right place/i);

    const topicOption = (guideSubcommand.options || []).find((opt: any) => opt.name === 'topic');
    expect(topicOption).toBeDefined();
    expect(topicOption.required).toBe(true);

    const choices = (topicOption.choices || []).map((c: any) => c.value);
    expect(choices).toEqual([
      'general',
      'announcements',
      'help',
      'feedback',
      'events',
      'introductions',
    ]);
  });

  // -------------------------------------------------------------------------
  // Phase 4C.2 - 2: /community guide works inside a guild
  // -------------------------------------------------------------------------
  test('Phase 4C.2 - 2: /community guide works in a guild and returns guidance Embed', async () => {
    const mockGuild = createMockGuild();
    const interaction = createMockInteraction({
      subcommand: 'guide',
      topic: 'general',
      guild: mockGuild,
    });

    await execute(interaction as any);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const replyData = interaction.getReplyData();
    expect(replyData.embeds).toHaveLength(1);

    const embed = replyData.embeds[0].toJSON();
    expect(embed.title).toBe('Community Guide — KOSMO Community');
    const fieldMap = new Map((embed.fields || []).map((f: any) => [f.name, f.value]));

    expect(fieldMap.get('Topic')).toBe('General');
    expect(fieldMap.get('Recommended Channel')).toBe('<#chan-general>');
    expect(fieldMap.get('Reason')).toBe('Based on the channel names, this appears to be the best match.');
  });

  // -------------------------------------------------------------------------
  // Phase 4C.2 - 3: /community guide rejects non-guild execution
  // -------------------------------------------------------------------------
  test('Phase 4C.2 - 3: /community guide rejects non-guild execution with ephemeral error', async () => {
    const interaction = createMockInteraction({
      subcommand: 'guide',
      topic: 'help',
      guild: null,
    });

    await execute(interaction as any);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const replyData = interaction.getReplyData();
    expect(replyData.ephemeral).toBe(true);
    expect(replyData.content).toBe('Command must be used in a guild.');
  });

  // -------------------------------------------------------------------------
  // Phase 4C.2 - 4: Exact channel-name match wins over fuzzy/partial matches
  // -------------------------------------------------------------------------
  test('Phase 4C.2 - 4: Exact channel-name match wins over partial matches', () => {
    const channels = new Collection<string, GuildChannel>([
      [
        'chan-chat',
        {
          id: 'chan-chat',
          name: 'general-chat-and-discussion',
          type: ChannelType.GuildText,
        } as GuildChannel,
      ],
      [
        'chan-exact',
        {
          id: 'chan-exact',
          name: 'general',
          type: ChannelType.GuildText,
        } as GuildChannel,
      ],
    ]);

    const guild = createMockGuild({ channels: { cache: channels } as any });
    const match = findBestCommunityChannel(guild, 'general');

    expect(match).not.toBeNull();
    expect(match?.channel.id).toBe('chan-exact');
  });

  // -------------------------------------------------------------------------
  // Phase 4C.2 - 5: Keyword channel-name match works
  // -------------------------------------------------------------------------
  test('Phase 4C.2 - 5: Strong keyword channel-name match works across topics', () => {
    const channels = new Collection<string, GuildChannel>([
      [
        'chan-news',
        {
          id: 'chan-news',
          name: 'server-news',
          type: ChannelType.GuildText,
        } as GuildChannel,
      ],
      [
        'chan-faq',
        {
          id: 'chan-faq',
          name: 'faq-and-help',
          type: ChannelType.GuildText,
        } as GuildChannel,
      ],
      [
        'chan-ideas',
        {
          id: 'chan-ideas',
          name: 'community-suggestions',
          type: ChannelType.GuildText,
        } as GuildChannel,
      ],
      [
        'chan-meetups',
        {
          id: 'chan-meetups',
          name: 'weekly-meetups',
          type: ChannelType.GuildText,
        } as GuildChannel,
      ],
      [
        'chan-welcome',
        {
          id: 'chan-welcome',
          name: 'welcome-and-rules',
          type: ChannelType.GuildText,
        } as GuildChannel,
      ],
    ]);

    const guild = createMockGuild({ channels: { cache: channels } as any });

    expect(findBestCommunityChannel(guild, 'announcements')?.channel.id).toBe('chan-news');
    expect(findBestCommunityChannel(guild, 'help')?.channel.id).toBe('chan-faq');
    expect(findBestCommunityChannel(guild, 'feedback')?.channel.id).toBe('chan-ideas');
    expect(findBestCommunityChannel(guild, 'events')?.channel.id).toBe('chan-meetups');
    expect(findBestCommunityChannel(guild, 'introductions')?.channel.id).toBe('chan-welcome');
  });

  // -------------------------------------------------------------------------
  // Phase 4C.2 - 6: Category-name matching works
  // -------------------------------------------------------------------------
  test('Phase 4C.2 - 6: Category-name matching identifies relevant channel inside category', () => {
    const channels = new Collection<string, GuildChannel>([
      [
        'cat-events',
        {
          id: 'cat-events',
          name: 'Events & Meetups',
          type: ChannelType.GuildCategory,
        } as GuildChannel,
      ],
      [
        'chan-schedule',
        {
          id: 'chan-schedule',
          name: 'schedule',
          type: ChannelType.GuildText,
          parentId: 'cat-events',
        } as GuildChannel,
      ],
      [
        'chan-random',
        {
          id: 'chan-random',
          name: 'random-room',
          type: ChannelType.GuildText,
        } as GuildChannel,
      ],
    ]);

    const guild = createMockGuild({ channels: { cache: channels } as any });
    const match = findBestCommunityChannel(guild, 'events');

    expect(match).not.toBeNull();
    expect(match?.channel.id).toBe('chan-schedule');
    expect(match?.categoryName).toBe('Events & Meetups');
  });

  // -------------------------------------------------------------------------
  // Phase 4C.2 - 7: Channel-name matching has priority over category-only matching
  // -------------------------------------------------------------------------
  test('Phase 4C.2 - 7: Channel-name matching takes priority over category-only matching', () => {
    const channels = new Collection<string, GuildChannel>([
      // Channel with topic keyword name in generic category
      [
        'chan-help',
        {
          id: 'chan-help',
          name: 'questions-and-support',
          type: ChannelType.GuildText,
          parentId: 'cat-general',
        } as GuildChannel,
      ],
      // Generic channel name inside Help category
      [
        'cat-help',
        {
          id: 'cat-help',
          name: 'Help Desk',
          type: ChannelType.GuildCategory,
        } as GuildChannel,
      ],
      [
        'chan-room-x',
        {
          id: 'chan-room-x',
          name: 'desk-room-alpha',
          type: ChannelType.GuildText,
          parentId: 'cat-help',
        } as GuildChannel,
      ],
    ]);

    const guild = createMockGuild({ channels: { cache: channels } as any });
    const match = findBestCommunityChannel(guild, 'help');

    // chan-help has strong keyword match in its name, which beats category-only match
    expect(match).not.toBeNull();
    expect(match?.channel.id).toBe('chan-help');
  });

  // -------------------------------------------------------------------------
  // Phase 4C.2 - 8: No suitable channel returns clean no-match response
  // -------------------------------------------------------------------------
  test('Phase 4C.2 - 8: No suitable channel returns ephemeral no-match response', async () => {
    // Guild with only completely unrelated channels
    const channels = new Collection<string, GuildChannel>([
      [
        'chan-coding',
        {
          id: 'chan-coding',
          name: 'python-code-snippets',
          type: ChannelType.GuildText,
        } as GuildChannel,
      ],
    ]);

    const guild = createMockGuild({ channels: { cache: channels } as any });
    const interaction = createMockInteraction({
      subcommand: 'guide',
      topic: 'events',
      guild,
    });

    await execute(interaction as any);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const replyData = interaction.getReplyData();
    expect(replyData.ephemeral).toBe(true);
    expect(replyData.content).toBe('No matching community channel was found for this topic.');
    expect(replyData.embeds).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Phase 4C.2 - 9: Category context is displayed when available
  // -------------------------------------------------------------------------
  test('Phase 4C.2 - 9: Category context is included in embed fields when channel has a category', async () => {
    const mockGuild = createMockGuild(); // announcements has parentId: 'cat-1' (Information)
    const interaction = createMockInteraction({
      subcommand: 'guide',
      topic: 'announcements',
      guild: mockGuild,
    });

    await execute(interaction as any);

    const replyData = interaction.getReplyData();
    const embed = replyData.embeds[0].toJSON();
    const fieldMap = new Map((embed.fields || []).map((f: any) => [f.name, f.value]));

    expect(fieldMap.get('Recommended Channel')).toBe('<#chan-announcements>');
    expect(fieldMap.get('Category')).toBe('Information');
  });

  // -------------------------------------------------------------------------
  // Phase 4C.2 - 10: Case-insensitive and punctuation normalization
  // -------------------------------------------------------------------------
  test('Phase 4C.2 - 10: normalizeName handles upper case, hyphens, underscores, and extra spaces', () => {
    expect(normalizeName('GENERAL-CHAT')).toBe('general chat');
    expect(normalizeName('general_chat')).toBe('general chat');
    expect(normalizeName('  General   Chat  ')).toBe('general chat');
    expect(normalizeName('#💬-general_chat!')).toBe('general chat');

    const channels = new Collection<string, GuildChannel>([
      [
        'chan-upper',
        {
          id: 'chan-upper',
          name: 'COMMUNITY_ANNOUNCEMENTS',
          type: ChannelType.GuildText,
        } as GuildChannel,
      ],
    ]);

    const guild = createMockGuild({ channels: { cache: channels } as any });
    const match = findBestCommunityChannel(guild, 'announcements');
    expect(match?.channel.id).toBe('chan-upper');
  });

  // -------------------------------------------------------------------------
  // Phase 4C.2 - 11: Unsupported / non-navigable channels are not selected
  // -------------------------------------------------------------------------
  test('Phase 4C.2 - 11: Voice channels, Categories, and unsupported types are never selected', () => {
    const channels = new Collection<string, GuildChannel>([
      [
        'cat-general',
        {
          id: 'cat-general',
          name: 'general',
          type: ChannelType.GuildCategory,
        } as GuildChannel,
      ],
      [
        'voice-general',
        {
          id: 'voice-general',
          name: 'general',
          type: ChannelType.GuildVoice,
        } as GuildChannel,
      ],
    ]);

    const guild = createMockGuild({ channels: { cache: channels } as any });
    const match = findBestCommunityChannel(guild, 'general');

    // Both are non-navigable text destinations, so match should be null
    expect(match).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Phase 4C.2 - 12: Ambiguous / equal matches do not randomly select
  // -------------------------------------------------------------------------
  test('Phase 4C.2 - 12: Ambiguous equal matches return null rather than guessing randomly', () => {
    const channels = new Collection<string, GuildChannel>([
      [
        'chan-help-a',
        {
          id: 'chan-help-a',
          name: 'help-room-one',
          type: ChannelType.GuildText,
        } as GuildChannel,
      ],
      [
        'chan-help-b',
        {
          id: 'chan-help-b',
          name: 'help-room-two',
          type: ChannelType.GuildText,
        } as GuildChannel,
      ],
    ]);

    const guild = createMockGuild({ channels: { cache: channels } as any });
    // Both channels have identical scores and token counts/ratios
    const match = findBestCommunityChannel(guild, 'help');
    expect(match).toBeNull();
  });
});
