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
      ban: jest.fn().mockResolvedValue(undefined),
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
          if (perm === PermissionFlagsBits.BanMembers || perm === 'BanMembers') {
            return botPerm;
          }
          if (perm === PermissionFlagsBits.ManageMessages || perm === 'ManageMessages') {
            return botPerm;
          }
          return false;
        }),
      },
    };

    const channelsMap = new Collection<string, any>();
    const defaultChannel: any = {
      id: 'chan-mod-1',
      name: 'general',
      type: ChannelType.GuildText,
      bulkDelete: jest.fn().mockResolvedValue(new Collection()),
      permissionsFor: jest.fn().mockReturnValue({
        has: jest.fn().mockImplementation((perm) => {
          if (perm === PermissionFlagsBits.ManageMessages || perm === 'ManageMessages') {
            return botPerm;
          }
          return true;
        }),
      }),
    };
    channelsMap.set(defaultChannel.id, defaultChannel);
    (options.channels || []).forEach((c) => channelsMap.set(c.id, c));

    const membersStore = new Map<string, GuildMember>();
    const bansStore = new Map<string, any>();

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
      bans: {
        cache: bansStore,
        fetch: jest.fn().mockImplementation(async (arg: any) => {
          const id = typeof arg === 'string' ? arg : arg?.user;
          const found = bansStore.get(id);
          if (found) return found;
          throw new Error(`Ban "${id}" not found.`);
        }),
      },
      channels: {
        cache: channelsMap,
        fetch: jest.fn().mockImplementation(async (arg: any) => {
          const id = typeof arg === 'string' ? arg : arg?.id;
          const found = channelsMap.get(id);
          if (found) return found;
          throw new Error(`Channel "${id}" not found.`);
        }),
      },
    };

    return guild as unknown as Guild;
  }

  function createMockInteraction(options: {
    guild?: Guild | null;
    channel?: any;
    channelId?: string;
    callerUser?: any;
    callerRoles?: Role[];
    targetUser?: User;
    targetMember?: GuildMember | null;
    duration?: any;
    amount?: any;
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

    const channelId = options.channelId || 'chan-mod-1';
    const channel = options.channel !== undefined
      ? options.channel
      : (options.guild?.channels?.cache?.get(channelId) || {
          id: channelId,
          name: 'general',
          type: ChannelType.GuildText,
          bulkDelete: jest.fn().mockResolvedValue(new Collection()),
          permissionsFor: jest.fn().mockReturnValue({
            has: jest.fn().mockReturnValue(true),
          }),
        });

    const interaction: any = {
      guild: options.guild !== undefined ? options.guild : null,
      channelId,
      channel,
      user: callerUser,
      member: callerMember,
      replied: false,
      deferred: false,
      options: {
        getSubcommand: jest.fn().mockReturnValue(options.subcommand || 'timeout'),
        getUser: jest.fn().mockReturnValue(options.targetUser),
        getMember: jest.fn().mockReturnValue(options.targetMember ?? null),
        getInteger: jest.fn().mockImplementation((name?: string) => {
          if (name === 'amount') return options.amount;
          return options.duration;
        }),
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
    channelId?: string;
    channel?: any;
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

    const channelId = options.channelId || 'chan-mod-1';
    const channel = options.channel !== undefined
      ? options.channel
      : (options.guild?.channels?.cache?.get(channelId) || {
          id: channelId,
          name: 'general',
          type: ChannelType.GuildText,
          bulkDelete: jest.fn().mockResolvedValue(new Collection()),
          permissionsFor: jest.fn().mockReturnValue({
            has: jest.fn().mockReturnValue(true),
          }),
        });

    const interaction: any = {
      customId: options.customId,
      guild: options.guild !== undefined ? options.guild : null,
      channelId,
      channel,
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

    test('command defines "ban" subcommand with user and reason options', () => {
      const banSub = data.options.find((opt: any) => opt.name === 'ban') as any;
      expect(banSub).toBeDefined();

      const userOpt = banSub.options.find((o: any) => o.name === 'user');
      const reasonOpt = banSub.options.find((o: any) => o.name === 'reason');

      expect(userOpt?.required).toBe(true);
      expect(reasonOpt?.required).toBe(true);
    });

    test('command defines "purge" subcommand with amount and reason options', () => {
      const purgeSub = data.options.find((opt: any) => opt.name === 'purge') as any;
      expect(purgeSub).toBeDefined();

      const amountOpt = purgeSub.options.find((o: any) => o.name === 'amount');
      const reasonOpt = purgeSub.options.find((o: any) => o.name === 'reason');

      expect(amountOpt?.required).toBe(true);
      expect(amountOpt?.min_value).toBe(1);
      expect(amountOpt?.max_value).toBe(100);
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

  // =========================================================================
  // PHASE 4D.3A /mod ban TESTS
  // =========================================================================
  describe('Phase 4D.3A /mod ban Command & Confirmation Workflow', () => {
    describe('Preconditions: DM & Bot Permissions', () => {
      test('rejects execution outside of a guild (DM rejection)', async () => {
        const { interaction } = createMockInteraction({
          guild: null,
          subcommand: 'ban',
          reason: 'Spamming',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: 'Command must be used in a guild.',
          ephemeral: true,
        });
      });

      test('rejects execution when bot lacks BanMembers permission', async () => {
        const guild = createMockGuild({ botHasPermission: false });
        const targetUser = createMockUser();
        const targetMember = createMockMember(targetUser);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'ban',
          targetUser,
          targetMember,
          reason: 'Spamming',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ Bot lacks the "Ban Members" permission.',
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
          subcommand: 'ban',
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
          subcommand: 'ban',
          targetUser,
          targetMember,
          reason: '   ',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ A valid reason must be provided for the ban.',
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
          subcommand: 'ban',
          targetUser,
          targetMember,
          reason: 'A'.repeat(513),
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ Ban reason cannot exceed 512 characters.',
          ephemeral: true,
        });
      });
    });

    describe('Target Safety & Hierarchy Checks', () => {
      test('rejects banning oneself', async () => {
        const guild = createMockGuild();
        const callerUser = { id: 'self-ban-mod-1', username: 'SelfBanMod' };
        const selfMember = createMockMember(callerUser as any, [
          createMockRole('mod-role', 'Moderator', 30),
        ]);
        (guild.members.cache as Map<string, GuildMember>).set(callerUser.id, selfMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'ban',
          callerUser,
          targetUser: callerUser as any,
          targetMember: selfMember,
          reason: 'Self ban attempt',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ You cannot moderate yourself.',
          ephemeral: true,
        });
      });

      test('rejects banning a bot account', async () => {
        const guild = createMockGuild();
        const targetUser = createMockUser({ bot: true });
        const targetMember = createMockMember(targetUser);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'ban',
          targetUser,
          targetMember,
          reason: 'Bot ban attempt',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ Cannot moderate bot accounts.',
          ephemeral: true,
        });
      });

      test('rejects banning the server owner', async () => {
        const guild = createMockGuild({ ownerId: 'guild-owner-ban-777' });
        const targetUser = createMockUser({ id: 'guild-owner-ban-777' });
        const targetMember = createMockMember(targetUser);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'ban',
          targetUser,
          targetMember,
          reason: 'Owner ban attempt',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ Cannot moderate the server owner.',
          ephemeral: true,
        });
      });

      test('rejects banning staff members with privileged roles', async () => {
        const guild = createMockGuild();
        const targetUser = createMockUser({ id: 'staff-ban-user-1' });
        const targetMember = createMockMember(targetUser, [
          createMockRole('team-kosmo', 'Team Kosmo', 40),
        ]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'ban',
          targetUser,
          targetMember,
          reason: 'Staff ban attempt',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ Cannot moderate staff members with privileged roles.',
          ephemeral: true,
        });
      });

      test('rejects banning member with role equal or higher than caller', async () => {
        const guild = createMockGuild();
        const targetUser = createMockUser({ id: 'equal-ban-target-1' });
        const targetMember = createMockMember(targetUser, [
          createMockRole('veteran-role', 'Veteran', 30),
        ]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'ban',
          callerRoles: [createMockRole('mod-role', 'Moderator', 30)],
          targetUser,
          targetMember,
          reason: 'Equal role ban attempt',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ You cannot moderate a member with an equal or higher role than your highest role.',
          ephemeral: true,
        });
      });

      test('rejects banning member with role equal or higher than bot', async () => {
        const guild = createMockGuild({ botRolePosition: 20 });
        const targetUser = createMockUser({ id: 'above-bot-ban-target-1' });
        const targetMember = createMockMember(targetUser, [
          createMockRole('high-role', 'HighRole', 25),
        ]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'ban',
          callerRoles: [createMockRole('admin-role', 'Administrator', 35)],
          targetUser,
          targetMember,
          reason: 'Above bot ban attempt',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ The bot cannot moderate a member with an equal or higher role than its highest role.',
          ephemeral: true,
        });
      });

      test('rejects banning non-existent target member', async () => {
        const guild = createMockGuild();
        const targetUser = createMockUser({ id: 'ghost-ban-user-999' });

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'ban',
          targetUser,
          targetMember: null,
          reason: 'Ghost user ban',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ Member could not be found in this server.',
          ephemeral: true,
        });
      });
    });

    describe('Interactive Proposal Workflow (No Immediate Mutation)', () => {
      test('creates pending action and sends confirmation components without banning', async () => {
        const guild = createMockGuild();
        const targetUser = createMockUser({ id: 'target-to-ban-1', username: 'Griefer' });
        const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const runActionSpy = jest.spyOn(actionsModule, 'runAction');

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'ban',
          targetUser,
          targetMember,
          reason: 'Severe server griefing',
        });

        await execute(interaction as any);

        // Verification: runAction was NOT called yet!
        expect(runActionSpy).not.toHaveBeenCalled();
        expect(targetMember.ban).not.toHaveBeenCalled();

        // Verification: Reply contains confirmation embed and buttons
        const replyData = interaction.getReplyData();
        expect(replyData.embeds).toBeDefined();
        const embed = replyData.embeds[0].data;
        expect(embed.title).toBe('⚠️ CONFIRM MEMBER BAN');
        expect(embed.description).toContain('Griefer');

        expect(replyData.components).toBeDefined();
        const actionRow = replyData.components[0];
        expect(actionRow.components.length).toBe(2);
        expect(actionRow.components[0].data.label).toBe('Confirm Ban');
        expect(actionRow.components[1].data.label).toBe('Cancel');

        const confirmCustomId = actionRow.components[0].data.custom_id;
        expect(confirmCustomId).toMatch(/^mod_ban_confirm_/);

        const cancelCustomId = actionRow.components[1].data.custom_id;
        expect(cancelCustomId).toMatch(/^mod_ban_cancel_/);

        const actionId = confirmCustomId.replace('mod_ban_confirm_', '');
        const stored = getPendingModAction(actionId);
        expect(stored).toBeDefined();
        expect(stored?.status).toBe('PENDING');
        expect(stored?.actionType).toBe('BAN');
        expect(stored?.reason).toBe('Severe server griefing');
        expect(stored?.targetId).toBe(targetUser.id);
        expect(stored?.guildId).toBe(guild.id);
        expect(stored?.moderatorId).toBe('mod-caller-1');
        expect(stored?.expiresAt.getTime()).toBeGreaterThan(Date.now());
      });
    });

    describe('Confirmation Button Click Handling', () => {
      test('rejects button click outside a guild', async () => {
        const buttonInteraction = createMockButtonInteraction({
          customId: 'mod_ban_confirm_test-id',
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
          customId: 'mod_ban_confirm_non-existent-action',
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
        const targetUser = createMockUser({ id: 'target-ban-diff-user' });
        const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'ban',
          targetUser,
          targetMember,
          reason: 'Griefing',
        });
        await execute(interaction as any);

        const actionRow = interaction.getReplyData().components[0];
        const confirmCustomId = actionRow.components[0].data.custom_id;

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
        const targetUser = createMockUser({ id: 'target-ban-demote' });
        const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'ban',
          targetUser,
          targetMember,
          reason: 'Rule violation',
        });
        await execute(interaction as any);

        const confirmCustomId = interaction.getReplyData().components[0].components[0].data.custom_id;

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

      test('rejects confirmation if bot lacks BanMembers permission', async () => {
        const guild = createMockGuild();
        const targetUser = createMockUser({ id: 'target-ban-no-bot-perm' });
        const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'ban',
          targetUser,
          targetMember,
          reason: 'Rule violation',
        });
        await execute(interaction as any);

        const confirmCustomId = interaction.getReplyData().components[0].components[0].data.custom_id;

        // Bot loses BanMembers permission
        (guild.members.me as any).permissions.has = jest.fn().mockReturnValue(false);

        const buttonInteraction = createMockButtonInteraction({
          customId: confirmCustomId,
          guild,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });

        await handleModerationButton(buttonInteraction as any);

        expect(buttonInteraction.reply).toHaveBeenCalledWith({
          content: '❌ Bot lacks the "Ban Members" permission.',
          ephemeral: true,
        });
      });

      test('aborts ban if target member left server before confirmation', async () => {
        const guild = createMockGuild();
        const targetUser = createMockUser({ id: 'target-ban-leaving' });
        const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'ban',
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
        expect(updateData.embeds[0].data.title).toBe('❌ BAN ABORTED');
        expect(updateData.embeds[0].data.description).toContain('no longer in this server');
        expect(updateData.components).toEqual([]);
      });

      test('aborts ban if target safety fails at confirmation time (e.g. promoted to staff)', async () => {
        const guild = createMockGuild();
        const targetUser = createMockUser({ id: 'target-ban-promoted' });
        const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'ban',
          targetUser,
          targetMember,
          reason: 'Pre-promotion offense',
        });
        await execute(interaction as any);

        const confirmCustomId = interaction.getReplyData().components[0].components[0].data.custom_id;

        // Target promoted to Moderator before confirmation is clicked
        targetMember.roles.cache.set('mod-role', createMockRole('mod-role', 'Moderator', 30));

        const buttonInteraction = createMockButtonInteraction({
          customId: confirmCustomId,
          guild,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });

        await handleModerationButton(buttonInteraction as any);

        const updateData = buttonInteraction.getUpdateData();
        expect(updateData.embeds[0].data.title).toBe('❌ BAN ABORTED');
        expect(updateData.embeds[0].data.description).toContain('Target safety validation failed');
        expect(updateData.components).toEqual([]);
      });

      test('successful ban: executes through actions.ts:runAction(), verifies ban, logs to #mod-logs, and marks EXECUTED', async () => {
        const modLogsChannel: any = {
          id: 'mod-logs-chan',
          name: 'mod-logs',
          type: ChannelType.GuildText,
          send: jest.fn().mockResolvedValue(undefined),
        };

        const guild = createMockGuild({ channels: [modLogsChannel] });
        const targetUser = createMockUser({ id: 'confirmed-ban-target', username: 'PermBanned' });
        const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        // When ban is called, update bans and members store so verification succeeds
        targetMember.ban = jest.fn().mockImplementation(async (opts?: any) => {
          (guild.bans as any).cache.set(targetUser.id, { user: targetUser, reason: opts?.reason });
          (guild.members.cache as Map<string, GuildMember>).delete(targetUser.id);
        });

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'ban',
          targetUser,
          targetMember,
          reason: 'Severe persistent violations',
        });
        await execute(interaction as any);

        const confirmCustomId = interaction.getReplyData().components[0].components[0].data.custom_id;
        const actionId = confirmCustomId.replace('mod_ban_confirm_', '');

        const buttonInteraction = createMockButtonInteraction({
          customId: confirmCustomId,
          guild,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });

        await handleModerationButton(buttonInteraction as any);

        // Verify ban execution
        expect(targetMember.ban).toHaveBeenCalledWith({ reason: 'Severe persistent violations' });

        // Verify #mod-logs received embed
        expect(modLogsChannel.send).toHaveBeenCalledTimes(1);
        const logEmbed = modLogsChannel.send.mock.calls[0][0].embeds[0].data;
        expect(logEmbed.title).toBe('🛡️ Member Banned');
        expect(logEmbed.fields).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: 'Action', value: '`BAN`' }),
            expect.objectContaining({ name: 'Reason', value: 'Severe persistent violations' }),
          ])
        );

        // Verify message update to caller
        const updateData = buttonInteraction.getUpdateData();
        expect(updateData.embeds[0].data.title).toBe('🔨 Member Banned');
        expect(updateData.embeds[0].data.description).toContain('Successfully banned');
        expect(updateData.components).toEqual([]);

        // Invariant: action is marked EXECUTED
        const completedAction = getPendingModAction(actionId);
        expect(completedAction?.status).toBe('EXECUTED');
      });

      test('reports unverified if target is still present and ban entry missing after ban API call', async () => {
        const guild = createMockGuild();
        const targetUser = createMockUser({ id: 'ghost-ban-target', username: 'StillPresent' });
        const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        // Mock ban that fails to record ban or remove member
        targetMember.ban = jest.fn().mockResolvedValue(undefined);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'ban',
          targetUser,
          targetMember,
          reason: 'Testing unverified ban',
        });
        await execute(interaction as any);

        const confirmCustomId = interaction.getReplyData().components[0].components[0].data.custom_id;
        const actionId = confirmCustomId.replace('mod_ban_confirm_', '');

        const buttonInteraction = createMockButtonInteraction({
          customId: confirmCustomId,
          guild,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });

        await handleModerationButton(buttonInteraction as any);

        const updateData = buttonInteraction.getUpdateData();
        expect(updateData.embeds[0].data.title).toBe('❌ BAN UNVERIFIED');
        expect(updateData.embeds[0].data.description).toContain('could not be verified as banned');

        // Action must NOT be EXECUTED
        const action = getPendingModAction(actionId);
        expect(action?.status).not.toBe('EXECUTED');
      });

      test('moderation still succeeds when #mod-logs channel is absent', async () => {
        const guild = createMockGuild({ channels: [] });
        const targetUser = createMockUser({ id: 'ban-no-log-target', username: 'NoLog' });
        const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        targetMember.ban = jest.fn().mockImplementation(async () => {
          (guild.members.cache as Map<string, GuildMember>).delete(targetUser.id);
        });

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'ban',
          targetUser,
          targetMember,
          reason: 'No log channel test',
        });
        await execute(interaction as any);

        const confirmCustomId = interaction.getReplyData().components[0].components[0].data.custom_id;
        const actionId = confirmCustomId.replace('mod_ban_confirm_', '');

        const buttonInteraction = createMockButtonInteraction({
          customId: confirmCustomId,
          guild,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });

        await handleModerationButton(buttonInteraction as any);

        const updateData = buttonInteraction.getUpdateData();
        expect(updateData.embeds[0].data.title).toBe('🔨 Member Banned');
        const completedAction = getPendingModAction(actionId);
        expect(completedAction?.status).toBe('EXECUTED');
      });

      test('replay protection: cannot confirm already processed action', async () => {
        const guild = createMockGuild();
        const targetUser = createMockUser({ id: 'target-ban-replay' });
        const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        targetMember.ban = jest.fn().mockImplementation(async () => {
          (guild.members.cache as Map<string, GuildMember>).delete(targetUser.id);
        });

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'ban',
          targetUser,
          targetMember,
          reason: 'Ban replay test',
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
        const targetUser = createMockUser({ id: 'target-to-cancel-ban', username: 'SparedMember' });
        const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'ban',
          targetUser,
          targetMember,
          reason: 'Accidental ban proposal',
        });
        await execute(interaction as any);

        const cancelCustomId = interaction.getReplyData().components[0].components[1].data.custom_id;
        const actionId = cancelCustomId.replace('mod_ban_cancel_', '');

        const buttonInteraction = createMockButtonInteraction({
          customId: cancelCustomId,
          guild,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });

        await handleModerationButton(buttonInteraction as any);

        expect(targetMember.ban).not.toHaveBeenCalled();

        const updateData = buttonInteraction.getUpdateData();
        expect(updateData.embeds[0].data.title).toBe('🚫 BAN CANCELLED');
        expect(updateData.embeds[0].data.description).toContain('SparedMember');
        expect(updateData.components).toEqual([]);

        const action = getPendingModAction(actionId);
        expect(action?.status).toBe('CANCELLED');
      });

      test('cancelled confirmation cannot be executed', async () => {
        const guild = createMockGuild();
        const targetUser = createMockUser({ id: 'target-cancelled-exec' });
        const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);
        (guild.members.cache as Map<string, GuildMember>).set(targetUser.id, targetMember);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'ban',
          targetUser,
          targetMember,
          reason: 'Cancel then confirm attempt',
        });
        await execute(interaction as any);

        const confirmCustomId = interaction.getReplyData().components[0].components[0].data.custom_id;
        const cancelCustomId = interaction.getReplyData().components[0].components[1].data.custom_id;

        // First click Cancel
        const cancelClick = createMockButtonInteraction({
          customId: cancelCustomId,
          guild,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });
        await handleModerationButton(cancelClick as any);

        // Attempt Confirm
        const confirmClick = createMockButtonInteraction({
          customId: confirmCustomId,
          guild,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });
        await handleModerationButton(confirmClick as any);

        expect(confirmClick.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringMatching(/has already been cancelled/i),
            ephemeral: true,
          })
        );
        expect(targetMember.ban).not.toHaveBeenCalled();
      });
    });
  });

  // =========================================================================
  // 5. PHASE 4D.3B /MOD PURGE TESTS
  // =========================================================================
  describe('Phase 4D.3B /mod purge Command & Confirmation Workflow', () => {
    describe('Command Preconditions & Guards', () => {
      test('rejects purge invocation outside of a guild (e.g. DM)', async () => {
        const { interaction } = createMockInteraction({
          guild: null,
          subcommand: 'purge',
          amount: 10,
          reason: 'DM test',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: 'Command must be used in a guild.',
          ephemeral: true,
        });
      });

      test('rejects purge if caller lacks Category.MODERATE authorization', async () => {
        const guild = createMockGuild();
        const unprivilegedCaller = createMockUser({ id: 'unauth-caller-1' });

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'purge',
          callerUser: unprivilegedCaller,
          callerRoles: [],
          amount: 25,
          reason: 'Unauthorized purge attempt',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ You are not authorized to use moderation commands.',
          ephemeral: true,
        });
      });

      test('rejects purge if bot lacks ManageMessages permission in target channel', async () => {
        const guild = createMockGuild();
        const restrictedChannel: any = {
          id: 'chan-restricted',
          name: 'restricted',
          type: ChannelType.GuildText,
          bulkDelete: jest.fn().mockResolvedValue(new Collection()),
          permissionsFor: jest.fn().mockReturnValue({
            has: jest.fn().mockReturnValue(false), // bot has NO ManageMessages
          }),
        };
        (guild.channels.cache as Collection<string, any>).set(restrictedChannel.id, restrictedChannel);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'purge',
          channelId: restrictedChannel.id,
          channel: restrictedChannel,
          amount: 15,
          reason: 'No perm purge test',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ Bot lacks the "Manage Messages" permission in this channel.',
          ephemeral: true,
        });
      });

      test('rejects purge if channel is not a guild text channel supporting bulkDelete', async () => {
        const guild = createMockGuild();
        const voiceChannel: any = {
          id: 'chan-voice-1',
          name: 'voice-room',
          type: ChannelType.GuildVoice,
          bulkDelete: undefined, // does NOT support bulkDelete
          permissionsFor: jest.fn().mockReturnValue({
            has: jest.fn().mockReturnValue(true),
          }),
        };
        (guild.channels.cache as Collection<string, any>).set(voiceChannel.id, voiceChannel);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'purge',
          channelId: voiceChannel.id,
          channel: voiceChannel,
          amount: 10,
          reason: 'Voice channel purge attempt',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ This channel does not support message deletion.',
          ephemeral: true,
        });
      });

      test('rejects purge if channel cannot be resolved', async () => {
        const guild = createMockGuild();
        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'purge',
          channelId: 'missing-chan',
          channel: null,
          amount: 10,
          reason: 'Null channel test',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ This channel does not support message deletion.',
          ephemeral: true,
        });
      });
    });

    describe('Amount & Reason Validation', () => {
      test('rejects amount <= 0', async () => {
        const guild = createMockGuild();
        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'purge',
          amount: 0,
          reason: 'Zero amount',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ Purge amount must be an integer between 1 and 100.',
          ephemeral: true,
        });
      });

      test('rejects negative amount', async () => {
        const guild = createMockGuild();
        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'purge',
          amount: -5,
          reason: 'Negative amount',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ Purge amount must be an integer between 1 and 100.',
          ephemeral: true,
        });
      });

      test('rejects amount > 100 without silent clamping', async () => {
        const guild = createMockGuild();
        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'purge',
          amount: 150,
          reason: 'Over limit amount',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ Purge amount must be an integer between 1 and 100.',
          ephemeral: true,
        });
      });

      test('rejects non-integer amount', async () => {
        const guild = createMockGuild();
        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'purge',
          amount: 12.5,
          reason: 'Non-integer amount',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ Purge amount must be an integer between 1 and 100.',
          ephemeral: true,
        });
      });

      test('rejects empty or whitespace-only reason', async () => {
        const guild = createMockGuild();
        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'purge',
          amount: 10,
          reason: '   ',
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ A valid reason must be provided for the purge.',
          ephemeral: true,
        });
      });

      test('rejects reason exceeding 512 characters', async () => {
        const guild = createMockGuild();
        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'purge',
          amount: 10,
          reason: 'A'.repeat(513),
        });

        await execute(interaction as any);

        expect(interaction.reply).toHaveBeenCalledWith({
          content: '❌ Purge reason cannot exceed 512 characters.',
          ephemeral: true,
        });
      });

      test('accepts boundary amount 1', async () => {
        const guild = createMockGuild();
        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'purge',
          amount: 1,
          reason: 'Minimum boundary test',
        });

        await execute(interaction as any);

        const replyData = interaction.getReplyData();
        expect(replyData.embeds[0].data.title).toBe('⚠️ CONFIRM MESSAGE PURGE');
      });

      test('accepts boundary amount 100', async () => {
        const guild = createMockGuild();
        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'purge',
          amount: 100,
          reason: 'Maximum boundary test',
        });

        await execute(interaction as any);

        const replyData = interaction.getReplyData();
        expect(replyData.embeds[0].data.title).toBe('⚠️ CONFIRM MESSAGE PURGE');
      });
    });

    describe('Proposal Flow & Confirmation Presentation', () => {
      test('creates proposal without deleting any messages immediately', async () => {
        const guild = createMockGuild();
        const targetChannel = guild.channels.cache.get('chan-mod-1') as any;

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'purge',
          amount: 42,
          reason: 'Spam attack cleanup',
        });

        await execute(interaction as any);

        // Crucial invariant: NO messages deleted during proposal creation!
        expect(targetChannel.bulkDelete).not.toHaveBeenCalled();

        const replyData = interaction.getReplyData();

        const embed = replyData.embeds[0].data;
        expect(embed.title).toBe('⚠️ CONFIRM MESSAGE PURGE');
        expect(embed.description).toContain('42');
        expect(embed.description).toContain('destructive');

        const channelField = embed.fields.find((f: any) => f.name === 'Channel');
        expect(channelField.value).toContain('chan-mod-1');

        const amountField = embed.fields.find((f: any) => f.name === 'Requested Amount');
        expect(amountField.value).toBe('`42 messages`');

        const reasonField = embed.fields.find((f: any) => f.name === 'Reason');
        expect(reasonField.value).toBe('Spam attack cleanup');

        const row = replyData.components[0];
        expect(row.components).toHaveLength(2);

        const confirmBtn = row.components[0].data;
        const cancelBtn = row.components[1].data;

        expect(confirmBtn.custom_id).toMatch(/^mod_purge_confirm_/);
        expect(confirmBtn.label).toBe('Confirm Purge');
        expect(cancelBtn.custom_id).toMatch(/^mod_purge_cancel_/);
        expect(cancelBtn.label).toBe('Cancel');

        const actionId = confirmBtn.custom_id.replace('mod_purge_confirm_', '');
        const pending = getPendingModAction(actionId);
        expect(pending).toBeDefined();
        expect(pending?.actionType).toBe('PURGE');
        expect(pending?.channelId).toBe('chan-mod-1');
        expect(pending?.amount).toBe(42);
        expect(pending?.reason).toBe('Spam attack cleanup');
        expect(pending?.status).toBe('PENDING');
      });
    });

    describe('Channel Binding & Security', () => {
      test('rejects confirmation if clicked from a different channel', async () => {
        const guild = createMockGuild();
        const otherChannel: any = {
          id: 'chan-other-2',
          name: 'other-channel',
          type: ChannelType.GuildText,
          bulkDelete: jest.fn().mockResolvedValue(new Collection()),
          permissionsFor: jest.fn().mockReturnValue({
            has: jest.fn().mockReturnValue(true),
          }),
        };
        (guild.channels.cache as Collection<string, any>).set(otherChannel.id, otherChannel);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'purge',
          channelId: 'chan-mod-1',
          amount: 30,
          reason: 'Cross-channel security test',
        });
        await execute(interaction as any);

        const confirmCustomId = interaction.getReplyData().components[0].components[0].data.custom_id;

        // Button clicked from a different channel
        const crossChannelClick = createMockButtonInteraction({
          customId: confirmCustomId,
          guild,
          channelId: 'chan-other-2',
          channel: otherChannel,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });

        await handleModerationButton(crossChannelClick as any);

        expect(crossChannelClick.reply).toHaveBeenCalledWith({
          content: '❌ Purge confirmation must be performed in the channel where it was proposed.',
          ephemeral: true,
        });

        // Original channel bulkDelete must NOT have been called
        const origChannel = guild.channels.cache.get('chan-mod-1') as any;
        expect(origChannel.bulkDelete).not.toHaveBeenCalled();
        expect(otherChannel.bulkDelete).not.toHaveBeenCalled();
      });

      test('rejects cancellation if clicked from a different channel', async () => {
        const guild = createMockGuild();
        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'purge',
          channelId: 'chan-mod-1',
          amount: 20,
          reason: 'Cross-channel cancel test',
        });
        await execute(interaction as any);

        const cancelCustomId = interaction.getReplyData().components[0].components[1].data.custom_id;

        const crossChannelClick = createMockButtonInteraction({
          customId: cancelCustomId,
          guild,
          channelId: 'chan-other-2',
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });

        await handleModerationButton(crossChannelClick as any);

        expect(crossChannelClick.reply).toHaveBeenCalledWith({
          content: '❌ Purge confirmation must be performed in the channel where it was proposed.',
          ephemeral: true,
        });
      });
    });

    describe('Confirmation Authorization & Lifecycle', () => {
      test('rejects confirmation by a different moderator', async () => {
        const guild = createMockGuild();
        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'purge',
          amount: 10,
          reason: 'Different mod test',
        });
        await execute(interaction as any);

        const confirmCustomId = interaction.getReplyData().components[0].components[0].data.custom_id;

        const otherModClick = createMockButtonInteraction({
          customId: confirmCustomId,
          guild,
          user: { id: 'other-mod-2', username: 'OtherMod' },
        });

        await handleModerationButton(otherModClick as any);

        expect(otherModClick.reply).toHaveBeenCalledWith({
          content: '❌ Only the moderator who initiated this action can confirm or cancel it.',
          ephemeral: true,
        });
      });

      test('rejects interaction from a different guild', async () => {
        const guild = createMockGuild();
        const otherGuild = createMockGuild();
        otherGuild.id = 'guild-different-999';

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'purge',
          amount: 10,
          reason: 'Wrong guild test',
        });
        await execute(interaction as any);

        const confirmCustomId = interaction.getReplyData().components[0].components[0].data.custom_id;

        const wrongGuildClick = createMockButtonInteraction({
          customId: confirmCustomId,
          guild: otherGuild,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });

        await handleModerationButton(wrongGuildClick as any);

        expect(wrongGuildClick.reply).toHaveBeenCalledWith({
          content: '❌ Moderation action does not belong to this server.',
          ephemeral: true,
        });
      });

      test('rejects confirmation if pending action has expired', async () => {
        const guild = createMockGuild();
        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'purge',
          amount: 10,
          reason: 'Expiry test',
        });
        await execute(interaction as any);

        const confirmCustomId = interaction.getReplyData().components[0].components[0].data.custom_id;
        const actionId = confirmCustomId.replace('mod_purge_confirm_', '');

        // Fast-forward 6 minutes past 5-min TTL
        const realDateNow = Date.now;
        Date.now = () => realDateNow() + 6 * 60 * 1000;

        try {
          const expiredClick = createMockButtonInteraction({
            customId: confirmCustomId,
            guild,
            user: { id: 'mod-caller-1', username: 'ModCaller' },
          });

          await handleModerationButton(expiredClick as any);

          expect(expiredClick.reply).toHaveBeenCalledWith(
            expect.objectContaining({
              content: expect.stringMatching(/has expired/i),
              ephemeral: true,
            })
          );
        } finally {
          Date.now = realDateNow;
        }
      });

      test('cancels purge cleanly and prevents subsequent execution', async () => {
        const guild = createMockGuild();
        const targetChannel = guild.channels.cache.get('chan-mod-1') as any;

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'purge',
          amount: 15,
          reason: 'Cancellation test',
        });
        await execute(interaction as any);

        const confirmCustomId = interaction.getReplyData().components[0].components[0].data.custom_id;
        const cancelCustomId = interaction.getReplyData().components[0].components[1].data.custom_id;
        const actionId = confirmCustomId.replace('mod_purge_confirm_', '');

        // Click Cancel
        const cancelClick = createMockButtonInteraction({
          customId: cancelCustomId,
          guild,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });
        await handleModerationButton(cancelClick as any);

        const updateData = cancelClick.getUpdateData();
        expect(updateData.embeds[0].data.title).toBe('🚫 PURGE CANCELLED');
        expect(updateData.components).toEqual([]);

        expect(targetChannel.bulkDelete).not.toHaveBeenCalled();

        const pending = getPendingModAction(actionId);
        expect(pending?.status).toBe('CANCELLED');

        // Subsequent attempt to confirm must be rejected
        const confirmClick = createMockButtonInteraction({
          customId: confirmCustomId,
          guild,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });
        await handleModerationButton(confirmClick as any);

        expect(confirmClick.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringMatching(/has already been cancelled/i),
            ephemeral: true,
          })
        );
        expect(targetChannel.bulkDelete).not.toHaveBeenCalled();
      });

      test('replay protection: cannot execute confirmed action twice', async () => {
        const guild = createMockGuild();
        const targetChannel = guild.channels.cache.get('chan-mod-1') as any;
        const deletedCollection = new Collection();
        for (let i = 0; i < 20; i++) deletedCollection.set(`msg-${i}`, { id: `msg-${i}` });
        targetChannel.bulkDelete = jest.fn().mockResolvedValue(deletedCollection);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'purge',
          amount: 20,
          reason: 'Double click replay protection test',
        });
        await execute(interaction as any);

        const confirmCustomId = interaction.getReplyData().components[0].components[0].data.custom_id;

        // First click
        const click1 = createMockButtonInteraction({
          customId: confirmCustomId,
          guild,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });
        await handleModerationButton(click1 as any);

        expect(targetChannel.bulkDelete).toHaveBeenCalledTimes(1);

        // Second click
        const click2 = createMockButtonInteraction({
          customId: confirmCustomId,
          guild,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });
        await handleModerationButton(click2 as any);

        expect(click2.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringMatching(/already been executed/i),
            ephemeral: true,
          })
        );
        expect(targetChannel.bulkDelete).toHaveBeenCalledTimes(1);
      });
    });

    describe('Revalidation at Confirmation Time', () => {
      test('rejects confirmation if moderator loses Category.MODERATE role', async () => {
        const guild = createMockGuild();
        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'purge',
          amount: 10,
          reason: 'Role demotion test',
        });
        await execute(interaction as any);

        const confirmCustomId = interaction.getReplyData().components[0].components[0].data.custom_id;

        // Moderator member stripped of roles
        const demotedUser = createMockUser({ id: 'mod-caller-1', username: 'ModCaller' });
        const demotedMember = createMockMember(demotedUser, []);

        const confirmClick = createMockButtonInteraction({
          customId: confirmCustomId,
          guild,
          member: demotedMember,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });

        await handleModerationButton(confirmClick as any);

        expect(confirmClick.reply).toHaveBeenCalledWith({
          content: '❌ You are no longer authorized to execute moderation commands.',
          ephemeral: true,
        });

        const targetChannel = guild.channels.cache.get('chan-mod-1') as any;
        expect(targetChannel.bulkDelete).not.toHaveBeenCalled();
      });

      test('rejects confirmation if bot loses ManageMessages permission', async () => {
        const guild = createMockGuild();
        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'purge',
          amount: 10,
          reason: 'Bot perm lost test',
        });
        await execute(interaction as any);

        const confirmCustomId = interaction.getReplyData().components[0].components[0].data.custom_id;

        const targetChannel = guild.channels.cache.get('chan-mod-1') as any;
        // Revoke bot permission
        targetChannel.permissionsFor = jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(false),
        });

        const confirmClick = createMockButtonInteraction({
          customId: confirmCustomId,
          guild,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });

        await handleModerationButton(confirmClick as any);

        expect(confirmClick.reply).toHaveBeenCalledWith({
          content: '❌ Bot lacks the "Manage Messages" permission in this channel.',
          ephemeral: true,
        });
        expect(targetChannel.bulkDelete).not.toHaveBeenCalled();
      });
    });

    describe('Action Execution, Verification & Logging', () => {
      test('full success purge executes cleanly, marks EXECUTED, and logs to #mod-logs', async () => {
        const modLogsChannel: any = {
          id: 'chan-mod-logs-1',
          name: 'mod-logs',
          type: ChannelType.GuildText,
          send: jest.fn().mockResolvedValue({ id: 'log-msg-1' }),
        };
        const guild = createMockGuild({ channels: [modLogsChannel] });
        const targetChannel = guild.channels.cache.get('chan-mod-1') as any;

        const deletedMap = new Collection();
        for (let i = 0; i < 25; i++) deletedMap.set(`m-${i}`, { id: `m-${i}` });
        targetChannel.bulkDelete = jest.fn().mockResolvedValue(deletedMap);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'purge',
          amount: 25,
          reason: 'Mass spam cleanup',
        });
        await execute(interaction as any);

        const confirmCustomId = interaction.getReplyData().components[0].components[0].data.custom_id;
        const actionId = confirmCustomId.replace('mod_purge_confirm_', '');

        const confirmClick = createMockButtonInteraction({
          customId: confirmCustomId,
          guild,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });

        await handleModerationButton(confirmClick as any);

        // Verification of execution
        expect(targetChannel.bulkDelete).toHaveBeenCalledWith(25, true);

        // Verification of response
        const updateData = confirmClick.getUpdateData();
        expect(updateData.embeds[0].data.title).toBe('🧹 Messages Purged');
        expect(updateData.embeds[0].data.description).toContain('Successfully purged **25** message(s)');
        expect(updateData.components).toEqual([]);

        // Verification of mod confirmation status
        const completed = getPendingModAction(actionId);
        expect(completed?.status).toBe('EXECUTED');

        // Verification of #mod-logs
        expect(modLogsChannel.send).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({
                  title: '🛡️ Messages Purged',
                  fields: expect.arrayContaining([
                    expect.objectContaining({ name: 'Action', value: '`PURGE`' }),
                    expect.objectContaining({ name: 'Requested Amount', value: '`25`' }),
                    expect.objectContaining({ name: 'Deleted Amount', value: '`25`' }),
                    expect.objectContaining({ name: 'Status', value: '`EXECUTED & VERIFIED (FULL)`' }),
                    expect.objectContaining({ name: 'Reason', value: 'Mass spam cleanup' }),
                  ]),
                }),
              }),
            ]),
          })
        );
      });

      test('partial purge accurately reports deleted count and logs PARTIAL status', async () => {
        const modLogsChannel: any = {
          id: 'chan-mod-logs-1',
          name: 'mod-logs',
          type: ChannelType.GuildText,
          send: jest.fn().mockResolvedValue({ id: 'log-msg-1' }),
        };
        const guild = createMockGuild({ channels: [modLogsChannel] });
        const targetChannel = guild.channels.cache.get('chan-mod-1') as any;

        // Requested 50, but only 18 available/eligible
        const deletedMap = new Collection();
        for (let i = 0; i < 18; i++) deletedMap.set(`m-${i}`, { id: `m-${i}` });
        targetChannel.bulkDelete = jest.fn().mockResolvedValue(deletedMap);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'purge',
          amount: 50,
          reason: 'Old messages purge partial test',
        });
        await execute(interaction as any);

        const confirmCustomId = interaction.getReplyData().components[0].components[0].data.custom_id;
        const actionId = confirmCustomId.replace('mod_purge_confirm_', '');

        const confirmClick = createMockButtonInteraction({
          customId: confirmCustomId,
          guild,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });

        await handleModerationButton(confirmClick as any);

        // Response reflects partial success
        const updateData = confirmClick.getUpdateData();
        expect(updateData.embeds[0].data.title).toBe('⚠️ Messages Partially Purged');
        expect(updateData.embeds[0].data.description).toContain('Purged **18** of **50** requested message(s)');

        // Action is marked EXECUTED since deletion succeeded partially
        const completed = getPendingModAction(actionId);
        expect(completed?.status).toBe('EXECUTED');

        // #mod-logs reflects partial success
        expect(modLogsChannel.send).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({
                  title: '🛡️ Messages Partially Purged',
                  fields: expect.arrayContaining([
                    expect.objectContaining({ name: 'Action', value: '`PURGE`' }),
                    expect.objectContaining({ name: 'Requested Amount', value: '`50`' }),
                    expect.objectContaining({ name: 'Deleted Amount', value: '`18`' }),
                    expect.objectContaining({ name: 'Status', value: '`EXECUTED & VERIFIED (PARTIAL)`' }),
                  ]),
                }),
              }),
            ]),
          })
        );
      });

      test('Discord API error reports failure and does not mark action EXECUTED', async () => {
        const guild = createMockGuild();
        const targetChannel = guild.channels.cache.get('chan-mod-1') as any;
        targetChannel.bulkDelete = jest.fn().mockRejectedValue(new Error('Discord API 500: Internal Server Error'));

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'purge',
          amount: 30,
          reason: 'Discord API failure test',
        });
        await execute(interaction as any);

        const confirmCustomId = interaction.getReplyData().components[0].components[0].data.custom_id;
        const actionId = confirmCustomId.replace('mod_purge_confirm_', '');

        const confirmClick = createMockButtonInteraction({
          customId: confirmCustomId,
          guild,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });

        await handleModerationButton(confirmClick as any);

        const updateData = confirmClick.getUpdateData();
        expect(updateData.embeds[0].data.title).toBe('❌ PURGE FAILED');
        expect(updateData.embeds[0].data.description).toContain('Discord API 500: Internal Server Error');

        const pending = getPendingModAction(actionId);
        expect(pending?.status).not.toBe('EXECUTED');
      });

      test('moderation still succeeds when #mod-logs channel is absent', async () => {
        const guild = createMockGuild({ channels: [] }); // NO #mod-logs
        const targetChannel = guild.channels.cache.get('chan-mod-1') as any;
        const deletedMap = new Collection();
        deletedMap.set('m-1', { id: 'm-1' });
        targetChannel.bulkDelete = jest.fn().mockResolvedValue(deletedMap);

        const { interaction } = createMockInteraction({
          guild,
          subcommand: 'purge',
          amount: 1,
          reason: 'No log channel purge test',
        });
        await execute(interaction as any);

        const confirmCustomId = interaction.getReplyData().components[0].components[0].data.custom_id;
        const actionId = confirmCustomId.replace('mod_purge_confirm_', '');

        const confirmClick = createMockButtonInteraction({
          customId: confirmCustomId,
          guild,
          user: { id: 'mod-caller-1', username: 'ModCaller' },
        });

        await handleModerationButton(confirmClick as any);

        const updateData = confirmClick.getUpdateData();
        expect(updateData.embeds[0].data.title).toBe('🧹 Messages Purged');

        const completed = getPendingModAction(actionId);
        expect(completed?.status).toBe('EXECUTED');
      });
    });
  });
});
