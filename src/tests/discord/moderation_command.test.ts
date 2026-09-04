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
import { data, execute, handleModerationButton } from '../../commands/moderation/mod';
import { loadCommands } from '../../commands/loader';
import * as actionsModule from '../../services/discord/actions';
import { _resetModConfirmationStore, getPendingModAction } from '../../services/discord/modConfirmation';

describe('Phase 4D.1 /mod timeout & Phase 4D.2 /mod kick Moderation Commands', () => {
  const mockNow = new Date('2026-09-04T12:00:00.000Z');

  function createMockRole(id: string, name: string, position: number): Role {
    return {
      id,
      name,
      position,
    } as unknown as Role;
  }

  function createMockUser(overrides: any = {}): User {
    const username = overrides.username || 'TargetUser';
    return {
      id: 'target-user-123',
      username,
      tag: overrides.tag || `${username}#0001`,
      displayName: overrides.displayName || username,
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
      kick: jest.fn().mockResolvedValue(undefined),
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
          if (perm === PermissionFlagsBits.KickMembers || perm === 'KickMembers') {
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
    subcommand?: string;
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
        getSubcommand: jest.fn().mockReturnValue(options.subcommand || 'timeout'),
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

  function createMockButtonInteraction(options: {
    customId: string;
    guild?: Guild | null;
    user?: any;
    member?: any;
  }) {
    let replyPayload: any = null;
    let updatePayload: any = null;
    let editReplyPayload: any = null;

    const user = {
      id: options.user?.id || 'mod-caller-1',
      username: options.user?.username || 'ModCaller',
      tag: options.user?.tag || 'ModCaller#0001',
      ...options.user,
    };

    const interaction: any = {
      customId: options.customId,
      guild: options.guild !== undefined ? options.guild : null,
      user,
      member: options.member || createMockMember(user, [createMockRole('mod-role', 'Moderator', 30)]),
      replied: false,
      deferred: false,
      reply: jest.fn().mockImplementation(async (p) => {
        replyPayload = p;
        interaction.replied = true;
      }),
      update: jest.fn().mockImplementation(async (p) => {
        updatePayload = p;
        interaction.replied = true;
      }),
      deferUpdate: jest.fn().mockImplementation(async () => {
        interaction.deferred = true;
      }),
      editReply: jest.fn().mockImplementation(async (p) => {
        editReplyPayload = p;
      }),
      getReplyData: () => replyPayload,
      getUpdateData: () => updatePayload || editReplyPayload,
      getEditReplyData: () => editReplyPayload,
    };

    return interaction;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    _resetModConfirmationStore();
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

    test('command defines "kick" subcommand with user and reason options', () => {
      const kickSub = data.options.find((opt: any) => opt.name === 'kick') as any;
      expect(kickSub).toBeDefined();

      const userOpt = kickSub.options.find((o: any) => o.name === 'user');
      const reasonOpt = kickSub.options.find((o: any) => o.name === 'reason');

      expect(userOpt?.required).toBe(true);
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

  // =========================================================================
  // PHASE 4D.2 /mod kick TESTS
  // =========================================================================
  describe('Phase 4D.2 /mod kick Command & Confirmation Workflow', () => {
    describe('Preconditions: DM & Bot Permissions', () => {
      test('rejects execution outside of a guild (DM rejection)', async () => {
        const { interaction } = createMockInteraction({
          guild: null,
          subcommand: 'kick',
          reason: 'Spamming',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: 'Command must be used in a guild.',
          ephemeral: true,
        });
      });

      test('rejects execution when bot lacks KickMembers permission', async () => {
        const guild = createMockGuild({ botHasPermission: false });
        const targetUser = createMockUser();
        const targetMember = createMockMember(targetUser);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'kick',
          targetUser,
          targetMember,
          reason: 'Spamming',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ Bot lacks the "Kick Members" permission.',
          ephemeral: true,
        });
      });
    });

    describe('Authorization & Policy Enforcement', () => {
      test('rejects unauthorized requester without Category.MODERATE role', async () => {
        const guild = createMockGuild();
        const targetUser = createMockUser();
        const targetMember = createMockMember(targetUser);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'kick',
          callerRoles: [createMockRole('regular-role', 'Member', 5)],
          targetUser,
          targetMember,
          reason: 'Trolling',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ You are not authorized to use moderation commands.',
          ephemeral: true,
        });
      });
    });

    describe('Option Validation', () => {
      test('rejects empty or whitespace-only reason', async () => {
        const guild = createMockGuild();
        const targetUser = createMockUser();
        const targetMember = createMockMember(targetUser);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'kick',
          targetUser,
          targetMember,
          reason: '   ',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ A valid reason must be provided for the kick.',
          ephemeral: true,
        });
      });

      test('rejects reason exceeding 512 characters', async () => {
        const guild = createMockGuild();
        const targetUser = createMockUser();
        const targetMember = createMockMember(targetUser);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'kick',
          targetUser,
          targetMember,
          reason: 'A'.repeat(513),
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ Kick reason cannot exceed 512 characters.',
          ephemeral: true,
        });
      });
    });

    describe('Target Safety & Hierarchy Checks', () => {
      test('rejects kicking oneself', async () => {
        const guild = createMockGuild();
        const callerUser = { id: 'self-mod-1', username: 'SelfMod' };
        const selfMember = createMockMember(callerUser as any, [
          createMockRole('mod-role', 'Moderator', 30),
        ]);
        (guild.members.cache as Map<string, GuildMember>).set(callerUser.id, selfMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'kick',
          callerUser,
          targetUser: callerUser as any,
          targetMember: selfMember,
          reason: 'Self kick attempt',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ You cannot moderate yourself.',
          ephemeral: true,
        });
      });

      test('rejects kicking a bot account', async () => {
        const guild = createMockGuild();
        const targetUser = createMockUser({ bot: true });
        const targetMember = createMockMember(targetUser);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'kick',
          targetUser,
          targetMember,
          reason: 'Bot kick attempt',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ Cannot moderate bot accounts.',
          ephemeral: true,
        });
      });

      test('rejects kicking the server owner', async () => {
        const guild = createMockGuild({ ownerId: 'guild-owner-777' });
        const targetUser = createMockUser({ id: 'guild-owner-777' });
        const targetMember = createMockMember(targetUser);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'kick',
          targetUser,
          targetMember,
          reason: 'Owner kick attempt',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ Cannot moderate the server owner.',
          ephemeral: true,
        });
      });

      test('rejects kicking staff members with privileged roles', async () => {
        const guild = createMockGuild();
        const targetUser = createMockUser({ id: 'staff-user-1' });
        const targetMember = createMockMember(targetUser, [
          createMockRole('team-kosmo', 'Team Kosmo', 40),
        ]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'kick',
          targetUser,
          targetMember,
          reason: 'Staff kick attempt',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ Cannot moderate staff members with privileged roles.',
          ephemeral: true,
        });
      });

      test('rejects kicking member with role equal or higher than caller', async () => {
        const guild = createMockGuild();
        const targetUser = createMockUser({ id: 'equal-target-1' });
        const targetMember = createMockMember(targetUser, [
          createMockRole('veteran-role', 'Veteran', 30), // same position as mod
        ]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'kick',
          callerRoles: [createMockRole('mod-role', 'Moderator', 30)],
          targetUser,
          targetMember,
          reason: 'Equal role attempt',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ You cannot moderate a member with an equal or higher role than your highest role.',
          ephemeral: true,
        });
      });

      test('rejects kicking member with role equal or higher than bot', async () => {
        const guild = createMockGuild({ botRolePosition: 20 });
        const targetUser = createMockUser({ id: 'above-bot-target-1' });
        const targetMember = createMockMember(targetUser, [
          createMockRole('high-role', 'HighRole', 25), // above bot (20), below caller (35)
        ]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'kick',
          callerRoles: [createMockRole('admin-role', 'Administrator', 35)],
          targetUser,
          targetMember,
          reason: 'Above bot attempt',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ The bot cannot moderate a member with an equal or higher role than its highest role.',
          ephemeral: true,
        });
      });

      test('rejects kicking non-existent target member', async () => {
        const guild = createMockGuild();
        const targetUser = createMockUser({ id: 'ghost-user-999' });

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'kick',
          targetUser,
          targetMember: null,
          reason: 'Ghost user kick',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ Member could not be found in this server.',
          ephemeral: true,
        });
      });
    });

    describe('Interactive Proposal Workflow (No Immediate Mutation)', () => {
      test('creates pending action and sends confirmation components without kicking', async () => {
        const guild = createMockGuild();
        const targetUser = createMockUser({ id: 'target-to-kick-1', username: 'BadActor' });
        const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const runActionSpy = jest.spyOn(actionsModule, 'runAction');

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'kick',
          targetUser,
          targetMember,
          reason: 'Severe spamming',
        });

        await execute(interaction as any);

        // Verification: runAction was NOT called yet!
        expect(runActionSpy).not.toHaveBeenCalled();
        expect(targetMember.kick).not.toHaveBeenCalled();

        // Verification: Reply contains confirmation embed and buttons
        const replyData = interaction.getReplyData();
        expect(replyData.embeds).toBeDefined();
        const embed = replyData.embeds[0].data;
        expect(embed.title).toBe('⚠️ CONFIRM MEMBER KICK');
        expect(embed.description).toContain('BadActor');

        expect(replyData.components).toBeDefined();
        const actionRow = replyData.components[0];
        expect(actionRow.components.length).toBe(2);
        expect(actionRow.components[0].data.label).toBe('Confirm Kick');
        expect(actionRow.components[1].data.label).toBe('Cancel');

        const confirmCustomId = actionRow.components[0].data.custom_id;
        expect(confirmCustomId).toMatch(/^mod_kick_confirm_/);

        const actionId = confirmCustomId.replace('mod_kick_confirm_', '');
        const stored = getPendingModAction(actionId);
        expect(stored).toBeDefined();
        expect(stored?.status).toBe('PENDING');
        expect(stored?.reason).toBe('Severe spamming');
        expect(stored?.targetId).toBe(targetUser.id);
      });
    });

    describe('Confirmation Button Click Handling', () => {
      test('rejects button click outside a guild', async () => {
        const buttonInteraction = createMockButtonInteraction({
          customId: 'mod_kick_confirm_test-id',
          guild: null,
        });

        await handleModerationButton(buttonInteraction as any);

        expect(buttonInteraction.reply).toHaveBeenCalledWith({
          content: '❌ Moderation confirmation can only be performed within a server.',
          ephemeral: true,
        });
      });

      test('rejects button click for non-existent or expired action', async () => {
        const guild = createMockGuild();
        const buttonInteraction = createMockButtonInteraction({
          customId: 'mod_kick_confirm_non-existent-action',
          guild,
        });

        await handleModerationButton(buttonInteraction as any);

        expect(buttonInteraction.reply).toHaveBeenCalledWith({
          content: '❌ Moderation action not found or expired.',
          ephemeral: true,
        });
      });

      test('rejects confirmation from a user other than the initiating moderator', async () => {
        const guild = createMockGuild();
        const targetUser = createMockUser({ id: 'target-1' });
        const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        // Initiated by mod-caller-1
        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'kick',
          targetUser,
          targetMember,
          reason: 'Rule violation',
        });
        await execute(interaction as any);

        const actionRow = interaction.getReplyData().components[0];
        const confirmCustomId = actionRow.components[0].data.custom_id;

        // Clicked by a different user (other-mod)
        const imposterInteraction = createMockButtonInteraction({
          customId: confirmCustomId,
          guild,
          user: { id: 'other-mod-99', username: 'OtherMod' },
        });

        await handleModerationButton(imposterInteraction as any);

        expect(imposterInteraction.reply).toHaveBeenCalledWith({
          content: '❌ Only the moderator who initiated this action can confirm or cancel it.',
          ephemeral: true,
        });
      });

      test('rejects confirmation if moderator lost Category.MODERATE authorization', async () => {
        const guild = createMockGuild();
        const targetUser = createMockUser({ id: 'target-2' });
        const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'kick',
          targetUser,
          targetMember,
          reason: 'Rule violation',
        });
        await execute(interaction as any);

        const confirmCustomId = interaction.getReplyData().components[0].components[0].data.custom_id;

        // Moderator stripped of roles in the meantime
        const demotedModerator = createMockMember(
          { id: 'mod-caller-1', username: 'ModCaller' } as any,
          [createMockRole('regular-member', 'Member', 5)]
        );

        const demotedInteraction = createMockButtonInteraction({
          customId: confirmCustomId,
          guild,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
          member: demotedModerator,
        });

        await handleModerationButton(demotedInteraction as any);

        expect(demotedInteraction.reply).toHaveBeenCalledWith({
          content: '❌ You are no longer authorized to execute moderation commands.',
          ephemeral: true,
        });
      });

      test('aborts kick if target member left server before confirmation', async () => {
        const guild = createMockGuild();
        const targetUser = createMockUser({ id: 'target-leaving' });
        const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'kick',
          targetUser,
          targetMember,
          reason: 'Leaving soon',
        });
        await execute(interaction as any);

        const confirmCustomId = interaction.getReplyData().components[0].components[0].data.custom_id;

        // Target leaves server before confirmation
        (guild.members.cache as Map<string, GuildMember>).delete(targetUser.id);

        const buttonInteraction = createMockButtonInteraction({
          customId: confirmCustomId,
          guild,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });

        await handleModerationButton(buttonInteraction as any);

        const updateData = buttonInteraction.getUpdateData();
        expect(updateData.embeds[0].data.title).toBe('❌ KICK ABORTED');
        expect(updateData.embeds[0].data.description).toContain('no longer in this server');
        expect(updateData.components).toEqual([]);
      });

      test('aborts kick if target safety fails at confirmation time (e.g. promoted to staff)', async () => {
        const guild = createMockGuild();
        const targetUser = createMockUser({ id: 'target-promoted' });
        const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'kick',
          targetUser,
          targetMember,
          reason: 'Pre-promotion offense',
        });
        await execute(interaction as any);

        const confirmCustomId = interaction.getReplyData().components[0].components[0].data.custom_id;

        // Target is promoted to Moderator before confirmation is clicked
        targetMember.roles.cache.set('mod-role', createMockRole('mod-role', 'Moderator', 30));

        const buttonInteraction = createMockButtonInteraction({
          customId: confirmCustomId,
          guild,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });

        await handleModerationButton(buttonInteraction as any);

        const updateData = buttonInteraction.getUpdateData();
        expect(updateData.embeds[0].data.title).toBe('❌ KICK ABORTED');
        expect(updateData.embeds[0].data.description).toContain('Target safety validation failed');
        expect(updateData.components).toEqual([]);
      });

      test('successful kick: executes through actions.ts, verifies absence, logs to #mod-logs, and marks EXECUTED', async () => {
        const modLogsChannel: any = {
          id: 'mod-logs-chan',
          name: 'mod-logs',
          type: ChannelType.GuildText,
          send: jest.fn().mockResolvedValue(undefined),
        };

        const guild = createMockGuild({ channels: [modLogsChannel] });
        const targetUser = createMockUser({ id: 'confirmed-kick-target', username: 'BadUser' });
        const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        // When kicked, remove from guild cache so absence check succeeds
        targetMember.kick = jest.fn().mockImplementation(async () => {
          (guild.members.cache as Map<string, GuildMember>).delete(targetUser.id);
        });

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'kick',
          targetUser,
          targetMember,
          reason: 'Confirmed misconduct',
        });
        await execute(interaction as any);

        const confirmCustomId = interaction.getReplyData().components[0].components[0].data.custom_id;
        const actionId = confirmCustomId.replace('mod_kick_confirm_', '');

        const buttonInteraction = createMockButtonInteraction({
          customId: confirmCustomId,
          guild,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });

        await handleModerationButton(buttonInteraction as any);

        // Verify kick execution
        expect(targetMember.kick).toHaveBeenCalledWith('Confirmed misconduct');

        // Verify #mod-logs received embed
        expect(modLogsChannel.send).toHaveBeenCalledTimes(1);
        const logEmbed = modLogsChannel.send.mock.calls[0][0].embeds[0].data;
        expect(logEmbed.title).toBe('🛡️ Member Kicked');
        expect(logEmbed.fields).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: 'Action', value: '`KICK`' }),
            expect.objectContaining({ name: 'Reason', value: 'Confirmed misconduct' }),
          ])
        );

        // Verify message update to caller
        const updateData = buttonInteraction.getUpdateData();
        expect(updateData.embeds[0].data.title).toBe('👢 Member Kicked');
        expect(updateData.embeds[0].data.description).toContain('Successfully kicked');
        expect(updateData.components).toEqual([]);

        // Invariant: action is marked EXECUTED
        const completedAction = getPendingModAction(actionId);
        expect(completedAction?.status).toBe('EXECUTED');
      });

      test('reports unverified if target is still present after kick API call', async () => {
        const guild = createMockGuild();
        const targetUser = createMockUser({ id: 'stubborn-target', username: 'StillHere' });
        const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        // Mock kick that does NOT remove member (simulating API failure or ghost member)
        targetMember.kick = jest.fn().mockResolvedValue(undefined);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'kick',
          targetUser,
          targetMember,
          reason: 'Testing unverified',
        });
        await execute(interaction as any);

        const confirmCustomId = interaction.getReplyData().components[0].components[0].data.custom_id;
        const actionId = confirmCustomId.replace('mod_kick_confirm_', '');

        const buttonInteraction = createMockButtonInteraction({
          customId: confirmCustomId,
          guild,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });

        await handleModerationButton(buttonInteraction as any);

        const updateData = buttonInteraction.getUpdateData();
        expect(updateData.embeds[0].data.title).toBe('❌ KICK UNVERIFIED');
        expect(updateData.embeds[0].data.description).toContain('still detected in the server');

        // Action must NOT be EXECUTED
        const action = getPendingModAction(actionId);
        expect(action?.status).not.toBe('EXECUTED');
      });

      test('replay protection: cannot confirm already processed action', async () => {
        const guild = createMockGuild();
        const targetUser = createMockUser({ id: 'target-replay' });
        const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        targetMember.kick = jest.fn().mockImplementation(async () => {
          (guild.members.cache as Map<string, GuildMember>).delete(targetUser.id);
        });

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'kick',
          targetUser,
          targetMember,
          reason: 'Replay test',
        });
        await execute(interaction as any);

        const confirmCustomId = interaction.getReplyData().components[0].components[0].data.custom_id;

        const firstClick = createMockButtonInteraction({
          customId: confirmCustomId,
          guild,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });
        await handleModerationButton(firstClick as any);

        // Second click on the same button
        const secondClick = createMockButtonInteraction({
          customId: confirmCustomId,
          guild,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });
        await handleModerationButton(secondClick as any);

        expect(secondClick.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringMatching(/already been executed/i),
            ephemeral: true,
          })
        );
      });
    });

    describe('Cancellation Workflow', () => {
      test('cancels action when moderator clicks Cancel', async () => {
        const guild = createMockGuild();
        const targetUser = createMockUser({ id: 'target-to-cancel', username: 'SafeMember' });
        const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'kick',
          targetUser,
          targetMember,
          reason: 'Accidental kick',
        });
        await execute(interaction as any);

        const cancelCustomId = interaction.getReplyData().components[0].components[1].data.custom_id;
        const actionId = cancelCustomId.replace('mod_kick_cancel_', '');

        const buttonInteraction = createMockButtonInteraction({
          customId: cancelCustomId,
          guild,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });

        await handleModerationButton(buttonInteraction as any);

        expect(targetMember.kick).not.toHaveBeenCalled();

        const updateData = buttonInteraction.getUpdateData();
        expect(updateData.embeds[0].data.title).toBe('🚫 KICK CANCELLED');
        expect(updateData.embeds[0].data.description).toContain('SafeMember');
        expect(updateData.components).toEqual([]);

        const action = getPendingModAction(actionId);
        expect(action?.status).toBe('CANCELLED');
      });
    });
  });
});
