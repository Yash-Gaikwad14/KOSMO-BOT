// src/tests/premium/premiumService.test.ts

import {
  PremiumSyncService,
  PREMIUM_ROLE_NAMES,
} from '../../services/payments/premiumService';
import {
  MockPremiumEntitlementProvider,
  PostgresPremiumEntitlementProvider,
  ExternalApiEntitlementProvider,
  setPremiumEntitlementProvider,
} from '../../services/payments/entitlementProvider';
import { ChannelType, Collection, Guild, GuildMember, Role, PermissionFlagsBits } from 'discord.js';

describe('Phase 8 — Premium Role Synchronization Service', () => {
  let mockProvider: MockPremiumEntitlementProvider;
  let service: PremiumSyncService;

  beforeEach(() => {
    mockProvider = new MockPremiumEntitlementProvider();
    setPremiumEntitlementProvider(mockProvider);
    service = new PremiumSyncService();
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

  function createMockMember(
    userId: string,
    initialRoles: Role[] = [],
    highestPosition: number = 5
  ): GuildMember {
    const rolesMap = new Collection<string, Role>();
    initialRoles.forEach((r) => rolesMap.set(r.id, r));

    const highest =
      initialRoles.length > 0
        ? [...initialRoles].sort((a, b) => b.position - a.position)[0]
        : createMockRole('everyone', '@everyone', 0);

    const member: any = {
      id: userId,
      user: { id: userId, tag: `User_${userId}#0001`, username: `User_${userId}`, bot: false },
      displayName: `User_${userId}`,
      roles: {
        cache: rolesMap,
        highest: { ...highest, position: highestPosition },
        add: jest.fn().mockImplementation(async (role: Role) => {
          rolesMap.set(role.id, role);
          return member;
        }),
        remove: jest.fn().mockImplementation(async (role: Role) => {
          rolesMap.delete(role.id);
          return member;
        }),
      },
    };
    return member as GuildMember;
  }

  function createMockGuild(options: {
    botPosition?: number;
    roles?: Role[];
    channels?: any[];
  } = {}): Guild {
    const rolesMap = new Collection<string, Role>();
    const channelsMap = new Collection<string, any>();
    const membersMap = new Collection<string, GuildMember>();

    const botRole = createMockRole('role-bot', 'KosmoBot', options.botPosition ?? 50);
    const maxRole = createMockRole('role-max', PREMIUM_ROLE_NAMES.MAX, 30);
    const proRole = createMockRole('role-pro', PREMIUM_ROLE_NAMES.PRO, 20);
    const vipRole = createMockRole('role-vip', PREMIUM_ROLE_NAMES.VIP, 25);
    const founderRole = createMockRole('role-founder', 'Founder', 99);

    rolesMap.set(botRole.id, botRole);
    rolesMap.set(maxRole.id, maxRole);
    rolesMap.set(proRole.id, proRole);
    rolesMap.set(vipRole.id, vipRole);
    rolesMap.set(founderRole.id, founderRole);

    (options.roles || []).forEach((r) => rolesMap.set(r.id, r));
    (options.channels || []).forEach((c) => channelsMap.set(c.id, c));

    const botMember: any = {
      id: 'bot-id',
      roles: {
        cache: new Collection([['role-bot', botRole]]),
        highest: botRole,
      },
      permissions: {
        has: jest.fn().mockImplementation((perm) => {
          if (perm === PermissionFlagsBits.ManageRoles || perm === 'ManageRoles') return true;
          return false;
        }),
      },
    };

    const guild: any = {
      id: 'guild-123',
      name: 'Kosmo Community',
      ownerId: 'owner-id',
      roles: {
        cache: rolesMap,
      },
      channels: {
        cache: channelsMap,
      },
      members: {
        cache: membersMap,
        me: botMember,
        fetch: jest.fn().mockImplementation(async (arg: any) => {
          const id = typeof arg === 'string' ? arg : arg?.user;
          return membersMap.get(id) || null;
        }),
      },
    };
    return guild;
  }

  describe('Tier Synchronization & Mutations', () => {
    test('grants Kosmo VIP when user has VIP entitlement', async () => {
      const guild = createMockGuild();
      const member = createMockMember('user-1');
      (guild.members.cache as any).set(member.id, member);

      await mockProvider.setEntitlement({
        targetId: 'user-1',
        tier: 'VIP',
        status: 'ACTIVE',
        isVip: true,
        source: 'TEST_SUITE',
        updatedAt: new Date(),
      });

      const result = await service.syncMemberPremium(guild, 'user-1');

      expect(result.status).toBe('SUCCESS');
      expect(result.entitledTier).toBe('VIP');
      expect(result.entitledVip).toBe(true);
      expect(member.roles.add).toHaveBeenCalledTimes(1);
      const addedRole = (member.roles.add as jest.Mock).mock.calls[0][0];
      expect(addedRole.name).toBe(PREMIUM_ROLE_NAMES.VIP);
    });

    test('grants Kosmo Pro when user has PRO entitlement', async () => {
      const guild = createMockGuild();
      const member = createMockMember('user-2');
      (guild.members.cache as any).set(member.id, member);

      await mockProvider.setEntitlement({
        targetId: 'user-2',
        tier: 'PRO',
        status: 'ACTIVE',
        isVip: false,
        source: 'TEST_SUITE',
        updatedAt: new Date(),
      });

      const result = await service.syncMemberPremium(guild, 'user-2');

      expect(result.status).toBe('SUCCESS');
      expect(result.entitledTier).toBe('PRO');
      expect(member.roles.add).toHaveBeenCalledTimes(1);
      expect((member.roles.add as jest.Mock).mock.calls[0][0].name).toBe(PREMIUM_ROLE_NAMES.PRO);
    });

    test('grants Kosmo Max when user has MAX entitlement', async () => {
      const guild = createMockGuild();
      const member = createMockMember('user-3');
      (guild.members.cache as any).set(member.id, member);

      await mockProvider.setEntitlement({
        targetId: 'user-3',
        tier: 'MAX',
        status: 'ACTIVE',
        isVip: false,
        source: 'TEST_SUITE',
        updatedAt: new Date(),
      });

      const result = await service.syncMemberPremium(guild, 'user-3');

      expect(result.status).toBe('SUCCESS');
      expect(result.entitledTier).toBe('MAX');
      expect(member.roles.add).toHaveBeenCalledTimes(1);
      expect((member.roles.add as jest.Mock).mock.calls[0][0].name).toBe(PREMIUM_ROLE_NAMES.MAX);
    });
  });

  describe('Upgrades & Downgrades (Mutually Exclusive Paid Tiers)', () => {
    test('upgrades PRO -> MAX: adds Kosmo Max and removes Kosmo Pro', async () => {
      const guild = createMockGuild();
      const proRole = guild.roles.cache.find((r) => r.name === PREMIUM_ROLE_NAMES.PRO)!;
      const member = createMockMember('user-upgrade', [proRole]);
      (guild.members.cache as any).set(member.id, member);

      await mockProvider.setEntitlement({
        targetId: 'user-upgrade',
        tier: 'MAX',
        status: 'ACTIVE',
        source: 'TEST_SUITE',
        updatedAt: new Date(),
      });

      const result = await service.syncMemberPremium(guild, 'user-upgrade');

      expect(result.status).toBe('SUCCESS');
      expect(member.roles.remove).toHaveBeenCalledWith(
        expect.objectContaining({ name: PREMIUM_ROLE_NAMES.PRO })
      );
      expect(member.roles.add).toHaveBeenCalledWith(
        expect.objectContaining({ name: PREMIUM_ROLE_NAMES.MAX })
      );
      expect(result.mutations).toHaveLength(2);
    });

    test('downgrades MAX -> PRO: adds Kosmo Pro and removes Kosmo Max', async () => {
      const guild = createMockGuild();
      const maxRole = guild.roles.cache.find((r) => r.name === PREMIUM_ROLE_NAMES.MAX)!;
      const member = createMockMember('user-downgrade', [maxRole]);
      (guild.members.cache as any).set(member.id, member);

      await mockProvider.setEntitlement({
        targetId: 'user-downgrade',
        tier: 'PRO',
        status: 'ACTIVE',
        source: 'TEST_SUITE',
        updatedAt: new Date(),
      });

      const result = await service.syncMemberPremium(guild, 'user-downgrade');

      expect(result.status).toBe('SUCCESS');
      expect(member.roles.remove).toHaveBeenCalledWith(
        expect.objectContaining({ name: PREMIUM_ROLE_NAMES.MAX })
      );
      expect(member.roles.add).toHaveBeenCalledWith(
        expect.objectContaining({ name: PREMIUM_ROLE_NAMES.PRO })
      );
    });

    test('downgrades PRO -> NONE: removes Kosmo Pro', async () => {
      const guild = createMockGuild();
      const proRole = guild.roles.cache.find((r) => r.name === PREMIUM_ROLE_NAMES.PRO)!;
      const member = createMockMember('user-canceled', [proRole]);
      (guild.members.cache as any).set(member.id, member);

      await mockProvider.setEntitlement({
        targetId: 'user-canceled',
        tier: 'NONE',
        status: 'ACTIVE',
        source: 'TEST_SUITE',
        updatedAt: new Date(),
      });

      const result = await service.syncMemberPremium(guild, 'user-canceled');

      expect(result.status).toBe('SUCCESS');
      expect(member.roles.remove).toHaveBeenCalledWith(
        expect.objectContaining({ name: PREMIUM_ROLE_NAMES.PRO })
      );
      expect(member.roles.add).not.toHaveBeenCalled();
    });
  });

  describe('VIP Coexistence Exception', () => {
    test('VIP may coexist with Kosmo Max (Kosmo VIP + Kosmo Max)', async () => {
      const guild = createMockGuild();
      const vipRole = guild.roles.cache.find((r) => r.name === PREMIUM_ROLE_NAMES.VIP)!;
      // Member already has Kosmo VIP
      const member = createMockMember('user-vip-max', [vipRole]);
      (guild.members.cache as any).set(member.id, member);

      // User subscribes to MAX while retaining VIP status
      await mockProvider.setEntitlement({
        targetId: 'user-vip-max',
        tier: 'MAX',
        isVip: true,
        status: 'ACTIVE',
        source: 'TEST_SUITE',
        updatedAt: new Date(),
      });

      const result = await service.syncMemberPremium(guild, 'user-vip-max');

      expect(result.status).toBe('SUCCESS');
      // Must NOT remove VIP
      expect(member.roles.remove).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: PREMIUM_ROLE_NAMES.VIP })
      );
      // Must add MAX
      expect(member.roles.add).toHaveBeenCalledWith(
        expect.objectContaining({ name: PREMIUM_ROLE_NAMES.MAX })
      );
      expect(result.hasVip).toBe(true);
      expect(result.entitledVip).toBe(true);
      expect(result.entitledTier).toBe('MAX');
    });

    test('VIP is not removed when user upgrades from NONE to PRO', async () => {
      const guild = createMockGuild();
      const vipRole = guild.roles.cache.find((r) => r.name === PREMIUM_ROLE_NAMES.VIP)!;
      const member = createMockMember('user-vip-pro', [vipRole]);
      (guild.members.cache as any).set(member.id, member);

      await mockProvider.setEntitlement({
        targetId: 'user-vip-pro',
        tier: 'PRO',
        isVip: true,
        status: 'ACTIVE',
        source: 'TEST_SUITE',
        updatedAt: new Date(),
      });

      const result = await service.syncMemberPremium(guild, 'user-vip-pro');

      expect(result.status).toBe('SUCCESS');
      expect(member.roles.remove).not.toHaveBeenCalled();
      expect(member.roles.add).toHaveBeenCalledWith(
        expect.objectContaining({ name: PREMIUM_ROLE_NAMES.PRO })
      );
    });
  });

  describe('Idempotency (Already-Correct State)', () => {
    test('performs NO Discord mutations if member already has correct role', async () => {
      const guild = createMockGuild();
      const maxRole = guild.roles.cache.find((r) => r.name === PREMIUM_ROLE_NAMES.MAX)!;
      const member = createMockMember('user-in-sync', [maxRole]);
      (guild.members.cache as any).set(member.id, member);

      await mockProvider.setEntitlement({
        targetId: 'user-in-sync',
        tier: 'MAX',
        status: 'ACTIVE',
        isVip: false,
        source: 'TEST_SUITE',
        updatedAt: new Date(),
      });

      const result = await service.syncMemberPremium(guild, 'user-in-sync');

      expect(result.status).toBe('NO_CHANGE');
      expect(result.mutations).toHaveLength(0);
      expect(member.roles.add).not.toHaveBeenCalled();
      expect(member.roles.remove).not.toHaveBeenCalled();
    });
  });

  describe('Fail-Safe Source Resilience (SOURCE UNAVAILABLE ≠ NOT ENTITLED)', () => {
    test('NEVER removes premium roles when entitlement provider fails/throws error', async () => {
      const guild = createMockGuild();
      const maxRole = guild.roles.cache.find((r) => r.name === PREMIUM_ROLE_NAMES.MAX)!;
      const member = createMockMember('user-resilient', [maxRole]);
      (guild.members.cache as any).set(member.id, member);

      // Simulate network / provider failure
      mockProvider.shouldFail = true;

      const result = await service.syncMemberPremium(guild, 'user-resilient');

      expect(result.status).toBe('SYNC_FAILED');
      expect(result.error).toContain('Entitlement provider unavailable');
      // MUST NOT REMOVE ROLES
      expect(member.roles.remove).not.toHaveBeenCalled();
      expect(member.roles.add).not.toHaveBeenCalled();
    });

    test('safely removes premium roles when entitlement is explicitly EXPIRED', async () => {
      const guild = createMockGuild();
      const maxRole = guild.roles.cache.find((r) => r.name === PREMIUM_ROLE_NAMES.MAX)!;
      const member = createMockMember('user-expired', [maxRole]);
      (guild.members.cache as any).set(member.id, member);

      await mockProvider.setEntitlement({
        targetId: 'user-expired',
        tier: 'MAX',
        status: 'EXPIRED',
        source: 'TEST_SUITE',
        updatedAt: new Date(),
      });

      const result = await service.syncMemberPremium(guild, 'user-expired');

      expect(result.status).toBe('SUCCESS');
      expect(member.roles.remove).toHaveBeenCalledWith(
        expect.objectContaining({ name: PREMIUM_ROLE_NAMES.MAX })
      );
    });

    test('retains active premium tier during GRACE_PERIOD', async () => {
      const guild = createMockGuild();
      const maxRole = guild.roles.cache.find((r) => r.name === PREMIUM_ROLE_NAMES.MAX)!;
      const member = createMockMember('user-grace', [maxRole]);
      (guild.members.cache as any).set(member.id, member);

      await mockProvider.setEntitlement({
        targetId: 'user-grace',
        tier: 'MAX',
        status: 'GRACE_PERIOD',
        source: 'TEST_SUITE',
        updatedAt: new Date(),
      });

      const result = await service.syncMemberPremium(guild, 'user-grace');

      expect(result.status).toBe('NO_CHANGE');
      expect(member.roles.remove).not.toHaveBeenCalled();
    });
  });

  describe('Security & Role Hierarchy Checks', () => {
    test('blocks synchronization if bot role is below target premium role', async () => {
      // Bot position = 10, Max role position = 30
      const guild = createMockGuild({ botPosition: 10 });
      const member = createMockMember('user-hier');
      (guild.members.cache as any).set(member.id, member);

      await mockProvider.setEntitlement({
        targetId: 'user-hier',
        tier: 'MAX',
        status: 'ACTIVE',
        source: 'TEST_SUITE',
        updatedAt: new Date(),
      });

      const result = await service.syncMemberPremium(guild, 'user-hier');

      expect(result.status).toBe('BLOCKED_ROLE_HIERARCHY');
      expect(result.error).toContain('Bot hierarchy insufficient');
      expect(member.roles.add).not.toHaveBeenCalled();
    });

    test('blocks synchronization if bot lacks ManageRoles permission', async () => {
      const guild = createMockGuild();
      (guild.members.me as any).permissions.has.mockReturnValue(false);

      const member = createMockMember('user-perm');
      (guild.members.cache as any).set(member.id, member);

      const result = await service.syncMemberPremium(guild, 'user-perm');

      expect(result.status).toBe('BLOCKED_ROLE_HIERARCHY');
      expect(result.error).toContain('Manage Roles');
    });

    test('never modifies unrelated privileged staff roles (Founder, Moderator, Admin)', async () => {
      const guild = createMockGuild();
      const founderRole = guild.roles.cache.find((r) => r.name === 'Founder')!;
      const proRole = guild.roles.cache.find((r) => r.name === PREMIUM_ROLE_NAMES.PRO)!;
      // Staff member with Founder and Pro
      const member = createMockMember('founder-user', [founderRole, proRole]);
      (guild.members.cache as any).set(member.id, member);

      // Entitlement changes to NONE
      await mockProvider.setEntitlement({
        targetId: 'founder-user',
        tier: 'NONE',
        status: 'ACTIVE',
        source: 'TEST_SUITE',
        updatedAt: new Date(),
      });

      const result = await service.syncMemberPremium(guild, 'founder-user');

      expect(result.status).toBe('SUCCESS');
      // Pro removed
      expect(member.roles.remove).toHaveBeenCalledWith(
        expect.objectContaining({ name: PREMIUM_ROLE_NAMES.PRO })
      );
      // Founder MUST NOT be removed
      expect(member.roles.remove).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Founder' })
      );
      expect(member.roles.cache.has(founderRole.id)).toBe(true);
    });
  });

  describe('Concurrency & Race Condition Protection', () => {
    test('serializes and rejects simultaneous concurrent sync requests for the same user', async () => {
      const guild = createMockGuild();
      const member = createMockMember('user-concurrent');
      (guild.members.cache as any).set(member.id, member);

      await mockProvider.setEntitlement({
        targetId: 'user-concurrent',
        tier: 'PRO',
        status: 'ACTIVE',
        source: 'TEST_SUITE',
        updatedAt: new Date(),
      });

      // Launch two parallel syncs simultaneously
      const [res1, res2] = await Promise.all([
        service.syncMemberPremium(guild, 'user-concurrent'),
        service.syncMemberPremium(guild, 'user-concurrent'),
      ]);

      const successCount = [res1, res2].filter((r) => r.status === 'SUCCESS').length;
      const lockedCount = [res1, res2].filter(
        (r) => r.status === 'SYNC_FAILED' && r.error?.includes('Concurrent synchronization')
      ).length;

      expect(successCount).toBe(1);
      expect(lockedCount).toBe(1);
    });
  });

  describe('Audit Logging', () => {
    test('emits structured audit log to #mod-logs on role change', async () => {
      const mockSend = jest.fn().mockResolvedValue({});
      const modLogsChannel = {
        id: 'chan-mod-logs',
        name: 'mod-logs',
        type: ChannelType.GuildText,
        send: mockSend,
      };

      const guild = createMockGuild({ channels: [modLogsChannel] });
      const member = createMockMember('user-audit');
      (guild.members.cache as any).set(member.id, member);

      await mockProvider.setEntitlement({
        targetId: 'user-audit',
        tier: 'MAX',
        status: 'ACTIVE',
        source: 'TEST_SUITE',
        updatedAt: new Date(),
      });

      const result = await service.syncMemberPremium(guild, 'user-audit', {
        callerTag: 'StaffUser#0001',
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.auditLogged).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);

      const payload = mockSend.mock.calls[0][0];
      expect(payload.embeds[0].data.title).toBe('🛡️ Premium Role Synchronized');
    });
  });

  describe('Comprehensive Premium Role Transition Matrix (Section 11)', () => {
    test('NONE -> PRO: adds Kosmo Pro, touches no other roles', async () => {
      const guild = createMockGuild();
      const member = createMockMember('user-n-pro');
      (guild.members.cache as any).set(member.id, member);

      await mockProvider.setEntitlement({
        targetId: 'user-n-pro',
        tier: 'PRO',
        status: 'ACTIVE',
        source: 'TEST',
        updatedAt: new Date(),
      });

      const res = await service.syncMemberPremium(guild, 'user-n-pro');
      expect(res.status).toBe('SUCCESS');
      expect(member.roles.add).toHaveBeenCalledWith(expect.objectContaining({ name: PREMIUM_ROLE_NAMES.PRO }));
      expect(member.roles.remove).not.toHaveBeenCalled();
    });

    test('NONE -> MAX: adds Kosmo Max, touches no other roles', async () => {
      const guild = createMockGuild();
      const member = createMockMember('user-n-max');
      (guild.members.cache as any).set(member.id, member);

      await mockProvider.setEntitlement({
        targetId: 'user-n-max',
        tier: 'MAX',
        status: 'ACTIVE',
        source: 'TEST',
        updatedAt: new Date(),
      });

      const res = await service.syncMemberPremium(guild, 'user-n-max');
      expect(res.status).toBe('SUCCESS');
      expect(member.roles.add).toHaveBeenCalledWith(expect.objectContaining({ name: PREMIUM_ROLE_NAMES.MAX }));
      expect(member.roles.remove).not.toHaveBeenCalled();
    });

    test('NONE -> VIP: adds Kosmo VIP', async () => {
      const guild = createMockGuild();
      const member = createMockMember('user-n-vip');
      (guild.members.cache as any).set(member.id, member);

      await mockProvider.setEntitlement({
        targetId: 'user-n-vip',
        tier: 'VIP',
        status: 'ACTIVE',
        isVip: true,
        source: 'TEST',
        updatedAt: new Date(),
      });

      const res = await service.syncMemberPremium(guild, 'user-n-vip');
      expect(res.status).toBe('SUCCESS');
      expect(member.roles.add).toHaveBeenCalledWith(expect.objectContaining({ name: PREMIUM_ROLE_NAMES.VIP }));
      expect(member.roles.remove).not.toHaveBeenCalled();
    });

    test('VIP -> PRO: adds Kosmo Pro and preserves Kosmo VIP', async () => {
      const guild = createMockGuild();
      const vipRole = guild.roles.cache.find((r) => r.name === PREMIUM_ROLE_NAMES.VIP)!;
      const member = createMockMember('user-vip-to-pro', [vipRole]);
      (guild.members.cache as any).set(member.id, member);

      await mockProvider.setEntitlement({
        targetId: 'user-vip-to-pro',
        tier: 'PRO',
        isVip: true,
        status: 'ACTIVE',
        source: 'TEST',
        updatedAt: new Date(),
      });

      const res = await service.syncMemberPremium(guild, 'user-vip-to-pro');
      expect(res.status).toBe('SUCCESS');
      expect(member.roles.add).toHaveBeenCalledWith(expect.objectContaining({ name: PREMIUM_ROLE_NAMES.PRO }));
      expect(member.roles.remove).not.toHaveBeenCalled();
    });

    test('VIP -> MAX: adds Kosmo Max and preserves Kosmo VIP', async () => {
      const guild = createMockGuild();
      const vipRole = guild.roles.cache.find((r) => r.name === PREMIUM_ROLE_NAMES.VIP)!;
      const member = createMockMember('user-vip-to-max', [vipRole]);
      (guild.members.cache as any).set(member.id, member);

      await mockProvider.setEntitlement({
        targetId: 'user-vip-to-max',
        tier: 'MAX',
        isVip: true,
        status: 'ACTIVE',
        source: 'TEST',
        updatedAt: new Date(),
      });

      const res = await service.syncMemberPremium(guild, 'user-vip-to-max');
      expect(res.status).toBe('SUCCESS');
      expect(member.roles.add).toHaveBeenCalledWith(expect.objectContaining({ name: PREMIUM_ROLE_NAMES.MAX }));
      expect(member.roles.remove).not.toHaveBeenCalled();
    });

    test('VIP + PRO -> VIP + MAX: removes Kosmo Pro, adds Kosmo Max, preserves Kosmo VIP', async () => {
      const guild = createMockGuild();
      const vipRole = guild.roles.cache.find((r) => r.name === PREMIUM_ROLE_NAMES.VIP)!;
      const proRole = guild.roles.cache.find((r) => r.name === PREMIUM_ROLE_NAMES.PRO)!;
      const member = createMockMember('user-vp-to-vm', [vipRole, proRole]);
      (guild.members.cache as any).set(member.id, member);

      await mockProvider.setEntitlement({
        targetId: 'user-vp-to-vm',
        tier: 'MAX',
        isVip: true,
        status: 'ACTIVE',
        source: 'TEST',
        updatedAt: new Date(),
      });

      const res = await service.syncMemberPremium(guild, 'user-vp-to-vm');
      expect(res.status).toBe('SUCCESS');
      expect(member.roles.remove).toHaveBeenCalledWith(expect.objectContaining({ name: PREMIUM_ROLE_NAMES.PRO }));
      expect(member.roles.remove).not.toHaveBeenCalledWith(expect.objectContaining({ name: PREMIUM_ROLE_NAMES.VIP }));
      expect(member.roles.add).toHaveBeenCalledWith(expect.objectContaining({ name: PREMIUM_ROLE_NAMES.MAX }));
    });

    test('VIP + MAX -> VIP: removes Kosmo Max, preserves Kosmo VIP', async () => {
      const guild = createMockGuild();
      const vipRole = guild.roles.cache.find((r) => r.name === PREMIUM_ROLE_NAMES.VIP)!;
      const maxRole = guild.roles.cache.find((r) => r.name === PREMIUM_ROLE_NAMES.MAX)!;
      const member = createMockMember('user-vm-to-v', [vipRole, maxRole]);
      (guild.members.cache as any).set(member.id, member);

      await mockProvider.setEntitlement({
        targetId: 'user-vm-to-v',
        tier: 'NONE',
        isVip: true,
        status: 'ACTIVE',
        source: 'TEST',
        updatedAt: new Date(),
      });

      const res = await service.syncMemberPremium(guild, 'user-vm-to-v');
      expect(res.status).toBe('SUCCESS');
      expect(member.roles.remove).toHaveBeenCalledWith(expect.objectContaining({ name: PREMIUM_ROLE_NAMES.MAX }));
      expect(member.roles.remove).not.toHaveBeenCalledWith(expect.objectContaining({ name: PREMIUM_ROLE_NAMES.VIP }));
      expect(member.roles.add).not.toHaveBeenCalled();
    });

    test('already-correct PRO: returns NO_CHANGE with zero mutations', async () => {
      const guild = createMockGuild();
      const proRole = guild.roles.cache.find((r) => r.name === PREMIUM_ROLE_NAMES.PRO)!;
      const member = createMockMember('user-ac-pro', [proRole]);
      (guild.members.cache as any).set(member.id, member);

      await mockProvider.setEntitlement({
        targetId: 'user-ac-pro',
        tier: 'PRO',
        isVip: false,
        status: 'ACTIVE',
        source: 'TEST',
        updatedAt: new Date(),
      });

      const res = await service.syncMemberPremium(guild, 'user-ac-pro');
      expect(res.status).toBe('NO_CHANGE');
      expect(member.roles.add).not.toHaveBeenCalled();
      expect(member.roles.remove).not.toHaveBeenCalled();
    });

    test('already-correct MAX: returns NO_CHANGE with zero mutations', async () => {
      const guild = createMockGuild();
      const maxRole = guild.roles.cache.find((r) => r.name === PREMIUM_ROLE_NAMES.MAX)!;
      const member = createMockMember('user-ac-max', [maxRole]);
      (guild.members.cache as any).set(member.id, member);

      await mockProvider.setEntitlement({
        targetId: 'user-ac-max',
        tier: 'MAX',
        isVip: false,
        status: 'ACTIVE',
        source: 'TEST',
        updatedAt: new Date(),
      });

      const res = await service.syncMemberPremium(guild, 'user-ac-max');
      expect(res.status).toBe('NO_CHANGE');
      expect(member.roles.add).not.toHaveBeenCalled();
      expect(member.roles.remove).not.toHaveBeenCalled();
    });

    test('already-correct VIP: returns NO_CHANGE with zero mutations', async () => {
      const guild = createMockGuild();
      const vipRole = guild.roles.cache.find((r) => r.name === PREMIUM_ROLE_NAMES.VIP)!;
      const member = createMockMember('user-ac-vip', [vipRole]);
      (guild.members.cache as any).set(member.id, member);

      await mockProvider.setEntitlement({
        targetId: 'user-ac-vip',
        tier: 'VIP',
        isVip: true,
        status: 'ACTIVE',
        source: 'TEST',
        updatedAt: new Date(),
      });

      const res = await service.syncMemberPremium(guild, 'user-ac-vip');
      expect(res.status).toBe('NO_CHANGE');
      expect(member.roles.add).not.toHaveBeenCalled();
      expect(member.roles.remove).not.toHaveBeenCalled();
    });

    test('already-correct VIP + MAX: returns NO_CHANGE with zero mutations', async () => {
      const guild = createMockGuild();
      const vipRole = guild.roles.cache.find((r) => r.name === PREMIUM_ROLE_NAMES.VIP)!;
      const maxRole = guild.roles.cache.find((r) => r.name === PREMIUM_ROLE_NAMES.MAX)!;
      const member = createMockMember('user-ac-vm', [vipRole, maxRole]);
      (guild.members.cache as any).set(member.id, member);

      await mockProvider.setEntitlement({
        targetId: 'user-ac-vm',
        tier: 'MAX',
        isVip: true,
        status: 'ACTIVE',
        source: 'TEST',
        updatedAt: new Date(),
      });

      const res = await service.syncMemberPremium(guild, 'user-ac-vm');
      expect(res.status).toBe('NO_CHANGE');
      expect(member.roles.add).not.toHaveBeenCalled();
      expect(member.roles.remove).not.toHaveBeenCalled();
    });
  });
});
