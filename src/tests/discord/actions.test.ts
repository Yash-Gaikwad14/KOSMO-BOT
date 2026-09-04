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
});
