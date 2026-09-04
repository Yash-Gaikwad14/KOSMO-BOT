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
  },
  members: {
    fetch: jest.fn().mockResolvedValue({
      roles: { cache: new Map(), add: jest.fn().mockResolvedValue(undefined) },
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
});
