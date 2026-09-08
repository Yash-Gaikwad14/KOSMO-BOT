// src/tests/premium/premium_command.test.ts

import execute, { data } from '../../commands/premium/premium';
import {
  MockPremiumEntitlementProvider,
  setPremiumEntitlementProvider,
} from '../../services/payments/entitlementProvider';
import { PREMIUM_ROLE_NAMES } from '../../services/payments/premiumService';
import { Collection, GuildMember, Role, User } from 'discord.js';

describe('Phase 8 — /premium Slash Command', () => {
  let mockProvider: MockPremiumEntitlementProvider;

  beforeEach(() => {
    mockProvider = new MockPremiumEntitlementProvider();
    setPremiumEntitlementProvider(mockProvider);
    jest.clearAllMocks();
  });

  afterEach(() => {
    setPremiumEntitlementProvider(null);
  });

  function createMockRole(id: string, name: string, position: number = 10): Role {
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
        add: jest.fn().mockImplementation(async (role: Role) => {
          rolesMap.set(role.id, role);
          return member;
        }),
        remove: jest.fn().mockImplementation(async (role: Role) => {
          rolesMap.delete(role.id);
          return member;
        }),
      },
      ...overrides,
    };
    return member as unknown as GuildMember;
  }

  function createMockGuild(overrides: any = {}) {
    const rolesMap = new Collection<string, Role>();
    const channelsMap = new Collection<string, any>();
    const membersMap = new Collection<string, GuildMember>();

    const botRole = createMockRole('bot-role', 'KosmoBot', 99);
    const founderRole = createMockRole('1544750811207442532', 'Founder', 100);
    const teamRole = createMockRole('1544801399068434443', 'Team Kosmo', 90);
    const maxRole = createMockRole('role-max', PREMIUM_ROLE_NAMES.MAX, 30);
    const proRole = createMockRole('role-pro', PREMIUM_ROLE_NAMES.PRO, 20);
    const vipRole = createMockRole('role-vip', PREMIUM_ROLE_NAMES.VIP, 25);

    rolesMap.set(botRole.id, botRole);
    rolesMap.set(founderRole.id, founderRole);
    rolesMap.set(teamRole.id, teamRole);
    rolesMap.set(maxRole.id, maxRole);
    rolesMap.set(proRole.id, proRole);
    rolesMap.set(vipRole.id, vipRole);

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
      },
      members: {
        cache: membersMap,
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
        fetch: jest.fn().mockImplementation(async (arg: any) => {
          const id = typeof arg === 'string' ? arg : arg?.user;
          return membersMap.get(id) || null;
        }),
      },
      ...restOverrides,
    };
    return guild;
  }

  function createMockInteraction(options: {
    subcommand: string;
    targetUser?: User;
    callerUser?: User;
    callerRoles?: Role[];
    guild?: any;
  }) {
    const {
      subcommand,
      targetUser = createMockUser({ id: 'target-1' }),
      callerUser = createMockUser({ id: 'mod-user-id', username: 'StaffOne' }),
      callerRoles = [createMockRole('1544750811207442532', 'Founder', 100)],
      guild = createMockGuild(),
    } = options;

    const callerMember = createMockMember(callerUser, callerRoles);
    guild.members.cache.set(callerUser.id, callerMember);

    const reply = jest.fn().mockResolvedValue({});
    const deferReply = jest.fn().mockResolvedValue({});
    const editReply = jest.fn().mockResolvedValue({});

    const interaction: any = {
      guild,
      guildId: guild?.id,
      user: callerUser,
      member: callerMember,
      options: {
        getSubcommand: () => subcommand,
        getUser: (name: string) => (name === 'user' ? targetUser : null),
      },
      reply,
      deferReply,
      editReply,
      replied: false,
      deferred: false,
    };

    return { interaction, reply, deferReply, editReply, guild };
  }

  test('registers expected slash command definition', () => {
    const json = data.toJSON();
    expect(json.name).toBe('premium');
    expect(json.description).toContain('premium');
    expect(json.options).toHaveLength(2); // sync & status
  });

  describe('Authorization', () => {
    test('allows Founder to execute /premium sync', async () => {
      const guild = createMockGuild();
      const targetUser = createMockUser({ id: 'target-auth' });
      const targetMember = createMockMember(targetUser);
      guild.members.cache.set(targetUser.id, targetMember);

      await mockProvider.setEntitlement({
        targetId: 'target-auth',
        tier: 'PRO',
        status: 'ACTIVE',
        source: 'TEST',
        updatedAt: new Date(),
      });

      const { interaction, editReply } = createMockInteraction({
        subcommand: 'sync',
        targetUser,
        callerRoles: [createMockRole('1544750811207442532', 'Founder', 100)],
        guild,
      });

      await execute(interaction);

      expect(editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                title: '💎 Premium Roles Synchronized',
              }),
            }),
          ]),
        })
      );
    });

    test('rejects unprivileged user trying to run /premium sync', async () => {
      const guild = createMockGuild();
      const targetUser = createMockUser({ id: 'target-auth-2' });

      const { interaction, reply } = createMockInteraction({
        subcommand: 'sync',
        targetUser,
        callerRoles: [createMockRole('role-member', 'Member', 5)], // Not Founder or Team Kosmo
        guild,
      });

      await execute(interaction);

      expect(reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('not authorized'),
          ephemeral: true,
        })
      );
    });
  });

  describe('Subcommand: /premium status', () => {
    test('displays current entitlement and Discord roles for member', async () => {
      const guild = createMockGuild();
      const proRole = guild.roles.cache.find((r: any) => r.name === PREMIUM_ROLE_NAMES.PRO)!;
      const targetUser = createMockUser({ id: 'target-status' });
      const targetMember = createMockMember(targetUser, [proRole]);
      guild.members.cache.set(targetUser.id, targetMember);

      await mockProvider.setEntitlement({
        targetId: 'target-status',
        tier: 'PRO',
        status: 'ACTIVE',
        isVip: false,
        source: 'KOSMO_BACKEND',
        updatedAt: new Date(),
      });

      const { interaction, editReply } = createMockInteraction({
        subcommand: 'status',
        targetUser,
        callerRoles: [createMockRole('1544801399068434443', 'Team Kosmo', 90)],
        guild,
      });

      await execute(interaction);

      expect(editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                title: expect.stringContaining('Premium Entitlement Status'),
                fields: expect.arrayContaining([
                  expect.objectContaining({ name: 'Entitled Paid Tier', value: '`PRO`' }),
                  expect.objectContaining({ name: 'Discord Roles Present', value: '`Kosmo Pro`' }),
                ]),
              }),
            }),
          ]),
        })
      );
    });
  });
});
