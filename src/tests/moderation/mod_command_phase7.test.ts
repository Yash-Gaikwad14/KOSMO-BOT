// src/tests/moderation/mod_command_phase7.test.ts

import execute, { data } from '../../commands/moderation/mod';
import {
  setModerationRepository,
  InMemoryModerationRepository,
} from '../../services/moderation/moderationRepository';
import { moderationService } from '../../services/moderation/moderationService';
import { ChannelType, GuildMember, User, Collection, Role } from 'discord.js';

describe('Phase 7 — /mod Slash Command (Phase 7 Subcommands)', () => {
  let inMemoryRepo: InMemoryModerationRepository;

  beforeEach(() => {
    inMemoryRepo = new InMemoryModerationRepository();
    setModerationRepository(inMemoryRepo);
    jest.clearAllMocks();
  });

  afterEach(() => {
    setModerationRepository(null);
  });

  function createMockRole(id: string, name: string, position: number = 1): Role {
    return {
      id,
      name,
      position,
      permissions: { bitfield: BigInt(0), has: jest.fn().mockReturnValue(false) },
    } as unknown as Role;
  }

  function createMockUser(overrides: any = {}): User {
    const username = overrides.username || 'targetUser';
    return {
      id: overrides.id || 'target-user-123',
      username,
      tag: overrides.tag || `${username}#0001`,
      displayName: overrides.displayName || username,
      bot: false,
      send: jest.fn().mockResolvedValue({}),
      ...overrides,
    } as unknown as User;
  }

  function createMockMember(user: User, rolesList: Role[] = [], overrides: any = {}): GuildMember {
    const rolesMap = new Collection<string, Role>();
    rolesList.forEach((r) => rolesMap.set(r.id, r));

    const highest =
      rolesList.length > 0
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
      timeout: jest.fn().mockResolvedValue({}),
      send: jest.fn().mockResolvedValue({}),
      ...overrides,
    };
    return member as unknown as GuildMember;
  }

  function createMockGuild(overrides: any = {}) {
    const rolesMap = new Collection<string, Role>();
    const channelsMap = new Collection<string, any>();
    const membersMap = new Collection<string, GuildMember>();

    const botRole = createMockRole('bot-role', 'KosmoBot', 99);
    const modRole = createMockRole('role-mod', 'Moderator', 50);
    const founderRole = createMockRole('1544750811207442532', 'Founder', 100);

    rolesMap.set(botRole.id, botRole);
    rolesMap.set(modRole.id, modRole);
    rolesMap.set(founderRole.id, founderRole);

    (overrides.roles || []).forEach((r: Role) => rolesMap.set(r.id, r));
    (overrides.channels || []).forEach((c: any) => channelsMap.set(c.id, c));

    const { roles, channels, members, ...restOverrides } = overrides;

    const guild: any = {
      id: overrides.id || 'guild-123',
      name: overrides.name || 'Kosmo Community',
      ownerId: overrides.ownerId || 'owner-user-id',
      roles: {
        cache: rolesMap,
        everyone: createMockRole('everyone', '@everyone', 0),
      },
      channels: {
        cache: channelsMap,
        fetch: jest.fn().mockImplementation(async (id: string) => channelsMap.get(id) || null),
      },
      members: {
        cache: membersMap,
        fetch: jest.fn().mockImplementation(async (id: string) => {
          return membersMap.get(id) || null;
        }),
        me: {
          id: 'bot-user-id',
          user: { id: 'bot-user-id', username: 'KosmoBot', bot: true },
          roles: {
            cache: new Collection([['bot-role', botRole]]),
            highest: botRole,
          },
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        },
      },
      bans: {
        fetch: jest.fn(),
      },
      ...restOverrides,
    };
    return guild;
  }

  function createMockInteraction(options: {
    subcommand: string;
    targetUser?: User;
    targetMember?: GuildMember;
    reason?: string;
    evidence?: string;
    severity?: string;
    caseId?: string;
    callerUser?: User;
    callerRoles?: Role[];
    guild?: any;
  }) {
    const {
      subcommand,
      targetUser,
      targetMember,
      reason,
      evidence,
      severity,
      caseId,
      callerUser = createMockUser({ id: 'mod-user-id', username: 'ModeratorOne' }),
      callerRoles = [createMockRole('role-mod', 'Moderator', 50)],
      guild = createMockGuild(),
    } = options;

    const callerMember = createMockMember(callerUser, callerRoles);
    guild.members.cache.set(callerUser.id, callerMember);

    if (targetUser && targetMember) {
      guild.members.cache.set(targetUser.id, targetMember);
    }

    const reply = jest.fn().mockResolvedValue({});
    const followUp = jest.fn().mockResolvedValue({});

    const interaction: any = {
      guild,
      guildId: guild?.id,
      user: callerUser,
      member: callerMember,
      options: {
        getSubcommand: () => subcommand,
        getUser: (name: string) => (name === 'user' ? targetUser : null),
        getString: (name: string) => {
          if (name === 'reason') return reason ?? null;
          if (name === 'evidence') return evidence ?? null;
          if (name === 'severity') return severity ?? null;
          if (name === 'case_id') return caseId ?? null;
          return null;
        },
        getInteger: () => null,
      },
      reply,
      followUp,
      replied: false,
      deferred: false,
    };

    return { interaction, reply, followUp, guild };
  }

  describe('Command Registration Data', () => {
    test('defines all Phase 7 subcommands: warn, strike, history, case', () => {
      const subcommands = data.options.map((opt: any) => opt.name);
      expect(subcommands).toContain('warn');
      expect(subcommands).toContain('strike');
      expect(subcommands).toContain('history');
      expect(subcommands).toContain('case');
      expect(subcommands).toContain('timeout');
      expect(subcommands).toContain('kick');
      expect(subcommands).toContain('ban');
      expect(subcommands).toContain('purge');
    });
  });

  describe('Subcommand: /mod warn', () => {
    test('successfully issues a warning, sends DM, logs to #mod-logs, and creates case', async () => {
      const mockSend = jest.fn().mockResolvedValue({});
      const modLogsChannel = {
        id: 'chan-mod-logs',
        name: 'mod-logs',
        type: ChannelType.GuildText,
        send: mockSend,
      };

      const guild = createMockGuild({ channels: [modLogsChannel] });
      const targetUser = createMockUser({ id: 'target-1' });
      const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);

      const { interaction, reply } = createMockInteraction({
        subcommand: 'warn',
        targetUser,
        targetMember,
        reason: 'Minor spamming in general',
        evidence: 'https://discord.com/channels/1/2/3',
        guild,
      });

      await execute(interaction);

      expect(reply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                title: '⚠️ Member Warned',
                description: expect.stringContaining('Successfully issued a warning to'),
              }),
            }),
          ]),
        })
      );

      // Verify DM was attempted
      expect(targetMember.send).toHaveBeenCalledTimes(1);

      // Verify #mod-logs audit embed
      expect(mockSend).toHaveBeenCalledTimes(1);
      const logPayload = mockSend.mock.calls[0][0];
      expect(logPayload.embeds[0].data.title).toBe('🛡️ Member Warned');

      // Verify case exists in repository
      const history = await moderationService.getModerationHistory(guild.id, 'target-1');
      expect(history.totalCases).toBe(1);
      expect(history.cases[0].actionType).toBe('WARN');
      expect(history.cases[0].reason).toBe('Minor spamming in general');
      expect(history.cases[0].evidence).toBe('https://discord.com/channels/1/2/3');
    });

    test('rejects unauthorized user trying to warn', async () => {
      const targetUser = createMockUser();
      const targetMember = createMockMember(targetUser);

      const { interaction, reply } = createMockInteraction({
        subcommand: 'warn',
        targetUser,
        targetMember,
        reason: 'Unauthorized attempt',
        callerRoles: [createMockRole('unauthorized', 'Kosmosian', 1)],
      });

      await execute(interaction);

      expect(reply).toHaveBeenCalledWith({
        content: '❌ You are not authorized to use moderation commands.',
        ephemeral: true,
      });
    });

    test('rejects warning against server owner or higher role (hierarchy safety)', async () => {
      const guild = createMockGuild({ ownerId: 'owner-target-id' });
      const ownerUser = createMockUser({ id: 'owner-target-id', username: 'ServerOwner' });
      const ownerMember = createMockMember(ownerUser, [createMockRole('owner', 'Owner', 1000)]);

      const { interaction, reply } = createMockInteraction({
        subcommand: 'warn',
        targetUser: ownerUser,
        targetMember: ownerMember,
        reason: 'Attempting to warn owner',
        guild,
      });

      await execute(interaction);

      expect(reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Cannot warn member: Cannot moderate the server owner.'),
          ephemeral: true,
        })
      );
    });
  });

  describe('Subcommand: /mod strike', () => {
    test('issues a strike, increments active count, and returns policy recommendation without auto-executing', async () => {
      const mockSend = jest.fn().mockResolvedValue({});
      const modLogsChannel = {
        id: 'chan-mod-logs',
        name: 'mod-logs',
        type: ChannelType.GuildText,
        send: mockSend,
      };

      const guild = createMockGuild({ channels: [modLogsChannel] });
      const targetUser = createMockUser({ id: 'target-strike-1' });
      const targetMember = createMockMember(targetUser, [createMockRole('member', 'Member', 5)]);

      // 1st Strike
      const { interaction: int1, reply: rep1 } = createMockInteraction({
        subcommand: 'strike',
        targetUser,
        targetMember,
        reason: 'First strike offense',
        severity: 'MEDIUM',
        guild,
      });

      await execute(int1);

      expect(rep1).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                title: '⚡ Member Struck',
              }),
            }),
          ]),
        })
      );

      let history = await moderationService.getModerationHistory(guild.id, 'target-strike-1');
      expect(history.activeStrikes).toBe(1);

      // 2nd Strike
      const { interaction: int2, reply: rep2 } = createMockInteraction({
        subcommand: 'strike',
        targetUser,
        targetMember,
        reason: 'Second strike offense',
        guild,
      });

      await execute(int2);

      history = await moderationService.getModerationHistory(guild.id, 'target-strike-1');
      expect(history.activeStrikes).toBe(2);

      const embed2 = rep2.mock.calls[0][0].embeds[0].data;
      const recField = embed2.fields.find((f: any) => f.name.includes('Policy Escalation Recommendation'));
      expect(recField.value).toContain('10-minute temporary timeout recommended');

      // Crucial requirement: Verify notice that action was NOT executed automatically
      const noticeField = embed2.fields.find((f: any) => f.name.includes('Important Notice'));
      expect(noticeField.value).toContain('Policy recommendations are NOT executed automatically');
      expect(targetMember.timeout).not.toHaveBeenCalled();
    });
  });

  describe('Subcommand: /mod history', () => {
    test('displays target user active strikes and recent cases ephemerally', async () => {
      const guild = createMockGuild();
      const targetUser = createMockUser({ id: 'user-history-target' });
      const targetMember = createMockMember(targetUser);

      // Populate some cases
      await moderationService.issueWarning({
        guildId: guild.id,
        targetId: 'user-history-target',
        targetTag: 'Target#0001',
        moderatorId: 'mod-1',
        moderatorTag: 'Mod#0001',
        reason: 'Prior warning',
      });

      await moderationService.issueStrike({
        guildId: guild.id,
        targetId: 'user-history-target',
        targetTag: 'Target#0001',
        moderatorId: 'mod-1',
        moderatorTag: 'Mod#0001',
        reason: 'Prior strike',
      });

      const { interaction, reply } = createMockInteraction({
        subcommand: 'history',
        targetUser,
        targetMember,
        guild,
      });

      await execute(interaction);

      expect(reply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                title: expect.stringContaining('Moderation History'),
              }),
            }),
          ]),
          ephemeral: true,
        })
      );

      const embed = reply.mock.calls[0][0].embeds[0].data;
      const strikesField = embed.fields.find((f: any) => f.name === 'Active Strikes');
      expect(strikesField.value).toBe('`1 / 3`');
      const totalField = embed.fields.find((f: any) => f.name === 'Total Cases');
      expect(totalField.value).toBe('`2`');
    });
  });

  describe('Subcommand: /mod case', () => {
    test('looks up and displays full case details ephemerally', async () => {
      const guild = createMockGuild();

      const { caseRecord } = await moderationService.issueWarning({
        guildId: guild.id,
        targetId: 'user-case-test',
        targetTag: 'CaseUser#0001',
        moderatorId: 'mod-1',
        moderatorTag: 'Mod#0001',
        reason: 'Evidence check case',
        evidence: 'https://discord.com/channels/1/2/345',
      });

      const { interaction, reply } = createMockInteraction({
        subcommand: 'case',
        caseId: caseRecord.caseId,
        guild,
      });

      await execute(interaction);

      expect(reply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                title: expect.stringContaining(caseRecord.caseId),
              }),
            }),
          ]),
          ephemeral: true,
        })
      );

      const embed = reply.mock.calls[0][0].embeds[0].data;
      expect(embed.fields.some((f: any) => f.name === 'Evidence' && f.value === 'https://discord.com/channels/1/2/345')).toBe(true);
    });

    test('returns not found when case ID belongs to another guild (guild isolation)', async () => {
      const guild = createMockGuild({ id: 'guild-current' });

      // Case created in different guild
      const { caseRecord } = await moderationService.issueWarning({
        guildId: 'guild-other',
        targetId: 'user-foreign',
        targetTag: 'Foreign#0001',
        moderatorId: 'mod-1',
        moderatorTag: 'Mod#0001',
        reason: 'Foreign guild case',
      });

      const { interaction, reply } = createMockInteraction({
        subcommand: 'case',
        caseId: caseRecord.caseId,
        guild,
      });

      await execute(interaction);

      expect(reply).toHaveBeenCalledWith({
        content: `❌ Case \`${caseRecord.caseId}\` was not found in this server.`,
        ephemeral: true,
      });
    });
  });
});
