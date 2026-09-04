import { data, execute } from '../../commands/admin/member';
import { ChatInputCommandInteraction, Collection, Guild, GuildMember, Role, User } from 'discord.js';

describe('/member command (Phase 4B.2 Member Inspection)', () => {
  const mockCreatedAt = new Date('2023-01-15T12:00:00.000Z');
  const mockJoinedAt = new Date('2023-06-20T15:30:00.000Z');

  function createMockUser(overrides: any = {}): User {
    return {
      id: '123456789012345678',
      username: 'yash',
      tag: 'yash#0001',
      displayName: 'Yash',
      bot: false,
      createdAt: mockCreatedAt,
      createdTimestamp: mockCreatedAt.getTime(),
      displayAvatarURL: jest.fn().mockReturnValue('https://cdn.discordapp.com/avatars/123/avatar.png'),
      ...overrides,
    } as unknown as User;
  }

  function createMockMember(user: User, overrides: any = {}): GuildMember {
    const defaultRoles = new Collection<string, Role>([
      ['guild-123', { id: 'guild-123', name: '@everyone', position: 0 } as Role],
      ['role-1', { id: 'role-1', name: 'Community Member', position: 2 } as Role],
      ['role-2', { id: 'role-2', name: 'Contributor', position: 5 } as Role],
    ]);

    return {
      id: user.id,
      user,
      displayName: 'Yash (Core)',
      joinedAt: mockJoinedAt,
      joinedTimestamp: mockJoinedAt.getTime(),
      roles: {
        cache: defaultRoles,
        highest: { id: 'role-2', name: 'Contributor', position: 5 } as Role,
        add: jest.fn(),
        remove: jest.fn(),
        set: jest.fn(),
      },
      communicationDisabledUntil: null,
      isCommunicationDisabled: jest.fn().mockReturnValue(false) as any,
      kick: jest.fn(),
      ban: jest.fn(),
      timeout: jest.fn(),
      setNickname: jest.fn(),
      ...overrides,
    } as unknown as GuildMember;
  }

  function createMockGuild(member?: GuildMember): Guild {
    return {
      id: 'guild-123',
      name: 'Kosmo Community',
      members: {
        fetch: jest.fn().mockImplementation((id: string) => {
          if (member && id === member.id) {
            return Promise.resolve(member);
          }
          return Promise.reject(new Error('Member not found'));
        }),
      },
    } as unknown as Guild;
  }

  function createMockInteraction(options: {
    guild?: Guild | null;
    user?: User;
    member?: GuildMember | null;
  }) {
    const repliedState = { replied: false, deferred: false };
    let replyData: any = null;
    let followUpData: any = null;

    const interaction = {
      guild: options.guild !== undefined ? options.guild : createMockGuild(options.member ?? undefined),
      user: { id: 'admin-1', username: 'AdminUser' },
      replied: false,
      deferred: false,
      options: {
        getUser: jest.fn().mockReturnValue(options.user),
        getMember: jest.fn().mockReturnValue(options.member ?? null),
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
  // Command Specification & Options
  // -------------------------------------------------------------------------
  test('command metadata registers /member with required user option', () => {
    const json = data.toJSON();
    expect(json.name).toBe('member');
    expect(json.description).toMatch(/inspect/i);

    const userOption = (json.options || []).find((opt: any) => opt.name === 'user');
    expect(userOption).toBeDefined();
    expect(userOption?.required).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 1. Valid Member Inspection
  // -------------------------------------------------------------------------
  test('Test 1: Valid member inspection returns Embed with correct structure', async () => {
    const user = createMockUser();
    const member = createMockMember(user);
    const guild = createMockGuild(member);

    const interaction = createMockInteraction({ guild, user, member });
    await execute(interaction as any);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const replyData = interaction.getReplyData();
    expect(replyData.embeds).toBeDefined();
    expect(replyData.embeds).toHaveLength(1);

    const embed = replyData.embeds[0].toJSON();
    expect(embed.title).toBe('Member Inspection');

    const fields = embed.fields || [];
    const fieldMap = new Map(fields.map((f: any) => [f.name, f.value]));

    expect(fieldMap.get('Member')).toContain('Yash (Core)');
    expect(fieldMap.get('User ID')).toBe(user.id);
    expect(fieldMap.get('Type')).toBe('User');
    expect(fieldMap.get('Highest Role')).toBe('Contributor');
    expect(fieldMap.get('Roles')).toContain('Contributor, Community Member');
    expect(fieldMap.get('Roles')).not.toContain('@everyone');
    expect(fieldMap.get('Timeout')).toBe('None');
  });

  // -------------------------------------------------------------------------
  // 2. Command Used Outside a Guild
  // -------------------------------------------------------------------------
  test('Test 2: Command used outside a guild responds ephemerally with error', async () => {
    const user = createMockUser();
    const interaction = createMockInteraction({ guild: null, user, member: null });

    await execute(interaction as any);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const replyData = interaction.getReplyData();
    expect(replyData.ephemeral).toBe(true);
    expect(replyData.content).toMatch(/Command must be used in a guild/i);
    expect(replyData.embeds).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 3. Member Unavailable / Not Found
  // -------------------------------------------------------------------------
  test('Test 3: Member not found in server responds ephemerally with error', async () => {
    const user = createMockUser();
    const guild = createMockGuild(undefined); // fetch will reject

    const interaction = createMockInteraction({ guild, user, member: null });

    await execute(interaction as any);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const replyData = interaction.getReplyData();
    expect(replyData.ephemeral).toBe(true);
    expect(replyData.content).toMatch(/Member could not be found in this server/i);
    expect(replyData.embeds).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 4. Correct User / Member Information
  // -------------------------------------------------------------------------
  test('Test 4: Formats timestamps, display name, and ID accurately', async () => {
    const user = createMockUser({
      id: '998877665544332211',
      username: 'alice_w',
      displayName: 'Alice',
    });
    const member = createMockMember(user, {
      displayName: 'Alice in Wonderland',
    });
    const guild = createMockGuild(member);

    const interaction = createMockInteraction({ guild, user, member });
    await execute(interaction as any);

    const replyData = interaction.getReplyData();
    const embed = replyData.embeds[0].toJSON();
    const fieldMap = new Map((embed.fields || []).map((f: any) => [f.name, f.value]));

    expect(fieldMap.get('Member')).toBe('Alice in Wonderland (alice_w)');
    expect(fieldMap.get('User ID')).toBe('998877665544332211');

    const createdSec = Math.floor(mockCreatedAt.getTime() / 1000);
    const joinedSec = Math.floor(mockJoinedAt.getTime() / 1000);
    expect(fieldMap.get('Account Created')).toBe(`<t:${createdSec}:F>`);
    expect(fieldMap.get('Joined Server')).toBe(`<t:${joinedSec}:F>`);
  });

  // -------------------------------------------------------------------------
  // 5. Role Formatting (with roles vs no additional roles)
  // -------------------------------------------------------------------------
  test('Test 5a: Formats assigned roles excluding @everyone in descending order', async () => {
    const user = createMockUser();
    const member = createMockMember(user);
    const guild = createMockGuild(member);

    const interaction = createMockInteraction({ guild, user, member });
    await execute(interaction as any);

    const embed = interaction.getReplyData().embeds[0].toJSON();
    const rolesField = (embed.fields || []).find((f: any) => f.name === 'Roles');
    expect(rolesField?.value).toBe('Contributor, Community Member');
  });

  test('Test 5b: Displays "No additional roles" when member has only @everyone', async () => {
    const user = createMockUser();
    const emptyRoles = new Collection<string, Role>([
      ['guild-123', { id: 'guild-123', name: '@everyone', position: 0 } as Role],
    ]);
    const member = createMockMember(user, {
      roles: {
        cache: emptyRoles,
        highest: { id: 'guild-123', name: '@everyone', position: 0 } as Role,
        add: jest.fn(),
        remove: jest.fn(),
        set: jest.fn(),
      } as any,
    });
    const guild = createMockGuild(member);

    const interaction = createMockInteraction({ guild, user, member });
    await execute(interaction as any);

    const embed = interaction.getReplyData().embeds[0].toJSON();
    const rolesField = (embed.fields || []).find((f: any) => f.name === 'Roles');
    expect(rolesField?.value).toBe('No additional roles');
  });

  // -------------------------------------------------------------------------
  // 6. Bot versus Human Member Status
  // -------------------------------------------------------------------------
  test('Test 6a: Identifies human user as "User"', async () => {
    const user = createMockUser({ bot: false });
    const member = createMockMember(user);
    const guild = createMockGuild(member);

    const interaction = createMockInteraction({ guild, user, member });
    await execute(interaction as any);

    const embed = interaction.getReplyData().embeds[0].toJSON();
    const typeField = (embed.fields || []).find((f: any) => f.name === 'Type');
    expect(typeField?.value).toBe('User');
  });

  test('Test 6b: Identifies bot account as "Bot"', async () => {
    const user = createMockUser({ bot: true, username: 'kosmo-bot' });
    const member = createMockMember(user);
    const guild = createMockGuild(member);

    const interaction = createMockInteraction({ guild, user, member });
    await execute(interaction as any);

    const embed = interaction.getReplyData().embeds[0].toJSON();
    const typeField = (embed.fields || []).find((f: any) => f.name === 'Type');
    expect(typeField?.value).toBe('Bot');
  });

  // -------------------------------------------------------------------------
  // 7. Timeout Status (None vs Active)
  // -------------------------------------------------------------------------
  test('Test 7a: Displays "None" when member has no active timeout', async () => {
    const user = createMockUser();
    const member = createMockMember(user, {
      communicationDisabledUntil: null,
      isCommunicationDisabled: jest.fn().mockReturnValue(false) as any,
    });
    const guild = createMockGuild(member);

    const interaction = createMockInteraction({ guild, user, member });
    await execute(interaction as any);

    const embed = interaction.getReplyData().embeds[0].toJSON();
    const timeoutField = (embed.fields || []).find((f: any) => f.name === 'Timeout');
    expect(timeoutField?.value).toBe('None');
  });

  test('Test 7b: Displays active timeout timestamp when member is timed out', async () => {
    const user = createMockUser();
    const timeoutUntil = new Date(Date.now() + 3600 * 1000); // 1 hour in future
    const member = createMockMember(user, {
      communicationDisabledUntil: timeoutUntil,
      isCommunicationDisabled: jest.fn().mockReturnValue(true) as any,
    });
    const guild = createMockGuild(member);

    const interaction = createMockInteraction({ guild, user, member });
    await execute(interaction as any);

    const embed = interaction.getReplyData().embeds[0].toJSON();
    const timeoutField = (embed.fields || []).find((f: any) => f.name === 'Timeout');
    const untilSec = Math.floor(timeoutUntil.getTime() / 1000);
    expect(timeoutField?.value).toContain(`Active until <t:${untilSec}:F>`);
  });

  // -------------------------------------------------------------------------
  // 8. Read-Only Behavior: Verifies NO Mutation APIs are Called
  // -------------------------------------------------------------------------
  test('Test 8: Read-only behavior does not invoke any mutation methods', async () => {
    const user = createMockUser();
    const member = createMockMember(user);
    const guild = createMockGuild(member);

    const interaction = createMockInteraction({ guild, user, member });
    await execute(interaction as any);

    // Verify member mutation APIs were NEVER invoked
    expect(member.roles.add).not.toHaveBeenCalled();
    expect(member.roles.remove).not.toHaveBeenCalled();
    expect(member.roles.set).not.toHaveBeenCalled();
    expect(member.kick).not.toHaveBeenCalled();
    expect(member.ban).not.toHaveBeenCalled();
    expect(member.timeout).not.toHaveBeenCalled();
    expect(member.setNickname).not.toHaveBeenCalled();
  });
});
