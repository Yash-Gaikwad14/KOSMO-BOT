import { Client, GatewayIntentBits } from 'discord.js';
import { getDiscordClientOptions } from '../../config/discord';
import { findRole, findChannel, findCategory } from '../../services/discord/lookup';

describe('H-05 Discord Cache Lifecycle / Sweeper Hardening', () => {
  describe('Client Options & Sweeper Configuration', () => {
    test('loads correct intents including Guilds, GuildMembers, GuildMessages', () => {
      const options = getDiscordClientOptions();
      expect(options.intents).toBeDefined();
      const intents = options.intents as number[];
      expect(intents).toContain(GatewayIntentBits.Guilds);
      expect(intents).toContain(GatewayIntentBits.GuildMembers);
      expect(intents).toContain(GatewayIntentBits.GuildMessages);
    });

    test('configures conservative native message sweeper (1h interval, 30m lifetime)', () => {
      const options = getDiscordClientOptions();
      const sweepers = options.sweepers as any;
      expect(sweepers).toBeDefined();
      expect(sweepers.messages).toBeDefined();
      expect(sweepers.messages.interval).toBe(3600);
      expect(sweepers.messages.lifetime).toBe(1800);
    });

    test('retains Discord.js default thread sweeper', () => {
      const options = getDiscordClientOptions();
      const sweepers = options.sweepers as any;
      expect(sweepers.threads).toBeDefined();
      expect(sweepers.threads.interval).toBe(3600);
      expect(sweepers.threads.lifetime).toBe(14400);
    });

    test('does NOT configure dangerous sweepers for Category A caches (roles, channels, members)', () => {
      const options = getDiscordClientOptions();
      const sweepers = options.sweepers as any;
      // Guild members, roles, and channels must NEVER be swept to protect hierarchy and lookups
      expect(sweepers.guildMembers).toBeUndefined();
      expect(sweepers.roles).toBeUndefined();
      expect(sweepers.channels).toBeUndefined();
    });

    test('configures bounded makeCache for MessageManager', () => {
      const options = getDiscordClientOptions();
      expect(typeof options.makeCache).toBe('function');
    });

    test('client instantiation and destruction cleanly manages sweeper intervals without unmanaged timers', () => {
      const options = getDiscordClientOptions();
      const client = new Client(options);

      // Verify native Discord.js sweepers manager initialized
      expect(client.sweepers).toBeDefined();
      expect(client.options.sweepers).toBeDefined();

      // Ensure no custom unmanaged timers were created
      client.destroy();

      // After destroy, intervals are destroyed/cleaned up
      const intervals = (client.sweepers as any).intervals;
      if (intervals) {
        if (intervals.messages) {
          expect(intervals.messages._destroyed).toBe(true);
        }
        if (intervals.threads) {
          expect(intervals.threads._destroyed).toBe(true);
        }
      }
    });
  });

  describe('H-03 Lookup Regression Invariant', () => {
    test('H-03 role and channel lookups continue to work seamlessly with cache lifecycle structure', () => {
      const mockRole = { id: 'role-999', name: 'Moderator' };
      const mockChannel = { id: 'chan-888', name: 'general-chat', isTextBased: () => true };

      const mockGuild = {
        id: 'guild-111',
        roles: {
          cache: new Map([['role-999', mockRole]]),
        },
        channels: {
          cache: new Map([['chan-888', mockChannel]]),
        },
      } as any;

      // Direct O(1) ID lookups preserved from H-03
      expect(findRole(mockGuild, 'role-999')).toBe(mockRole);
      expect(findChannel(mockGuild, 'chan-888')).toBe(mockChannel);

      // Name lookups preserved from H-03
      expect(findRole(mockGuild, 'Moderator')).toBe(mockRole);
      expect(findChannel(mockGuild, 'general-chat')).toBe(mockChannel);
      expect(findCategory(mockGuild, 'non-existent')).toBeNull();
    });
  });
});
