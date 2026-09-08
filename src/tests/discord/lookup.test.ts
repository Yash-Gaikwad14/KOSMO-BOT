// src/tests/discord/lookup.test.ts

import { Guild, Role, GuildChannel, CategoryChannel, ChannelType } from 'discord.js';
import {
  findRole,
  findChannel,
  findCategory,
  normalizeChannelName,
  slugify,
} from '../../services/discord/lookup';

describe('H-03: Discord Lookup Cache Optimization & Precision', () => {
  const createMockRole = (id: string, name: string): Role =>
    ({
      id,
      name,
    } as unknown as Role);

  const createMockChannel = (id: string, name: string, type: ChannelType = ChannelType.GuildText): GuildChannel =>
    ({
      id,
      name,
      type,
    } as unknown as GuildChannel);

  const createMockCategory = (id: string, name: string): CategoryChannel =>
    ({
      id,
      name,
      type: ChannelType.GuildCategory,
    } as unknown as CategoryChannel);

  let mockGuild: Guild;
  let rolesMap: Map<string, Role>;
  let channelsMap: Map<string, GuildChannel>;

  beforeEach(() => {
    rolesMap = new Map<string, Role>([
      ['role-101', createMockRole('role-101', 'Founder')],
      ['role-102', createMockRole('role-102', 'Tech & Engineering')],
      ['role-103', createMockRole('role-103', 'Academia & Education')],
      ['role-104', createMockRole('role-104', 'Creative & Design')],
      ['role-105', createMockRole('role-105', 'Moderator')],
    ]);

    channelsMap = new Map<string, GuildChannel>([
      ['chan-201', createMockChannel('chan-201', 'announcements')],
      ['chan-202', createMockChannel('chan-202', 'tech-and-engineering')],
      ['chan-203', createMockChannel('chan-203', '🎓・academia-and-research')],
      ['chan-204', createMockChannel('chan-204', '💻 | dev-chat')],
      ['cat-301', createMockCategory('cat-301', 'COMMUNITY HUBS')],
      ['cat-302', createMockCategory('cat-302', '🎯・GUILD DISCUSSIONS')],
    ]);

    mockGuild = {
      roles: {
        cache: rolesMap,
      },
      channels: {
        cache: channelsMap,
      },
    } as unknown as Guild;
  });

  describe('findRole', () => {
    test('1. direct O(1) Snowflake ID lookup uses cache.get without iteration', () => {
      const getSpy = jest.spyOn(rolesMap, 'get');
      const valuesSpy = jest.spyOn(rolesMap, 'values');

      const role = findRole(mockGuild, 'role-101');
      expect(role).toBeDefined();
      expect(role?.id).toBe('role-101');
      expect(role?.name).toBe('Founder');

      // Crucial H-03 check: ID match must resolve immediately via .get() without scanning values()
      expect(getSpy).toHaveBeenCalledWith('role-101');
      expect(valuesSpy).not.toHaveBeenCalled();
    });

    test('2. exact role name match succeeds', () => {
      const role = findRole(mockGuild, 'Founder');
      expect(role).toBeDefined();
      expect(role?.id).toBe('role-101');
    });

    test('3. case-insensitive role name match succeeds', () => {
      const role = findRole(mockGuild, 'founder');
      expect(role).toBeDefined();
      expect(role?.id).toBe('role-101');

      const mod = findRole(mockGuild, 'MODERATOR');
      expect(mod).toBeDefined();
      expect(mod?.id).toBe('role-105');
    });

    test('4. role slug matching succeeds', () => {
      const role = findRole(mockGuild, 'academia-and-education');
      expect(role).toBeDefined();
      expect(role?.id).toBe('role-103');
      expect(role?.name).toBe('Academia & Education');
    });

    test('5. missing role returns null safely', () => {
      expect(findRole(mockGuild, 'nonexistent-role')).toBeNull();
      expect(findRole(mockGuild, '')).toBeNull();
    });

    test('6. ambiguous role name throws informative error', () => {
      rolesMap.set('role-999', createMockRole('role-999', 'Founder'));
      expect(() => findRole(mockGuild, 'Founder')).toThrow(/ambiguous/i);
    });
  });

  describe('findChannel', () => {
    test('1. direct O(1) Snowflake ID lookup uses cache.get without iteration', () => {
      const getSpy = jest.spyOn(channelsMap, 'get');
      const valuesSpy = jest.spyOn(channelsMap, 'values');

      const channel = findChannel(mockGuild, 'chan-201');
      expect(channel).toBeDefined();
      expect(channel?.id).toBe('chan-201');
      expect(channel?.name).toBe('announcements');

      // Crucial H-03 check: ID match must resolve immediately via .get() without scanning values()
      expect(getSpy).toHaveBeenCalledWith('chan-201');
      expect(valuesSpy).not.toHaveBeenCalled();
    });

    test('2. exact channel name with leading # stripped matches', () => {
      const channel = findChannel(mockGuild, '#announcements');
      expect(channel).toBeDefined();
      expect(channel?.id).toBe('chan-201');
    });

    test('3. case-insensitive channel name matches', () => {
      const channel = findChannel(mockGuild, 'TECH-AND-ENGINEERING');
      expect(channel).toBeDefined();
      expect(channel?.id).toBe('chan-202');
    });

    test('4. normalized channel name strips emojis and decorative separators', () => {
      const channel = findChannel(mockGuild, 'academia-and-research');
      expect(channel).toBeDefined();
      expect(channel?.id).toBe('chan-203');

      const devChat = findChannel(mockGuild, 'dev-chat');
      expect(devChat).toBeDefined();
      expect(devChat?.id).toBe('chan-204');
    });

    test('5. ambiguous channel match throws informative error', () => {
      channelsMap.set('chan-999', createMockChannel('chan-999', 'announcements'));
      expect(() => findChannel(mockGuild, 'announcements')).toThrow(/ambiguous/i);
    });
  });

  describe('findCategory', () => {
    test('1. direct O(1) Snowflake ID lookup uses cache.get without iteration', () => {
      const getSpy = jest.spyOn(channelsMap, 'get');
      const valuesSpy = jest.spyOn(channelsMap, 'values');

      const cat = findCategory(mockGuild, 'cat-301');
      expect(cat).toBeDefined();
      expect(cat?.id).toBe('cat-301');
      expect(cat?.name).toBe('COMMUNITY HUBS');

      // Crucial H-03 check: ID match must resolve immediately via .get() without scanning values()
      expect(getSpy).toHaveBeenCalledWith('cat-301');
      expect(valuesSpy).not.toHaveBeenCalled();
    });

    test('2. exact category name match succeeds', () => {
      const cat = findCategory(mockGuild, 'COMMUNITY HUBS');
      expect(cat).toBeDefined();
      expect(cat?.id).toBe('cat-301');
    });

    test('3. normalized category name with emoji/decorative prefix matches', () => {
      const cat = findCategory(mockGuild, 'GUILD DISCUSSIONS');
      expect(cat).toBeDefined();
      expect(cat?.id).toBe('cat-302');
    });

    test('4. non-category channel ID returns null safely', () => {
      const nonCat = findCategory(mockGuild, 'chan-201'); // text channel
      expect(nonCat).toBeNull();
    });
  });
});
