import { Guild, ChannelType } from 'discord.js';
import { runAction } from '../../services/discord/actions';
import { DiscordAction } from '../../services/discord/types';

// Minimal mock Guild
const mockGuild = {
  roles: {
    cache: new Map(),
    create: jest.fn().mockResolvedValue(undefined),
  },
  channels: {
    cache: new Map(),
    create: jest.fn().mockResolvedValue(undefined),
    fetch: jest.fn().mockImplementation(async (id: string) => (mockGuild.channels.cache as any).get(id) || null),
  },
  members: {
    me: { id: 'bot-id' },
    fetch: jest.fn().mockResolvedValue({
      roles: {
        cache: new Map(),
        add: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue(undefined),
      },
      user: { tag: 'User#1234' },
    }),
  },
} as unknown as Guild;

describe('Discord Actions Executor (runAction)', () => {
  beforeEach(() => {
    (mockGuild.roles.cache as any).clear();
    (mockGuild.channels.cache as any).clear();
    jest.clearAllMocks();
  });

  test('createRole idempotent – creates when missing', async () => {
    const action: DiscordAction = { type: 'createRole', payload: { name: 'NewRole' } };
    const msg = await runAction(mockGuild, action);
    expect(msg).toBe('Created role "NewRole".');
    expect(mockGuild.roles.create).toHaveBeenCalled();
  });

  test('createRole idempotent – skips when exists', async () => {
    (mockGuild.roles.cache as any).set('1', { id: '1', name: 'Existing' } as any);
    const action: DiscordAction = { type: 'createRole', payload: { name: 'Existing' } };
    const msg = await runAction(mockGuild, action);
    expect(msg).toBe('Role "Existing" already exists.');
  });

  test('deleteChannel deletes existing channel', async () => {
    const mockChannel = {
      id: 'chan-1',
      name: 'test-channel',
      delete: jest.fn().mockResolvedValue(undefined),
    };
    (mockGuild.channels.cache as any).set('chan-1', mockChannel);

    const action: DiscordAction = { type: 'deleteChannel', payload: { channelName: 'test-channel' } };
    const msg = await runAction(mockGuild, action);
    expect(msg).toBe('Deleted channel "test-channel".');
    expect(mockChannel.delete).toHaveBeenCalledTimes(1);
  });

  test('deleteChannel idempotent – handles missing channel gracefully', async () => {
    const action: DiscordAction = { type: 'deleteChannel', payload: { channelName: 'missing-channel' } };
    const msg = await runAction(mockGuild, action);
    expect(msg).toBe('Channel "missing-channel" not found or already deleted.');
  });

  test('deleteCategory deletes existing category', async () => {
    const mockCategory = {
      id: 'cat-1',
      name: 'old-category',
      type: ChannelType.GuildCategory,
      delete: jest.fn().mockResolvedValue(undefined),
    };
    (mockGuild.channels.cache as any).set('cat-1', mockCategory);

    const action: DiscordAction = { type: 'deleteCategory', payload: { categoryName: 'old-category' } };
    const msg = await runAction(mockGuild, action);
    expect(msg).toBe('Deleted category "old-category".');
    expect(mockCategory.delete).toHaveBeenCalledTimes(1);
  });

  test('deleteRole deletes existing unprivileged role', async () => {
    const mockRole = {
      id: 'role-temp',
      name: 'TempRole',
      delete: jest.fn().mockResolvedValue(undefined),
    };
    (mockGuild.roles.cache as any).set('role-temp', mockRole);

    const action: DiscordAction = { type: 'deleteRole', payload: { roleName: 'TempRole' } };
    const msg = await runAction(mockGuild, action);
    expect(msg).toBe('Deleted role "TempRole".');
    expect(mockRole.delete).toHaveBeenCalledTimes(1);
  });

  test('deleteRole blocks deletion of privileged role', async () => {
    const mockRole = {
      id: 'role-founder',
      name: 'Founder',
      delete: jest.fn().mockResolvedValue(undefined),
    };
    (mockGuild.roles.cache as any).set('role-founder', mockRole);

    const action: DiscordAction = { type: 'deleteRole', payload: { roleName: 'Founder' } };
    await expect(runAction(mockGuild, action)).rejects.toThrow(/privileged role/i);
    expect(mockRole.delete).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Category Parenting for createChannel
  // -------------------------------------------------------------------------
  test('createChannel without category creates at guild root (TEST A)', async () => {
    const action: DiscordAction = {
      type: 'createChannel',
      payload: { name: 'root-channel', type: 'GUILD_TEXT' },
    };

    const msg = await runAction(mockGuild, action);

    expect(msg).toBe('Created text channel "root-channel".');
    expect(mockGuild.channels.create).toHaveBeenCalledTimes(1);
    expect(mockGuild.channels.create).toHaveBeenCalledWith({
      name: 'root-channel',
      type: ChannelType.GuildText,
    });
  });

  test('createChannel inside existing category passes parent ID and reports category (TEST B)', async () => {
    const mockCategory = {
      id: 'cat-kosmo-testing',
      name: 'KOSMO Testing',
      type: ChannelType.GuildCategory,
    };
    (mockGuild.channels.cache as any).set('cat-kosmo-testing', mockCategory);

    const action: DiscordAction = {
      type: 'createChannel',
      payload: {
        name: 'test2',
        type: 'GUILD_TEXT',
        category: 'KOSMO Testing',
      },
    };

    const msg = await runAction(mockGuild, action);

    expect(msg).toBe('Created text channel "test2" inside category "KOSMO Testing".');
    expect(mockGuild.channels.create).toHaveBeenCalledTimes(1);
    expect(mockGuild.channels.create).toHaveBeenCalledWith({
      name: 'test2',
      type: ChannelType.GuildText,
      parent: 'cat-kosmo-testing',
    });
  });

  test('createChannel with missing category throws error and does NOT call create (TEST C)', async () => {
    const action: DiscordAction = {
      type: 'createChannel',
      payload: {
        name: 'test3',
        type: 'GUILD_TEXT',
        category: 'Does Not Exist',
      },
    };

    await expect(runAction(mockGuild, action)).rejects.toThrow(
      'Category "Does Not Exist" not found in server.'
    );
    expect(mockGuild.channels.create).not.toHaveBeenCalled();
  });

  test('createChannel rejects non-category channel target as parent (TEST D)', async () => {
    const nonCategory = {
      id: 'text-chan-1',
      name: 'KOSMO Testing',
      type: ChannelType.GuildText, // NOT a GuildCategory!
    };
    (mockGuild.channels.cache as any).set('text-chan-1', nonCategory);

    const action: DiscordAction = {
      type: 'createChannel',
      payload: {
        name: 'test4',
        type: 'GUILD_TEXT',
        category: 'KOSMO Testing',
      },
    };

    await expect(runAction(mockGuild, action)).rejects.toThrow(
      'Category "KOSMO Testing" not found in server.'
    );
    expect(mockGuild.channels.create).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Phase 4B.1 Member Role Execution (assignRole / removeRole)
  // -------------------------------------------------------------------------
  test('assignRole adds role when member does not have it', async () => {
    const mockRole = { id: 'role-comm', name: 'Community Member' };
    (mockGuild.roles.cache as any).set('role-comm', mockRole);

    const mockMember = {
      roles: {
        cache: new Map(),
        add: jest.fn().mockResolvedValue(undefined),
      },
      user: { tag: 'TestUser#0001' },
    };
    (mockGuild.members.fetch as jest.Mock).mockResolvedValueOnce(mockMember);

    const action: DiscordAction = {
      type: 'assignRole',
      payload: { roleName: 'Community Member', memberId: 'user-123' },
    };

    const msg = await runAction(mockGuild, action);
    expect(msg).toBe('Assigned role "Community Member" to member TestUser#0001.');
    expect(mockMember.roles.add).toHaveBeenCalledWith(mockRole);
  });

  test('assignRole is idempotent when member already has role', async () => {
    const mockRole = { id: 'role-comm', name: 'Community Member' };
    (mockGuild.roles.cache as any).set('role-comm', mockRole);

    const memberRoleCache = new Map();
    memberRoleCache.set('role-comm', mockRole);

    const mockMember = {
      roles: {
        cache: memberRoleCache,
        add: jest.fn().mockResolvedValue(undefined),
      },
      user: { tag: 'TestUser#0001' },
    };
    (mockGuild.members.fetch as jest.Mock).mockResolvedValueOnce(mockMember);

    const action: DiscordAction = {
      type: 'assignRole',
      payload: { roleName: 'Community Member', memberId: 'user-123' },
    };

    const msg = await runAction(mockGuild, action);
    expect(msg).toBe('Member already has role "Community Member".');
    expect(mockMember.roles.add).not.toHaveBeenCalled();
  });

  test('removeRole removes role when member has it', async () => {
    const mockRole = { id: 'role-beta', name: 'Beta Tester' };
    (mockGuild.roles.cache as any).set('role-beta', mockRole);

    const memberRoleCache = new Map();
    memberRoleCache.set('role-beta', mockRole);

    const mockMember = {
      roles: {
        cache: memberRoleCache,
        remove: jest.fn().mockResolvedValue(undefined),
      },
      user: { tag: 'TestUser#0001' },
    };
    (mockGuild.members.fetch as jest.Mock).mockResolvedValueOnce(mockMember);

    const action: DiscordAction = {
      type: 'removeRole',
      payload: { roleName: 'Beta Tester', memberId: 'user-123' },
    };

    const msg = await runAction(mockGuild, action);
    expect(msg).toBe('Removed role "Beta Tester" from member TestUser#0001.');
    expect(mockMember.roles.remove).toHaveBeenCalledWith(mockRole);
  });

  test('removeRole is idempotent when member does not have role', async () => {
    const mockRole = { id: 'role-beta', name: 'Beta Tester' };
    (mockGuild.roles.cache as any).set('role-beta', mockRole);

    const mockMember = {
      roles: {
        cache: new Map(),
        remove: jest.fn().mockResolvedValue(undefined),
      },
      user: { tag: 'TestUser#0001' },
    };
    (mockGuild.members.fetch as jest.Mock).mockResolvedValueOnce(mockMember);

    const action: DiscordAction = {
      type: 'removeRole',
      payload: { roleName: 'Beta Tester', memberId: 'user-123' },
    };

    const msg = await runAction(mockGuild, action);
    expect(msg).toBe('Member does not have role "Beta Tester".');
    expect(mockMember.roles.remove).not.toHaveBeenCalled();
  });

  test('missing role fails safely for assignRole and removeRole', async () => {
    const assignAction: DiscordAction = {
      type: 'assignRole',
      payload: { roleName: 'NonExistentRole', memberId: 'user-123' },
    };
    await expect(runAction(mockGuild, assignAction)).rejects.toThrow(
      'Role "NonExistentRole" not found for assignment.'
    );

    const removeAction: DiscordAction = {
      type: 'removeRole',
      payload: { roleName: 'NonExistentRole', memberId: 'user-123' },
    };
    await expect(runAction(mockGuild, removeAction)).rejects.toThrow(
      'Role "NonExistentRole" not found for removal.'
    );
  });

  test('missing member fails safely', async () => {
    const mockRole = { id: 'role-comm', name: 'Community Member' };
    (mockGuild.roles.cache as any).set('role-comm', mockRole);

    (mockGuild.members.fetch as jest.Mock).mockRejectedValueOnce(
      new Error('Unknown Member')
    );

    const action: DiscordAction = {
      type: 'assignRole',
      payload: { roleName: 'Community Member', memberId: 'invalid-user' },
    };

    await expect(runAction(mockGuild, action)).rejects.toThrow('Unknown Member');
  });

  test('privileged role is rejected by existing validation for assignRole and removeRole', async () => {
    const assignAction: DiscordAction = {
      type: 'assignRole',
      payload: { roleName: 'Founder', memberId: 'user-123' },
    };
    await expect(runAction(mockGuild, assignAction)).rejects.toThrow(/privileged role/i);

    const removeAction: DiscordAction = {
      type: 'removeRole',
      payload: { roleName: 'Admin', memberId: 'user-123' },
    };
    await expect(runAction(mockGuild, removeAction)).rejects.toThrow(/privileged role/i);
  });

  describe('timeoutMember action', () => {
    test('successfully times out a member and returns confirmation', async () => {
      const mockMember = {
        id: 'member-1',
        user: { tag: 'TestUser#1234', bot: false },
        roles: { cache: new Map() },
        timeout: jest.fn().mockResolvedValue(undefined),
      };
      (mockGuild.members.fetch as jest.Mock).mockResolvedValueOnce(mockMember);

      const action: DiscordAction = {
        type: 'timeoutMember',
        payload: { memberId: 'member-1', durationMinutes: 10, reason: 'Spam' },
      };

      const result = await runAction(mockGuild, action);
      expect(result).toBe('Timed out member TestUser#1234 for 10 minutes.');
      expect(mockMember.timeout).toHaveBeenCalledWith(10 * 60 * 1000, 'Spam');
    });

    test('rejects timing out the server owner', async () => {
      const guildWithOwner = {
        ...mockGuild,
        ownerId: 'owner-1',
        members: {
          cache: new Map(),
          fetch: jest.fn().mockResolvedValue({
            id: 'owner-1',
            user: { tag: 'Owner#0001', bot: false },
            roles: { cache: new Map() },
            timeout: jest.fn(),
          }),
        },
      } as unknown as Guild;

      const action: DiscordAction = {
        type: 'timeoutMember',
        payload: { memberId: 'owner-1', durationMinutes: 10, reason: 'Test' },
      };

      await expect(runAction(guildWithOwner, action)).rejects.toThrow('Cannot timeout the server owner.');
    });

    test('rejects timing out a bot account', async () => {
      const mockBotMember = {
        id: 'bot-1',
        user: { tag: 'Bot#0001', bot: true },
        roles: { cache: new Map() },
        timeout: jest.fn(),
      };
      (mockGuild.members.fetch as jest.Mock).mockResolvedValueOnce(mockBotMember);

      const action: DiscordAction = {
        type: 'timeoutMember',
        payload: { memberId: 'bot-1', durationMinutes: 10, reason: 'Test' },
      };

      await expect(runAction(mockGuild, action)).rejects.toThrow('Cannot timeout bot accounts.');
    });

    test('rejects timing out staff members with privileged roles', async () => {
      const mockStaffMember = {
        id: 'staff-1',
        user: { tag: 'Admin#0001', bot: false },
        roles: {
          cache: new Map([['role-admin', { name: 'Administrator' }]]),
        },
        timeout: jest.fn(),
      };
      (mockGuild.members.fetch as jest.Mock).mockResolvedValueOnce(mockStaffMember);

      const action: DiscordAction = {
        type: 'timeoutMember',
        payload: { memberId: 'staff-1', durationMinutes: 10, reason: 'Test' },
      };

      await expect(runAction(mockGuild, action)).rejects.toThrow('Cannot timeout staff members with privileged roles.');
    });

    test('rejects invalid duration or empty reason via validator', async () => {
      const invalidDurationAction: DiscordAction = {
        type: 'timeoutMember',
        payload: { memberId: 'user-1', durationMinutes: 0, reason: 'Valid reason' },
      };
      await expect(runAction(mockGuild, invalidDurationAction)).rejects.toThrow(
        /integer between 1 and 10080 minutes/i
      );

      const emptyReasonAction: DiscordAction = {
        type: 'timeoutMember',
        payload: { memberId: 'user-1', durationMinutes: 5, reason: '   ' },
      };
      await expect(runAction(mockGuild, emptyReasonAction)).rejects.toThrow(
        /reason cannot be empty/i
      );
    });
  });

  describe('kickMember action execution', () => {
    test('kicks member successfully with reason', async () => {
      const mockMember = {
        id: 'user-to-kick',
        user: { tag: 'Troublemaker#9999', bot: false },
        roles: { cache: new Map() },
        kick: jest.fn().mockResolvedValue(undefined),
      };
      (mockGuild.members.fetch as jest.Mock).mockResolvedValueOnce(mockMember);

      const action: DiscordAction = {
        type: 'kickMember',
        payload: {
          guildId: 'guild-1',
          targetId: 'user-to-kick',
          reason: 'Violation of rule 1',
        },
      };

      const result = await runAction(mockGuild, action);
      expect(result).toBe('Kicked member Troublemaker#9999.');
      expect(mockMember.kick).toHaveBeenCalledWith('Violation of rule 1');
    });

    test('rejects kicking the server owner', async () => {
      const guildWithOwner = {
        ...mockGuild,
        ownerId: 'owner-99',
        members: {
          fetch: jest.fn().mockResolvedValue({
            id: 'owner-99',
            user: { tag: 'Owner#0001', bot: false },
            roles: { cache: new Map() },
            kick: jest.fn(),
          }),
        },
      } as unknown as Guild;

      const action: DiscordAction = {
        type: 'kickMember',
        payload: {
          guildId: 'guild-1',
          targetId: 'owner-99',
          reason: 'Attempted kick',
        },
      };

      await expect(runAction(guildWithOwner, action)).rejects.toThrow('Cannot kick the server owner.');
    });

    test('rejects kicking a bot account', async () => {
      const mockBotMember = {
        id: 'bot-123',
        user: { tag: 'Bot#0001', bot: true },
        roles: { cache: new Map() },
        kick: jest.fn(),
      };
      (mockGuild.members.fetch as jest.Mock).mockResolvedValueOnce(mockBotMember);

      const action: DiscordAction = {
        type: 'kickMember',
        payload: {
          guildId: 'guild-1',
          targetId: 'bot-123',
          reason: 'Attempted kick',
        },
      };

      await expect(runAction(mockGuild, action)).rejects.toThrow('Cannot kick bot accounts.');
    });

    test('rejects kicking staff members with privileged roles', async () => {
      const mockStaffMember = {
        id: 'staff-99',
        user: { tag: 'Moderator#0001', bot: false },
        roles: {
          cache: new Map([['role-mod', { name: 'Moderator' }]]),
        },
        kick: jest.fn(),
      };
      (mockGuild.members.fetch as jest.Mock).mockResolvedValueOnce(mockStaffMember);

      const action: DiscordAction = {
        type: 'kickMember',
        payload: {
          guildId: 'guild-1',
          targetId: 'staff-99',
          reason: 'Attempted kick',
        },
      };

      await expect(runAction(mockGuild, action)).rejects.toThrow('Cannot kick staff members with privileged roles.');
    });

    test('rejects empty targetId or empty reason via validator', async () => {
      const emptyTargetAction: DiscordAction = {
        type: 'kickMember',
        payload: { guildId: 'guild-1', targetId: '   ', reason: 'Valid reason' },
      };
      await expect(runAction(mockGuild, emptyTargetAction)).rejects.toThrow(/target id cannot be empty/i);

      const emptyReasonAction: DiscordAction = {
        type: 'kickMember',
        payload: { guildId: 'guild-1', targetId: 'user-1', reason: '   ' },
      };
      await expect(runAction(mockGuild, emptyReasonAction)).rejects.toThrow(/kick reason cannot be empty/i);

      const tooLongReasonAction: DiscordAction = {
        type: 'kickMember',
        payload: { guildId: 'guild-1', targetId: 'user-1', reason: 'a'.repeat(513) },
      };
      await expect(runAction(mockGuild, tooLongReasonAction)).rejects.toThrow(/cannot exceed 512 characters/i);
    });
  });

  describe('banMember action execution', () => {
    test('bans member successfully with reason passed to Discord', async () => {
      const mockMember = {
        id: 'user-to-ban',
        user: { tag: 'BannedUser#9999', bot: false },
        roles: { cache: new Map() },
        ban: jest.fn().mockResolvedValue(undefined),
      };
      (mockGuild.members.fetch as jest.Mock).mockResolvedValueOnce(mockMember);

      const action: DiscordAction = {
        type: 'banMember',
        payload: {
          guildId: 'guild-1',
          targetId: 'user-to-ban',
          reason: 'Severe violation',
        },
      };

      const result = await runAction(mockGuild, action);
      expect(result).toBe('Banned member BannedUser#9999.');
      expect(mockMember.ban).toHaveBeenCalledWith({ reason: 'Severe violation' });
    });

    test('rejects banning the server owner', async () => {
      const guildWithOwner = {
        ...mockGuild,
        ownerId: 'owner-ban-99',
        members: {
          fetch: jest.fn().mockResolvedValue({
            id: 'owner-ban-99',
            user: { tag: 'Owner#0001', bot: false },
            roles: { cache: new Map() },
            ban: jest.fn(),
          }),
        },
      } as unknown as Guild;

      const action: DiscordAction = {
        type: 'banMember',
        payload: {
          guildId: 'guild-1',
          targetId: 'owner-ban-99',
          reason: 'Attempted ban',
        },
      };

      await expect(runAction(guildWithOwner, action)).rejects.toThrow('Cannot ban the server owner.');
    });

    test('rejects banning a bot account', async () => {
      const mockBotMember = {
        id: 'bot-ban-123',
        user: { tag: 'Bot#0001', bot: true },
        roles: { cache: new Map() },
        ban: jest.fn(),
      };
      (mockGuild.members.fetch as jest.Mock).mockResolvedValueOnce(mockBotMember);

      const action: DiscordAction = {
        type: 'banMember',
        payload: {
          guildId: 'guild-1',
          targetId: 'bot-ban-123',
          reason: 'Attempted ban',
        },
      };

      await expect(runAction(mockGuild, action)).rejects.toThrow('Cannot ban bot accounts.');
    });

    test('rejects banning staff members with privileged roles', async () => {
      const mockStaffMember = {
        id: 'staff-ban-99',
        user: { tag: 'Moderator#0001', bot: false },
        roles: {
          cache: new Map([['role-mod', { name: 'Moderator' }]]),
        },
        ban: jest.fn(),
      };
      (mockGuild.members.fetch as jest.Mock).mockResolvedValueOnce(mockStaffMember);

      const action: DiscordAction = {
        type: 'banMember',
        payload: {
          guildId: 'guild-1',
          targetId: 'staff-ban-99',
          reason: 'Attempted ban',
        },
      };

      await expect(runAction(mockGuild, action)).rejects.toThrow('Cannot ban staff members with privileged roles.');
    });

    test('rejects empty targetId or empty reason via validator', async () => {
      const emptyTargetAction: DiscordAction = {
        type: 'banMember',
        payload: { guildId: 'guild-1', targetId: '   ', reason: 'Valid reason' },
      };
      await expect(runAction(mockGuild, emptyTargetAction)).rejects.toThrow(/target id cannot be empty/i);

      const emptyReasonAction: DiscordAction = {
        type: 'banMember',
        payload: { guildId: 'guild-1', targetId: 'user-1', reason: '   ' },
      };
      await expect(runAction(mockGuild, emptyReasonAction)).rejects.toThrow(/ban reason cannot be empty/i);

      const tooLongReasonAction: DiscordAction = {
        type: 'banMember',
        payload: { guildId: 'guild-1', targetId: 'user-1', reason: 'a'.repeat(513) },
      };
      await expect(runAction(mockGuild, tooLongReasonAction)).rejects.toThrow(/cannot exceed 512 characters/i);
    });
  });

  describe('purgeMessages action execution', () => {
    test('purges messages successfully and reports deleted count', async () => {
      const mockChannel = {
        id: 'chan-text-1',
        name: 'general',
        bulkDelete: jest.fn().mockResolvedValue({ size: 25 }),
      };
      (mockGuild.channels.cache as any).set('chan-text-1', mockChannel);

      const action: DiscordAction = {
        type: 'purgeMessages',
        payload: {
          guildId: 'guild-1',
          channelId: 'chan-text-1',
          amount: 25,
          reason: 'Clearing spam messages',
        },
      };

      const result = await runAction(mockGuild, action);
      expect(result).toBe('Purged 25 of 25 message(s) from #general.');
      expect(mockChannel.bulkDelete).toHaveBeenCalledWith(25, true);
    });

    test('accurately reports partial purge when older messages exist', async () => {
      const mockChannel = {
        id: 'chan-text-2',
        name: 'announcements',
        bulkDelete: jest.fn().mockResolvedValue({ size: 12 }),
      };
      (mockGuild.channels.cache as any).set('chan-text-2', mockChannel);

      const action: DiscordAction = {
        type: 'purgeMessages',
        payload: {
          guildId: 'guild-1',
          channelId: 'chan-text-2',
          amount: 50,
          reason: 'Clearing old announcements',
        },
      };

      const result = await runAction(mockGuild, action);
      expect(result).toBe('Purged 12 of 50 message(s) from #announcements.');
      expect(mockChannel.bulkDelete).toHaveBeenCalledWith(50, true);
    });

    test('throws when channel is not found', async () => {
      const action: DiscordAction = {
        type: 'purgeMessages',
        payload: {
          guildId: 'guild-1',
          channelId: 'non-existent-channel',
          amount: 10,
          reason: 'Testing missing channel',
        },
      };

      await expect(runAction(mockGuild, action)).rejects.toThrow('Channel "non-existent-channel" not found in server.');
    });

    test('throws when channel does not support message deletion', async () => {
      const voiceChannel = {
        id: 'chan-voice-1',
        name: 'Voice Chat',
      };
      (mockGuild.channels.cache as any).set('chan-voice-1', voiceChannel);

      const action: DiscordAction = {
        type: 'purgeMessages',
        payload: {
          guildId: 'guild-1',
          channelId: 'chan-voice-1',
          amount: 10,
          reason: 'Testing voice channel',
        },
      };

      await expect(runAction(mockGuild, action)).rejects.toThrow('Target channel does not support message deletion.');
    });

    test('throws when bot lacks ManageMessages permission in target channel', async () => {
      const restrictedChannel = {
        id: 'chan-restricted-1',
        name: 'restricted',
        bulkDelete: jest.fn(),
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(false),
        }),
      };
      (mockGuild.channels.cache as any).set('chan-restricted-1', restrictedChannel);

      const action: DiscordAction = {
        type: 'purgeMessages',
        payload: {
          guildId: 'guild-1',
          channelId: 'chan-restricted-1',
          amount: 10,
          reason: 'Testing no permission',
        },
      };

      await expect(runAction(mockGuild, action)).rejects.toThrow('Bot lacks ManageMessages permission in the target channel.');
    });

    test('rejects invalid amount (0, negative, >100, non-integer) via validator', async () => {
      const zeroAmountAction: DiscordAction = {
        type: 'purgeMessages',
        payload: { guildId: 'guild-1', channelId: 'chan-1', amount: 0, reason: 'Test' },
      };
      await expect(runAction(mockGuild, zeroAmountAction)).rejects.toThrow(/purge amount must be an integer between 1 and 100/i);

      const negAmountAction: DiscordAction = {
        type: 'purgeMessages',
        payload: { guildId: 'guild-1', channelId: 'chan-1', amount: -5, reason: 'Test' },
      };
      await expect(runAction(mockGuild, negAmountAction)).rejects.toThrow(/purge amount must be an integer between 1 and 100/i);

      const overLimitAction: DiscordAction = {
        type: 'purgeMessages',
        payload: { guildId: 'guild-1', channelId: 'chan-1', amount: 101, reason: 'Test' },
      };
      await expect(runAction(mockGuild, overLimitAction)).rejects.toThrow(/purge amount must be an integer between 1 and 100/i);

      const nonIntAction: DiscordAction = {
        type: 'purgeMessages',
        payload: { guildId: 'guild-1', channelId: 'chan-1', amount: 25.5, reason: 'Test' },
      };
      await expect(runAction(mockGuild, nonIntAction)).rejects.toThrow(/purge amount must be an integer between 1 and 100/i);
    });

    test('rejects empty channelId via validator', async () => {
      const emptyChannelAction: DiscordAction = {
        type: 'purgeMessages',
        payload: { guildId: 'guild-1', channelId: '   ', amount: 10, reason: 'Test' },
      };
      await expect(runAction(mockGuild, emptyChannelAction)).rejects.toThrow(/channel id cannot be empty for purge/i);
    });

    test('rejects empty or whitespace reason via validator', async () => {
      const emptyReasonAction: DiscordAction = {
        type: 'purgeMessages',
        payload: { guildId: 'guild-1', channelId: 'chan-1', amount: 10, reason: '   ' },
      };
      await expect(runAction(mockGuild, emptyReasonAction)).rejects.toThrow(/purge reason cannot be empty/i);
    });

    test('rejects reason exceeding 512 characters via validator', async () => {
      const tooLongAction: DiscordAction = {
        type: 'purgeMessages',
        payload: { guildId: 'guild-1', channelId: 'chan-1', amount: 10, reason: 'a'.repeat(513) },
      };
      await expect(runAction(mockGuild, tooLongAction)).rejects.toThrow(/cannot exceed 512 characters/i);
    });
  });

  describe('applyPermissionTemplate Execution, Resolution, and Verification', () => {
    const guildId = '1544704957566033963';
    (mockGuild as any).id = guildId;
    (mockGuild.roles as any).everyone = { id: guildId, name: '@everyone' };

    function createChannelWithOverwrites(id: string, name: string, initialOverwrites: any[] = []) {
      const overwritesMap = new Map<string, any>();
      for (const ow of initialOverwrites) {
        overwritesMap.set(ow.id, {
          id: ow.id,
          allow: {
            has: (p: string) => ow.allow?.includes(p) ?? false,
            toArray: () => ow.allow ?? [],
          },
          deny: {
            has: (p: string) => ow.deny?.includes(p) ?? false,
            toArray: () => ow.deny ?? [],
          },
        });
      }

      const chan = {
        id,
        name,
        permissionOverwrites: {
          cache: overwritesMap,
          create: jest.fn().mockImplementation(async (targetId: string, options: Record<string, boolean>) => {
            const allow: string[] = [];
            const deny: string[] = [];
            for (const [perm, val] of Object.entries(options)) {
              if (val === true) allow.push(perm);
              if (val === false) deny.push(perm);
            }
            const existing = overwritesMap.get(targetId);
            const currentAllows = existing
              ? existing.allow.toArray().filter((p: string) => !deny.includes(p))
              : [];
            const currentDenies = existing
              ? existing.deny.toArray().filter((p: string) => !allow.includes(p))
              : [];
            for (const a of allow) {
              if (!currentAllows.includes(a)) currentAllows.push(a);
            }
            for (const d of deny) {
              if (!currentDenies.includes(d)) currentDenies.push(d);
            }
            overwritesMap.set(targetId, {
              id: targetId,
              allow: {
                has: (p: string) => currentAllows.includes(p),
                toArray: () => currentAllows,
              },
              deny: {
                has: (p: string) => currentDenies.includes(p),
                toArray: () => currentDenies,
              },
            });
          }),
        },
      };
      (mockGuild.channels.cache as any).set(id, chan);
      return chan;
    }

    test('1. Accepts valid Discord Snowflake role ID', async () => {
      const roleId = '1544750811207442532';
      (mockGuild.roles.cache as any).set(roleId, { id: roleId, name: 'CustomRole' });
      const chan = createChannelWithOverwrites('chan-snow', 'tech-chan');

      const action: DiscordAction = {
        type: 'applyPermissionTemplate',
        payload: {
          targetName: 'tech-chan',
          permissionOverwrites: [{ id: roleId, allow: ['ViewChannel'] }],
        },
      };

      const msg = await runAction(mockGuild, action);
      expect(msg).toBe('Applied permission template to "tech-chan".');
      expect(chan.permissionOverwrites.create).toHaveBeenCalledWith(roleId, { ViewChannel: true });
    });

    test('2. Resolves existing role by name case-insensitively', async () => {
      const roleId = '1544801399068434443';
      (mockGuild.roles.cache as any).set(roleId, { id: roleId, name: 'Tech & Engineering' });
      const chan = createChannelWithOverwrites('chan-named', 'tech-and-engineering');

      const action: DiscordAction = {
        type: 'applyPermissionTemplate',
        payload: {
          targetName: 'tech-and-engineering',
          permissionOverwrites: [{ id: 'tech & engineering', allow: ['ViewChannel', 'SendMessages'] }],
        },
      };

      const msg = await runAction(mockGuild, action);
      expect(msg).toBe('Applied permission template to "tech-and-engineering".');
      expect(chan.permissionOverwrites.create).toHaveBeenCalledWith(roleId, {
        ViewChannel: true,
        SendMessages: true,
      });
    });

    test('3. Resolves @everyone and everyone to guild everyone ID', async () => {
      const chan = createChannelWithOverwrites('chan-everyone', 'announcements');

      const action: DiscordAction = {
        type: 'applyPermissionTemplate',
        payload: {
          targetName: 'announcements',
          permissionOverwrites: [{ id: '@everyone', deny: ['SendMessages'] }],
        },
      };

      const msg = await runAction(mockGuild, action);
      expect(msg).toBe('Applied permission template to "announcements".');
      expect(chan.permissionOverwrites.create).toHaveBeenCalledWith(guildId, { SendMessages: false });
    });

    test('4. Safely rejects missing role names before making any mutations', async () => {
      const chan = createChannelWithOverwrites('chan-missing', 'general');

      const action: DiscordAction = {
        type: 'applyPermissionTemplate',
        payload: {
          targetName: 'general',
          permissionOverwrites: [{ id: 'NonExistentRole', allow: ['ViewChannel'] }],
        },
      };

      await expect(runAction(mockGuild, action)).rejects.toThrow(/Role "NonExistentRole" not found in this server/i);
      expect(chan.permissionOverwrites.create).not.toHaveBeenCalled();
    });

    test('5. Safely rejects ambiguous duplicate role names before making any mutations', async () => {
      (mockGuild.roles.cache as any).set('role-dup-1', { id: '111111111111111111', name: 'Duplicate' });
      (mockGuild.roles.cache as any).set('role-dup-2', { id: '222222222222222222', name: 'Duplicate' });
      const chan = createChannelWithOverwrites('chan-ambig', 'general');

      const action: DiscordAction = {
        type: 'applyPermissionTemplate',
        payload: {
          targetName: 'general',
          permissionOverwrites: [{ id: 'Duplicate', allow: ['ViewChannel'] }],
        },
      };

      await expect(runAction(mockGuild, action)).rejects.toThrow(/is ambiguous \(matched 2 roles\)/i);
      expect(chan.permissionOverwrites.create).not.toHaveBeenCalled();
    });

    test('6. Converts allow and deny arrays into discord.js v14 boolean options format', async () => {
      const roleId = '1544801399068434443';
      (mockGuild.roles.cache as any).set(roleId, { id: roleId, name: 'Law & Compliance' });
      const chan = createChannelWithOverwrites('chan-bool', 'legal-and-policy');

      const action: DiscordAction = {
        type: 'applyPermissionTemplate',
        payload: {
          targetName: 'legal-and-policy',
          permissionOverwrites: [
            {
              id: roleId,
              allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'],
              deny: ['CreateInstantInvite'],
            },
          ],
        },
      };

      await runAction(mockGuild, action);
      expect(chan.permissionOverwrites.create).toHaveBeenCalledWith(roleId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        CreateInstantInvite: false,
      });
    });

    test('7. Preserves existing unrelated permission overwrites on the channel', async () => {
      const unrelatedId = '333333333333333333';
      const roleId = '1544801399068434443';
      (mockGuild.roles.cache as any).set(roleId, { id: roleId, name: 'Creative & Design' });

      const chan = createChannelWithOverwrites('chan-preserve', 'creatives-lounge', [
        { id: unrelatedId, allow: ['AddReactions'], deny: [] },
      ]);

      const action: DiscordAction = {
        type: 'applyPermissionTemplate',
        payload: {
          targetName: 'creatives-lounge',
          permissionOverwrites: [{ id: roleId, allow: ['ViewChannel'] }],
        },
      };

      await runAction(mockGuild, action);

      // Unrelated overwrite remains intact in cache
      expect(chan.permissionOverwrites.cache.has(unrelatedId)).toBe(true);
      expect(chan.permissionOverwrites.cache.get(unrelatedId).allow.has('AddReactions')).toBe(true);
    });

    test('8. Preserves staff/bot access on role-gated channels (@everyone denied ViewChannel)', async () => {
      const founderId = '1544750811207442532';
      const teamId = '1544801399068434443';
      const modId = '1545398110359126066';
      const botRoleId = '1544800893860577360';
      const techRoleId = '1544802000000000001';

      (mockGuild.roles.cache as any).set(founderId, { id: founderId, name: 'Kosmo Founder' });
      (mockGuild.roles.cache as any).set(teamId, { id: teamId, name: 'Team Kosmo' });
      (mockGuild.roles.cache as any).set(modId, { id: modId, name: 'Moderator' });
      (mockGuild.roles.cache as any).set(botRoleId, { id: botRoleId, name: 'KosmoBot' });
      (mockGuild.roles.cache as any).set(techRoleId, { id: techRoleId, name: 'Tech & Engineering' });

      const chan = createChannelWithOverwrites('chan-gated', 'tech-and-engineering');

      const action: DiscordAction = {
        type: 'applyPermissionTemplate',
        payload: {
          targetName: 'tech-and-engineering',
          permissionOverwrites: [
            { id: '@everyone', deny: ['ViewChannel'] },
            { id: 'Tech & Engineering', allow: ['ViewChannel', 'SendMessages'] },
          ],
        },
      };

      await runAction(mockGuild, action);

      // Verify all staff roles were granted ViewChannel
      expect(chan.permissionOverwrites.cache.get(founderId).allow.has('ViewChannel')).toBe(true);
      expect(chan.permissionOverwrites.cache.get(teamId).allow.has('ViewChannel')).toBe(true);
      expect(chan.permissionOverwrites.cache.get(modId).allow.has('ViewChannel')).toBe(true);
      expect(chan.permissionOverwrites.cache.get(botRoleId).allow.has('ViewChannel')).toBe(true);
      expect(chan.permissionOverwrites.cache.get(guildId).deny.has('ViewChannel')).toBe(true);
    });

    test('9. Post-action verification succeeds when actual Discord state matches', async () => {
      const roleId = '1544801399068434443';
      (mockGuild.roles.cache as any).set(roleId, { id: roleId, name: 'Strategy' });
      createChannelWithOverwrites('chan-verify-ok', 'business-and-strategy');

      const action: DiscordAction = {
        type: 'applyPermissionTemplate',
        payload: {
          targetName: 'business-and-strategy',
          permissionOverwrites: [{ id: roleId, allow: ['ViewChannel', 'SendMessages'] }],
        },
      };

      const result = await runAction(mockGuild, action);
      expect(result).toBe('Applied permission template to "business-and-strategy".');
    });

    test('10. Post-action verification throws and does not report success on permission mismatch', async () => {
      const roleId = '1544801399068434443';
      (mockGuild.roles.cache as any).set(roleId, { id: roleId, name: 'Research' });

      // Create channel with broken mock create that fails to write permissions
      const brokenChan = {
        id: 'chan-mismatch',
        name: 'academia-and-research',
        permissionOverwrites: {
          cache: new Map(),
          create: jest.fn().mockImplementation(async (tId: string) => {
            // Broken write: saves empty permissions
            brokenChan.permissionOverwrites.cache.set(tId, {
              id: tId,
              allow: { has: () => false, toArray: () => [] },
              deny: { has: () => false, toArray: () => [] },
            });
          }),
        },
      };
      (mockGuild.channels.cache as any).set('chan-mismatch', brokenChan);

      const action: DiscordAction = {
        type: 'applyPermissionTemplate',
        payload: {
          targetName: 'academia-and-research',
          permissionOverwrites: [{ id: roleId, allow: ['ViewChannel'] }],
        },
      };

      await expect(runAction(mockGuild, action)).rejects.toThrow(
        /Post-action verification failed: Permission "ViewChannel" is not allowed/i
      );
    });

    test('11. Rejects role name accidentally supplied as targetName', async () => {
      const roleId = '1544801399068434443';
      (mockGuild.roles.cache as any).set(roleId, { id: roleId, name: 'Tech & Engineering' });

      // No channel named 'Tech & Engineering' exists
      const action: DiscordAction = {
        type: 'applyPermissionTemplate',
        payload: {
          targetName: 'Tech & Engineering',
          permissionOverwrites: [{ id: '@everyone', deny: ['ViewChannel'] }],
        },
      };

      await expect(runAction(mockGuild, action)).rejects.toThrow(
        /resolves to a role instead of a channel or category/i
      );
    });

    test('12. Executes channel target with role overwrite and handles # prefix', async () => {
      const roleId = '1544801399068434443';
      (mockGuild.roles.cache as any).set(roleId, { id: roleId, name: 'Tech & Engineering' });
      const chan = createChannelWithOverwrites('chan-hash', 'tech-and-engineering');

      const action: DiscordAction = {
        type: 'applyPermissionTemplate',
        payload: {
          targetName: '#tech-and-engineering',
          permissionOverwrites: [{ id: 'Tech & Engineering', allow: ['ViewChannel'] }],
        },
      };

      const res = await runAction(mockGuild, action);
      expect(res).toBe('Applied permission template to "#tech-and-engineering".');
      expect(chan.permissionOverwrites.create).toHaveBeenCalledWith(roleId, { ViewChannel: true });
    });

    test('13. Successfully applies all five Guild Discussion mappings with staff preservation', async () => {
      const staffRoles = [
        { id: '1544750811207442532', name: 'Kosmo Founder' },
        { id: '1544801399068434443', name: 'Team Kosmo' },
        { id: '1545398110359126066', name: 'Moderator' },
        { id: '1544800893860577360', name: 'KosmoBot' },
      ];
      for (const s of staffRoles) {
        (mockGuild.roles.cache as any).set(s.id, s);
      }

      const mappings = [
        { channel: 'tech-and-engineering', role: 'Tech & Engineering', roleId: '2001' },
        { channel: 'business-and-strategy', role: 'Business & Strategy', roleId: '2002' },
        { channel: 'academia-and-research', role: 'Academia & Education', roleId: '2003' },
        { channel: 'legal-and-policy', role: 'Law & Compliance', roleId: '2004' },
        { channel: 'creatives-lounge', role: 'Creative & Design', roleId: '2005' },
      ];

      for (const m of mappings) {
        (mockGuild.roles.cache as any).set(m.roleId, { id: m.roleId, name: m.role });
        const chan = createChannelWithOverwrites(`chan-${m.channel}`, m.channel);

        const action: DiscordAction = {
          type: 'applyPermissionTemplate',
          payload: {
            targetName: m.channel,
            permissionOverwrites: [
              { id: '@everyone', deny: ['ViewChannel'] },
              { id: m.role, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
            ],
          },
        };

        const result = await runAction(mockGuild, action);
        expect(result).toBe(`Applied permission template to "${m.channel}".`);

        // Channel target was used
        expect(chan.permissionOverwrites.cache.has(m.roleId)).toBe(true);
        expect(chan.permissionOverwrites.cache.get(m.roleId).allow.has('ViewChannel')).toBe(true);

        // All 4 staff roles preserved
        for (const s of staffRoles) {
          expect(chan.permissionOverwrites.cache.has(s.id)).toBe(true);
          expect(chan.permissionOverwrites.cache.get(s.id).allow.has('ViewChannel')).toBe(true);
        }
      }
    });

    test('14. Role-gated channel applies KosmoBot overwrite first and @everyone deny last to prevent self-lockout', async () => {
      const founderId = '1544750811207442532';
      const teamId = '1544801399068434443';
      const modId = '1545398110359126066';
      const botRoleId = '1544800893860577360';
      const techRoleId = '1544802000000000001';

      (mockGuild.roles.cache as any).set(founderId, { id: founderId, name: 'Kosmo Founder' });
      (mockGuild.roles.cache as any).set(teamId, { id: teamId, name: 'Team Kosmo' });
      (mockGuild.roles.cache as any).set(modId, { id: modId, name: 'Moderator' });
      (mockGuild.roles.cache as any).set(botRoleId, { id: botRoleId, name: 'KosmoBot' });
      (mockGuild.roles.cache as any).set(techRoleId, { id: techRoleId, name: 'Tech & Engineering' });

      const chan = createChannelWithOverwrites('chan-order-test', 'tech-and-engineering');
      const createOrder: string[] = [];
      const origCreate = chan.permissionOverwrites.create;
      chan.permissionOverwrites.create = jest.fn().mockImplementation(async (targetId: string, options: any) => {
        createOrder.push(targetId);
        return origCreate(targetId, options);
      });

      const action: DiscordAction = {
        type: 'applyPermissionTemplate',
        payload: {
          targetName: 'tech-and-engineering',
          permissionOverwrites: [
            { id: '@everyone', deny: ['ViewChannel'] },
            { id: 'Tech & Engineering', allow: ['ViewChannel', 'SendMessages'] },
          ],
        },
      };

      await runAction(mockGuild, action);

      // Verify KosmoBot is FIRST and @everyone is LAST
      expect(createOrder[0]).toBe(botRoleId);
      expect(createOrder[createOrder.length - 1]).toBe(guildId);

      // Verify full required order: KosmoBot -> Founder -> Team Kosmo -> Moderator -> Tech & Engineering -> @everyone
      expect(createOrder).toEqual([
        botRoleId,
        founderId,
        teamId,
        modId,
        techRoleId,
        guildId,
      ]);

            // Verify final state
      expect(chan.permissionOverwrites.cache.get(guildId).deny.has('ViewChannel')).toBe(true);
      expect(chan.permissionOverwrites.cache.get(botRoleId).allow.has('ViewChannel')).toBe(true);
      expect(chan.permissionOverwrites.cache.get(founderId).allow.has('ViewChannel')).toBe(true);
      expect(chan.permissionOverwrites.cache.get(teamId).allow.has('ViewChannel')).toBe(true);
      expect(chan.permissionOverwrites.cache.get(modId).allow.has('ViewChannel')).toBe(true);
      expect(chan.permissionOverwrites.cache.get(techRoleId).allow.has('ViewChannel')).toBe(true);
    });

    test('14b. Planner/caller dangerous input order (@everyone, target, Founder, Team, Mod, Bot) is not trusted and strictly reordered at execution time', async () => {
      const founderId = '1544750811207442532';
      const teamId = '1544801399068434443';
      const modId = '1545398110359126066';
      const botRoleId = '1544800893860577360';
      const lawRoleId = '1545692538780778588';
      const channelId = '1545692538780778587';

      (mockGuild.roles.cache as any).set(founderId, { id: founderId, name: 'Kosmo Founder' });
      (mockGuild.roles.cache as any).set(teamId, { id: teamId, name: 'Team Kosmo' });
      (mockGuild.roles.cache as any).set(modId, { id: modId, name: 'Moderator' });
      (mockGuild.roles.cache as any).set(botRoleId, { id: botRoleId, name: 'KosmoBot' });
      (mockGuild.roles.cache as any).set(lawRoleId, { id: lawRoleId, name: 'Law & Compliance' });

      const chan = createChannelWithOverwrites(channelId, 'legal-and-policy');
      const createOrder: string[] = [];
      const origCreate = chan.permissionOverwrites.create;
      chan.permissionOverwrites.create = jest.fn().mockImplementation(async (targetId: string, options: any) => {
        createOrder.push(targetId);
        return origCreate(targetId, options);
      });

      // Dangerous ordering from planner/user: @everyone first, then target role, then staff, then KosmoBot last
      const action: DiscordAction = {
        type: 'applyPermissionTemplate',
        payload: {
          targetName: channelId,
          permissionOverwrites: [
            { id: '@everyone', deny: ['ViewChannel'] },
            { id: 'Law & Compliance', allow: ['ViewChannel', 'SendMessages'] },
            { id: 'Kosmo Founder', allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
            { id: 'Team Kosmo', allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
            { id: 'Moderator', allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
            { id: 'KosmoBot', allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
          ],
        },
      };

      await runAction(mockGuild, action);

      // Verify payload was reordered
      expect(action.payload.permissionOverwrites[0].id).toBe('KosmoBot');
      expect(action.payload.permissionOverwrites[1].id).toBe('Kosmo Founder');
      expect(action.payload.permissionOverwrites[2].id).toBe('Team Kosmo');
      expect(action.payload.permissionOverwrites[3].id).toBe('Moderator');
      expect(action.payload.permissionOverwrites[4].id).toBe('Law & Compliance');
      expect(action.payload.permissionOverwrites[5].id).toBe('@everyone');

      // Verify Discord execution order was strictly enforced:
      // 1. KosmoBot, 2. Kosmo Founder, 3. Team Kosmo, 4. Moderator, 5. Law & Compliance, 6. @everyone
      expect(createOrder).toEqual([
        botRoleId,
        founderId,
        teamId,
        modId,
        lawRoleId,
        guildId,
      ]);
    });

    test('15. Normal public channels do not trigger role-gating reordering', async () => {
      const customRoleId = '1544802000000000099';
      (mockGuild.roles.cache as any).set(customRoleId, { id: customRoleId, name: 'CustomRole' });

      const chan = createChannelWithOverwrites('chan-public', 'announcements');
      const createOrder: string[] = [];
      const origCreate = chan.permissionOverwrites.create;
      chan.permissionOverwrites.create = jest.fn().mockImplementation(async (targetId: string, options: any) => {
        createOrder.push(targetId);
        return origCreate(targetId, options);
      });

      // Does NOT deny ViewChannel to @everyone
      const action: DiscordAction = {
        type: 'applyPermissionTemplate',
        payload: {
          targetName: 'announcements',
          permissionOverwrites: [
            { id: '@everyone', deny: ['SendMessages'] },
            { id: customRoleId, allow: ['SendMessages'] },
          ],
        },
      };

      await runAction(mockGuild, action);

      // Preserves original order as supplied
      expect(createOrder).toEqual([guildId, customRoleId]);
    });

    test('16. Discord 50001 Missing Access errors are surfaced with rich diagnostic context', async () => {
      const techRoleId = '1544802000000000001';
      (mockGuild.roles.cache as any).set(techRoleId, { id: techRoleId, name: 'Tech & Engineering' });

      const chan = createChannelWithOverwrites('chan-diag-test', 'tech-and-engineering');
      chan.permissionOverwrites.create = jest.fn().mockImplementation(async (targetId: string) => {
        const error: any = new Error('Missing Access');
        error.code = 50001;
        error.status = 403;
        throw error;
      });

      const action: DiscordAction = {
        type: 'applyPermissionTemplate',
        payload: {
          targetName: 'tech-and-engineering',
          permissionOverwrites: [
            { id: 'Tech & Engineering', allow: ['ViewChannel'] },
          ],
        },
      };

      try {
        await runAction(mockGuild, action);
        fail('Expected runAction to throw');
      } catch (err: any) {
        expect(err.message).toMatch(/\[action: applyPermissionTemplate\]/);
        expect(err.message).toMatch(/channel "tech-and-engineering"/);
        expect(err.message).toMatch(/ID: chan-diag-test/);
        expect(err.message).toMatch(/target "Tech & Engineering"/);
        expect(err.message).toMatch(/Discord API error 50001/);
        expect(err.message).toMatch(/HTTP 403/);
        expect(err.message).toMatch(/Missing Access/);
      }
    });

    test('17. Role-gated channel preserves unrelated existing overwrites', async () => {
      const techRoleId = '1544802000000000001';
      const unrelatedRoleId = '999999999999999999';
      (mockGuild.roles.cache as any).set(techRoleId, { id: techRoleId, name: 'Tech & Engineering' });
      (mockGuild.roles.cache as any).set(unrelatedRoleId, { id: unrelatedRoleId, name: 'External Partner' });

      const chan = createChannelWithOverwrites('chan-unrelated-test', 'tech-and-engineering');

      // Seed an unrelated overwrite on the channel
      const unrelatedAllow = new Set(['AddReactions']);
      const unrelatedDeny = new Set(['AttachFiles']);
      chan.permissionOverwrites.cache.set(unrelatedRoleId, {
        id: unrelatedRoleId,
        allow: {
          has: (perm: string) => unrelatedAllow.has(perm),
          toArray: () => Array.from(unrelatedAllow),
        },
        deny: {
          has: (perm: string) => unrelatedDeny.has(perm),
          toArray: () => Array.from(unrelatedDeny),
        },
      });

      const action: DiscordAction = {
        type: 'applyPermissionTemplate',
        payload: {
          targetName: 'tech-and-engineering',
          permissionOverwrites: [
            { id: '@everyone', deny: ['ViewChannel'] },
            { id: 'Tech & Engineering', allow: ['ViewChannel', 'SendMessages'] },
          ],
        },
      };

      await runAction(mockGuild, action);

            // Verify the unrelated overwrite still exists and was not corrupted
      const existingUnrelated = chan.permissionOverwrites.cache.get(unrelatedRoleId);
      expect(existingUnrelated).toBeDefined();
      expect(existingUnrelated.allow.has('AddReactions')).toBe(true);
      expect(existingUnrelated.deny.has('AttachFiles')).toBe(true);
    });

    test('16. Normalized channel resolution resolves emoji-prefixed channel names for all five Guild Discussion channels', async () => {
      const staffRoles = [
        { id: '1544750811207442532', name: 'Kosmo Founder' },
        { id: '1544801399068434443', name: 'Team Kosmo' },
        { id: '1545398110359126066', name: 'Moderator' },
        { id: '1544800893860577360', name: 'KosmoBot' },
      ];
      for (const s of staffRoles) {
        (mockGuild.roles.cache as any).set(s.id, s);
      }

      const discussionChannels = [
        { emojiName: '💻・tech-and-engineering', target: 'tech-and-engineering', role: 'Tech & Engineering', roleId: '3001', chanId: 'chan-3001' },
        { emojiName: '📈・business-and-strategy', target: 'business-and-strategy', role: 'Business & Strategy', roleId: '3002', chanId: 'chan-3002' },
        { emojiName: '🎓・academia-and-research', target: 'academia-and-research', role: 'Academia & Education', roleId: '3003', chanId: 'chan-3003' },
        { emojiName: '⚖️・legal-and-policy', target: 'legal-and-policy', role: 'Law & Compliance', roleId: '3004', chanId: 'chan-3004' },
        { emojiName: '🎨・creatives-lounge', target: 'creatives-lounge', role: 'Creative & Design', roleId: '3005', chanId: 'chan-3005' },
      ];

      for (const d of discussionChannels) {
        (mockGuild.roles.cache as any).set(d.roleId, { id: d.roleId, name: d.role });
        const chan = createChannelWithOverwrites(d.chanId, d.emojiName);

        const action: DiscordAction = {
          type: 'applyPermissionTemplate',
          payload: {
            targetName: d.target,
            permissionOverwrites: [
              { id: '@everyone', deny: ['ViewChannel'] },
              { id: d.role, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
            ],
          },
        };

        const result = await runAction(mockGuild, action);
        expect(result).toBe(`Applied permission template to "${d.target}".`);

        // Applied to actual Discord channel ID
        expect(chan.permissionOverwrites.cache.has(d.roleId)).toBe(true);
        expect(chan.permissionOverwrites.cache.get(d.roleId).allow.has('ViewChannel')).toBe(true);

        // All 4 staff roles preserved
        for (const s of staffRoles) {
          expect(chan.permissionOverwrites.cache.has(s.id)).toBe(true);
          expect(chan.permissionOverwrites.cache.get(s.id).allow.has('ViewChannel')).toBe(true);
        }
      }
    });

    test('17. Rejects targetName "academia-and-education" when channel is "🎓・academia-and-research" and role is "Academia & Education"', async () => {
      const roleId = '3003';
      (mockGuild.roles.cache as any).set(roleId, { id: roleId, name: 'Academia & Education' });
      createChannelWithOverwrites('chan-acad-test', '🎓・academia-and-research');

      const action: DiscordAction = {
        type: 'applyPermissionTemplate',
        payload: {
          targetName: 'academia-and-education',
          permissionOverwrites: [
            { id: '@everyone', deny: ['ViewChannel'] },
            { id: 'Academia & Education', allow: ['ViewChannel', 'SendMessages'] },
          ],
        },
      };

      await expect(runAction(mockGuild, action)).rejects.toThrow(
        /Target "academia-and-education" resolves to a role instead of a channel or category/i
      );
    });

    test('18. Case-insensitive channel and role matching', async () => {
      const roleId = '4001';
      (mockGuild.roles.cache as any).set(roleId, { id: roleId, name: 'Academia & Education' });
      const chan = createChannelWithOverwrites('chan-case-test', '🎓・academia-and-research');

      const action: DiscordAction = {
        type: 'applyPermissionTemplate',
        payload: {
          targetName: 'ACADEMIA-AND-RESEARCH', // uppercase channel target
          permissionOverwrites: [
            { id: '@everyone', deny: ['ViewChannel'] },
            { id: 'academia & education', allow: ['ViewChannel', 'SendMessages'] }, // lowercase role target
          ],
        },
      };

      const result = await runAction(mockGuild, action);
      expect(result).toBe('Applied permission template to "ACADEMIA-AND-RESEARCH".');
      expect(chan.permissionOverwrites.cache.has(roleId)).toBe(true);
      expect(chan.permissionOverwrites.cache.get(roleId).allow.has('ViewChannel')).toBe(true);
    });

    test('19. Rejects role names supplied as targetName', async () => {
      (mockGuild.roles.cache as any).set('5001', { id: '5001', name: 'Tech & Engineering' });
      (mockGuild.roles.cache as any).set('5002', { id: '5002', name: 'Founder' });
      createChannelWithOverwrites('chan-role-target', 'tech-and-engineering');

      const actionRoleName: DiscordAction = {
        type: 'applyPermissionTemplate',
        payload: {
          targetName: 'Tech & Engineering',
          permissionOverwrites: [{ id: '@everyone', deny: ['ViewChannel'] }],
        },
      };

      await expect(runAction(mockGuild, actionRoleName)).rejects.toThrow(
        /resolves to a role instead of a channel or category/i
      );

      const actionFounder: DiscordAction = {
        type: 'applyPermissionTemplate',
        payload: {
          targetName: 'Founder',
          permissionOverwrites: [{ id: '@everyone', deny: ['ViewChannel'] }],
        },
      };

      await expect(runAction(mockGuild, actionFounder)).rejects.toThrow(
        /resolves to a role instead of a channel or category/i
      );
    });

    test('20. Normalized matching fails safely as ambiguous when multiple channels normalize to same target', async () => {
      createChannelWithOverwrites('chan-ambig-1', '🎓・academia-and-research');
      createChannelWithOverwrites('chan-ambig-2', '📚・academia-and-research');

      const action: DiscordAction = {
        type: 'applyPermissionTemplate',
        payload: {
          targetName: 'academia-and-research',
          permissionOverwrites: [{ id: '@everyone', deny: ['ViewChannel'] }],
        },
      };

      await expect(runAction(mockGuild, action)).rejects.toThrow(/ambiguous/i);
    });

    test('21. Exact channel match takes precedence over normalized match', async () => {
      const roleId = '6001';
      (mockGuild.roles.cache as any).set(roleId, { id: roleId, name: 'Tech & Engineering' });

      const exactChan = createChannelWithOverwrites('chan-exact', 'tech-and-engineering');
      const emojiChan = createChannelWithOverwrites('chan-emoji', '💻・tech-and-engineering');

      const action: DiscordAction = {
        type: 'applyPermissionTemplate',
        payload: {
          targetName: 'tech-and-engineering',
          permissionOverwrites: [
            { id: '@everyone', deny: ['ViewChannel'] },
            { id: 'Tech & Engineering', allow: ['ViewChannel'] },
          ],
        },
      };

      await runAction(mockGuild, action);

      // Overwrite must be on exactChan, not emojiChan
      expect(exactChan.permissionOverwrites.cache.has(roleId)).toBe(true);
      expect(emojiChan.permissionOverwrites.cache.has(roleId)).toBe(false);
    });
  });
});