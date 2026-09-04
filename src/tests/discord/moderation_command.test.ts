import {
  ChatInputCommandInteraction,
  Collection,
  Guild,
  GuildMember,
  Role,
  User,
  PermissionFlagsBits,
  ChannelType,
} from 'discord.js';
import * as path from 'path';
import { data, execute } from '../../commands/moderation/mod';
import { loadCommands } from '../../commands/loader';
import * as actionsModule from '../../services/discord/actions';

describe('Phase 4D.1 /mod timeout Moderation Command', () => {
  const mockNow = new Date('2026-09-04T12:00:00.000Z');

  function createMockRole(id: string, name: string, position: number): Role {
    return {
      id,
      name,
      position,
    } as unknown as Role;
  }

  function createMockUser(overrides: any = {}): User {
    return {
      id: 'target-user-123',
      username: 'TargetUser',
      tag: 'TargetUser#0001',
      displayName: 'TargetUser',
      bot: false,
      ...overrides,
    } as unknown as User;
  }

  function createMockMember(user: User, rolesList: Role[] = [], overrides: any = {}): GuildMember {
    const rolesMap = new Collection<string, Role>();
    rolesList.forEach((r) => rolesMap.set(r.id, r));

    const highest = rolesList.length > 0
      ? [...rolesList].sort((a, b) => b.position - a.position)[0]
      : createMockRole('everyone', '@everyone', 0);

    const member: any = {
      id: user.id,
      user,
      displayName: user.displayName || user.username,
      roles: {
        cache: rolesMap,
        highest,
      },
      communicationDisabledUntil: null,
      isCommunicationDisabled: jest.fn().mockReturnValue(false),
      timeout: jest.fn().mockImplementation(async (ms: number, reason?: string) => {
        member.communicationDisabledUntil = new Date(Date.now() + ms);
        member.isCommunicationDisabled.mockReturnValue(true);
        return member;
      }),
      ...overrides,
    };
    return member as unknown as GuildMember;
  }

  function createMockGuild(options: {
    ownerId?: string;
    botHasPermission?: boolean;
    botRolePosition?: number;
    channels?: any[];
  } = {}): Guild {
    const ownerId = options.ownerId || 'guild-owner-999';
    const botPerm = options.botHasPermission !== false;
    const botPosition = options.botRolePosition ?? 50;

    const botMember: any = {
      id: 'kosmo-bot-id',
      displayName: 'KosmoBot',
      roles: {
        cache: new Collection<string, Role>([
          ['bot-role', createMockRole('bot-role', 'KosmoBot', botPosition)],
        ]),
        highest: createMockRole('bot-role', 'KosmoBot', botPosition),
      },
      permissions: {
        has: jest.fn().mockImplementation((perm) => {
          if (perm === PermissionFlagsBits.ModerateMembers || perm === 'ModerateMembers') {
            return botPerm;
          }
          return false;
        }),
      },
    };

    const channelsMap = new Collection<string, any>();
    (options.channels || []).forEach((c) => channelsMap.set(c.id, c));

    const membersStore = new Map<string, GuildMember>();

    const guild: any = {
      id: 'guild-123',
      name: 'Kosmo Community',
      ownerId,
      members: {
        cache: membersStore,
        me: botMember,
        fetchMe: jest.fn().mockResolvedValue(botMember),
        fetch: jest.fn().mockImplementation(async (arg: any) => {
          const id = typeof arg === 'string' ? arg : arg?.user;
          const found = membersStore.get(id);
          if (found) return found;
          throw new Error(`Member "${id}" not found.`);
        }),
      },
      channels: {
        cache: channelsMap,
      },
    };

    return guild as unknown as Guild;
  }

  function createMockInteraction(options: {
    guild?: Guild | null;
    callerUser?: any;
    callerRoles?: Role[];
    targetUser?: User;
    targetMember?: GuildMember | null;
    duration?: any;
    reason?: any;
  }) {
    let replyPayload: any = null;
    let followUpPayload: any = null;

    const callerUser = {
      id: options.callerUser?.id || 'mod-caller-1',
      username: options.callerUser?.username || 'ModCaller',
      tag: options.callerUser?.tag || 'ModCaller#0001',
      bot: false,
      ...options.callerUser,
    } as User;

    const callerRoles = options.callerRoles || [createMockRole('mod-role', 'Moderator', 30)];
    const callerMember = createMockMember(callerUser, callerRoles);

    const interaction: any = {
      guild: options.guild !== undefined ? options.guild : null,
      user: callerUser,
      member: callerMember,
      replied: false,
      deferred: false,
      options: {
        getSubcommand: jest.fn().mockReturnValue('timeout'),
        getUser: jest.fn().mockReturnValue(options.targetUser),
        getMember: jest.fn().mockReturnValue(options.targetMember ?? null),
        getInteger: jest.fn().mockReturnValue(options.duration),
        getString: jest.fn().mockReturnValue(options.reason),
      },
      reply: jest.fn().mockImplementation(async (payload) => {
        replyPayload = payload;
        interaction.replied = true;
      }),
      followUp: jest.fn().mockImplementation(async (payload) => {
        followUpPayload = payload;
      }),
      getReplyData: () => replyPayload,
      getFollowUpData: () => followUpPayload,
    };

    return { interaction, callerMember };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // 1. COMMAND REGISTRATION & LOADER DISCOVERY
  // =========================================================================
  describe('Command Registration & Loader Discovery', () => {
    test('command is named "mod" with "timeout" subcommand and options', () => {
      expect(data.name).toBe('mod');
      expect(data.description).toBeDefined();

      const timeoutSub = data.options.find((opt: any) => opt.name === 'timeout') as any;
      expect(timeoutSub).toBeDefined();

      const userOpt = timeoutSub.options.find((o: any) => o.name === 'user');
      const durationOpt = timeoutSub.options.find((o: any) => o.name === 'duration');
      const reasonOpt = timeoutSub.options.find((o: any) => o.name === 'reason');

      expect(userOpt?.required).toBe(true);
      expect(durationOpt?.required).toBe(true);
      expect(durationOpt?.min_value).toBe(1);
      expect(durationOpt?.max_value).toBe(10080);
      expect(reasonOpt?.required).toBe(true);
    });

    test('loader discovers and loads /mod command recursively', async () => {
      const commandsRoot = path.resolve(__dirname, '../../commands');
      const loaded = await loadCommands(commandsRoot);
      expect(loaded.has('mod')).toBe(true);
      const entry = loaded.get('mod');
      expect(entry?.data.name).toBe('mod');
      expect(typeof entry?.default).toBe('function');
    });
  });

  // =========================================================================
  // 2. PRECONDITIONS: DM & BOT PERMISSION
  // =========================================================================
  describe('Preconditions: DM & Bot Permissions', () => {
    test('rejects execution outside of a guild (DM rejection)', async () => {
      const { interaction } = createMockInteraction({
        guild: null,
      });

      await execute(interaction as any);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'Command must be used in a guild.',
        ephemeral: true,
      });
    });

    test('rejects execution when bot lacks ModerateMembers permission', async () => {
      const guild = createMockGuild({ botHasPermission: false });
      const targetUser = createMockUser();
      const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 1)]);
      (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

      const { interaction } = createMockInteraction({
        guild,
        targetUser,
        targetMember,
        duration: 10,
        reason: 'Spamming',
      });

      await execute(interaction as any);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❌ Bot lacks the "Moderate Members" (Timeout) permission.',
        ephemeral: true,
      });
    });
  });

  // =========================================================================
  // 3. CENTRALIZED AUTHORIZATION (policy.ts Category.MODERATE)
  // =========================================================================
  describe('Centralized Authorization', () => {
    test('rejects unauthorized caller (unrecognized role / no role)', async () => {
      const guild = createMockGuild();
      const targetUser = createMockUser();
      const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 1)]);
      (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

      const { interaction } = createMockInteraction({
        guild,
        callerRoles: [createMockRole('unauth-role', 'RandomRole', 2)],
        targetUser,
        targetMember,
        duration: 15,
        reason: 'Inappropriate language',
      });

      await execute(interaction as any);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❌ You are not authorized to use moderation commands.',
        ephemeral: true,
      });
    });

    test('authorizes Moderator role caller', async () => {
      const guild = createMockGuild();
      const targetUser = createMockUser();
      const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 1)]);
      (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

      const { interaction } = createMockInteraction({
        guild,
        callerRoles: [createMockRole('mod-role', 'Moderator', 30)],
        targetUser,
        targetMember,
        duration: 10,
        reason: 'Test timeout',
      });

      await execute(interaction as any);

      expect(interaction.reply).toHaveBeenCalled();
      const replyCall = interaction.getReplyData();
      expect(replyCall.embeds?.[0]?.data?.title).toBe('⏳ Member Timed Out');
    });

    test('authorizes Admin role caller', async () => {
      const guild = createMockGuild();
      const targetUser = createMockUser();
      const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 1)]);
      (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

      const { interaction } = createMockInteraction({
        guild,
        callerRoles: [createMockRole('admin-role', 'Admin', 40)],
        targetUser,
        targetMember,
        duration: 10,
        reason: 'Test timeout',
      });

      await execute(interaction as any);

      const replyCall = interaction.getReplyData();
      expect(replyCall.embeds?.[0]?.data?.title).toBe('⏳ Member Timed Out');
    });

    test('authorizes Team Kosmo role caller', async () => {
      const guild = createMockGuild();
      const targetUser = createMockUser();
      const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 1)]);
      (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

      const { interaction } = createMockInteraction({
        guild,
        callerRoles: [createMockRole('team-kosmo-role', 'Team Kosmo', 45)],
        targetUser,
        targetMember,
        duration: 10,
        reason: 'Test timeout',
      });

      await execute(interaction as any);

      const replyCall = interaction.getReplyData();
      expect(replyCall.embeds?.[0]?.data?.title).toBe('⏳ Member Timed Out');
    });

    test('authorizes Founder role caller', async () => {
      const guild = createMockGuild();
      const targetUser = createMockUser();
      const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 1)]);
      (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

      const { interaction } = createMockInteraction({
        guild,
        callerRoles: [createMockRole('founder-role', 'Founder', 50)],
        targetUser,
        targetMember,
        duration: 10,
        reason: 'Test timeout',
      });

      await execute(interaction as any);

      const replyCall = interaction.getReplyData();
      expect(replyCall.embeds?.[0]?.data?.title).toBe('⏳ Member Timed Out');
    });

    test('authorizes Server Owner caller even without configured roles', async () => {
      const ownerId = 'server-owner-777';
      const guild = createMockGuild({ ownerId });
      const targetUser = createMockUser();
      const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 1)]);
      (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

      const { interaction } = createMockInteraction({
        guild,
        callerUser: { id: ownerId, username: 'ServerOwner' },
        callerRoles: [], // No roles, dynamic owner resolution
        targetUser,
        targetMember,
        duration: 20,
        reason: 'Owner disciplinary action',
      });

      await execute(interaction as any);

      const replyCall = interaction.getReplyData();
      expect(replyCall.embeds?.[0]?.data?.title).toBe('⏳ Member Timed Out');
    });
  });

  // =========================================================================
  // 4. PARAMETER VALIDATION
  // =========================================================================
  describe('Parameter Validation', () => {
    test('rejects duration < 1 minute', async () => {
      const guild = createMockGuild();
      const targetUser = createMockUser();
      const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 1)]);
      (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

      const { interaction } = createMockInteraction({
        guild,
        targetUser,
        targetMember,
        duration: 0,
        reason: 'Rule break',
      });

      await execute(interaction as any);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❌ Timeout duration must be an integer between 1 and 10080 minutes (7 days).',
        ephemeral: true,
      });
    });

    test('rejects duration > 10080 minutes', async () => {
      const guild = createMockGuild();
      const targetUser = createMockUser();
      const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 1)]);
      (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

      const { interaction } = createMockInteraction({
        guild,
        targetUser,
        targetMember,
        duration: 10081,
        reason: 'Rule break',
      });

      await execute(interaction as any);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❌ Timeout duration must be an integer between 1 and 10080 minutes (7 days).',
        ephemeral: true,
      });
    });

    test('rejects empty or whitespace reason', async () => {
      const guild = createMockGuild();
      const targetUser = createMockUser();
      const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 1)]);
      (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

      const { interaction } = createMockInteraction({
        guild,
        targetUser,
        targetMember,
        duration: 10,
        reason: '   ',
      });

      await execute(interaction as any);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❌ A valid reason must be provided for the timeout.',
        ephemeral: true,
      });
    });

    test('rejects when target member is not found in guild', async () => {
      const guild = createMockGuild();
      const targetUser = createMockUser();

      const { interaction } = createMockInteraction({
        guild,
        targetUser,
        targetMember: null, // Member fetch will reject
        duration: 10,
        reason: 'Valid reason',
      });

      await execute(interaction as any);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❌ Member could not be found in this server.',
        ephemeral: true,
      });
    });
  });

  // =========================================================================
  // 5. TARGET SAFETY & ROLE HIERARCHY
  // =========================================================================
  describe('Target Safety & Role Hierarchy', () => {
    test('rejects self-target timeout', async () => {
      const guild = createMockGuild();
      const sameId = 'moderator-user-1';
      const selfUser = createMockUser({ id: sameId });
      const selfMember = createMockMember(selfUser, [createMockRole('mod-role', 'Moderator', 30)]);
      (guild.members.cache as Map<string, GuildMember>).set(sameId, selfMember);

      const { interaction } = createMockInteraction({
        guild,
        callerUser: { id: sameId },
        callerRoles: [createMockRole('mod-role', 'Moderator', 30)],
        targetUser: selfUser,
        targetMember: selfMember,
        duration: 10,
        reason: 'Self test',
      });

      await execute(interaction as any);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❌ You cannot moderate yourself.',
        ephemeral: true,
      });
    });

    test('rejects bot target timeout', async () => {
      const guild = createMockGuild();
      const botUser = createMockUser({ id: 'bot-123', bot: true });
      const botMember = createMockMember(botUser, [createMockRole('role-1', 'BotRole', 5)]);
      (guild.members.cache as Map<string, GuildMember>).set(botUser.id, botMember);

      const { interaction } = createMockInteraction({
        guild,
        targetUser: botUser,
        targetMember: botMember,
        duration: 10,
        reason: 'Testing bot target',
      });

      await execute(interaction as any);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❌ Cannot moderate bot accounts.',
        ephemeral: true,
      });
    });

    test('rejects server owner target timeout', async () => {
      const ownerId = 'server-owner-real-999';
      const guild = createMockGuild({ ownerId });
      const ownerUser = createMockUser({ id: ownerId });
      const ownerMember = createMockMember(ownerUser, [createMockRole('owner-role', 'OwnerRole', 99)]);
      (guild.members.cache as Map<string, GuildMember>).set(ownerId, ownerMember);

      const { interaction } = createMockInteraction({
        guild,
        targetUser: ownerUser,
        targetMember: ownerMember,
        duration: 10,
        reason: 'Attempting to timeout owner',
      });

      await execute(interaction as any);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❌ Cannot moderate the server owner.',
        ephemeral: true,
      });
    });

    test('rejects privileged staff member target timeout', async () => {
      const guild = createMockGuild();
      const staffUser = createMockUser({ id: 'staff-admin-1' });
      const staffMember = createMockMember(staffUser, [
        createMockRole('role-admin', 'Administrator', 25),
      ]);
      (guild.members.cache as Map<string, GuildMember>).set(staffUser.id, staffMember);

      const { interaction } = createMockInteraction({
        guild,
        callerRoles: [createMockRole('mod-role', 'Moderator', 30)],
        targetUser: staffUser,
        targetMember: staffMember,
        duration: 10,
        reason: 'Attempting to timeout admin',
      });

      await execute(interaction as any);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❌ Cannot moderate staff members with privileged roles.',
        ephemeral: true,
      });
    });

    test('rejects when target has equal or higher role than caller (caller hierarchy)', async () => {
      const guild = createMockGuild();
      const targetUser = createMockUser();
      // Target role position 30, caller role position 25
      const targetMember = createMockMember(targetUser, [
        createMockRole('senior-role', 'Senior Member', 30),
      ]);
      (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

      const { interaction } = createMockInteraction({
        guild,
        callerRoles: [createMockRole('mod-role', 'Moderator', 25)],
        targetUser,
        targetMember,
        duration: 10,
        reason: 'Rule break',
      });

      await execute(interaction as any);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❌ You cannot moderate a member with an equal or higher role than your highest role.',
        ephemeral: true,
      });
    });

    test('rejects when target has equal or higher role than bot (bot hierarchy)', async () => {
      // Bot position 20, caller position 35, target position 25 (target > bot)
      const guild = createMockGuild({ botRolePosition: 20 });
      const targetUser = createMockUser();
      const targetMember = createMockMember(targetUser, [
        createMockRole('target-role', 'Target Role', 25),
      ]);
      (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

      const { interaction } = createMockInteraction({
        guild,
        callerRoles: [createMockRole('mod-role', 'Moderator', 35)],
        targetUser,
        targetMember,
        duration: 10,
        reason: 'Rule break',
      });

      await execute(interaction as any);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❌ The bot cannot moderate a member with an equal or higher role than its highest role.',
        ephemeral: true,
      });
    });
  });

  // =========================================================================
  // 6. EXECUTION DISPATCH & AUDITING
  // =========================================================================
  describe('Execution Dispatch, Verification, and Auditing', () => {
    test('dispatches centralized runAction and calls member.timeout() with ms and reason', async () => {
      const runActionSpy = jest.spyOn(actionsModule, 'runAction');
      const guild = createMockGuild();
      const targetUser = createMockUser();
      const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);
      (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

      const { interaction } = createMockInteraction({
        guild,
        targetUser,
        targetMember,
        duration: 15,
        reason: 'Repeated spam violations',
      });

      await execute(interaction as any);

      // Centralized execution check
      expect(runActionSpy).toHaveBeenCalledTimes(1);
      expect(runActionSpy).toHaveBeenCalledWith(guild, {
        type: 'timeoutMember',
        payload: {
          memberId: targetMember.id,
          durationMinutes: 15,
          reason: 'Repeated spam violations',
        },
      });

      // Verification that member.timeout was called by runAction
      expect(targetMember.timeout).toHaveBeenCalledWith(
        15 * 60 * 1000,
        'Repeated spam violations'
      );

      runActionSpy.mockRestore();
    });

    test('detects post-action verification failure cleanly', async () => {
      const guild = createMockGuild();
      const targetUser = createMockUser();
      // Target member whose timeout() does not actually set disabled status
      const faultyMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)], {
        timeout: jest.fn().mockResolvedValue({}),
        communicationDisabledUntil: null,
        isCommunicationDisabled: jest.fn().mockReturnValue(false),
      });
      (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, faultyMember);

      const { interaction } = createMockInteraction({
        guild,
        targetUser,
        targetMember: faultyMember,
        duration: 10,
        reason: 'Test timeout',
      });

      await execute(interaction as any);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❌ Timeout verification failed: member does not have an active timeout.',
        ephemeral: true,
      });
    });

    test('sends structured audit log to #mod-logs when channel exists', async () => {
      const mockSend = jest.fn().mockResolvedValue({});
      const modLogsChannel = {
        id: 'chan-mod-logs',
        name: 'mod-logs',
        type: ChannelType.GuildText,
        send: mockSend,
      };

      const guild = createMockGuild({ channels: [modLogsChannel] });
      const targetUser = createMockUser();
      const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);
      (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

      const { interaction } = createMockInteraction({
        guild,
        targetUser,
        targetMember,
        duration: 30,
        reason: 'Toxic behavior in general chat',
      });

      await execute(interaction as any);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const sentPayload = mockSend.mock.calls[0][0];
      expect(sentPayload.embeds?.[0]?.data?.title).toBe('🛡️ Member Timed Out');
      expect(sentPayload.embeds?.[0]?.data?.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Duration', value: '30 minute(s)' }),
          expect.objectContaining({ name: 'Reason', value: 'Toxic behavior in general chat' }),
        ])
      );
    });

    test('succeeds without failure when #mod-logs is missing', async () => {
      // No channels provided -> no #mod-logs
      const guild = createMockGuild({ channels: [] });
      const targetUser = createMockUser();
      const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);
      (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

      const { interaction } = createMockInteraction({
        guild,
        targetUser,
        targetMember,
        duration: 10,
        reason: 'Harassment',
      });

      await execute(interaction as any);

      const replyData = interaction.getReplyData();
      expect(replyData.embeds?.[0]?.data?.title).toBe('⏳ Member Timed Out');
    });

    test('delivers structured response embed to caller', async () => {
      const guild = createMockGuild();
      const targetUser = createMockUser();
      const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);
      (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

      const { interaction } = createMockInteraction({
        guild,
        callerUser: { username: 'ActiveMod' },
        targetUser,
        targetMember,
        duration: 45,
        reason: 'Flooding chat',
      });

      await execute(interaction as any);

      const replyData = interaction.getReplyData();
      const embed = replyData.embeds?.[0]?.data;
      expect(embed).toBeDefined();
      expect(embed.title).toBe('⏳ Member Timed Out');
      expect(embed.footer?.text).toContain('ActiveMod');
      expect(embed.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Duration', value: '45 minute(s)' }),
          expect.objectContaining({ name: 'Reason', value: 'Flooding chat' }),
        ])
      );
    });
  });
});
