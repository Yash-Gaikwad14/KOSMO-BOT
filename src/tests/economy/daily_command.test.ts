import path from 'path';
import { Collection } from 'discord.js';
import execute, { data } from '../../commands/economy/daily';
import { loadCommands } from '../../commands/loader';
import * as dailyService from '../../services/economy/dailyService';

jest.mock('../../services/economy/dailyService');

describe('/daily Slash Command', () => {
  const HIGH_KARMA_ROLE_ID = '999888777666555';

  function createMockInteraction(options: {
    guildId?: string | null;
    userId?: string;
    roles?: string[];
  }) {
    let replyPayload: any = null;
    let followUpPayload: any = null;

    const roleMap = new Collection<string, any>();
    (options.roles || []).forEach((r) => roleMap.set(r, { id: r, name: r }));

    const interaction: any = {
      guildId: options.guildId !== undefined ? options.guildId : 'guild-123',
      user: {
        id: options.userId || 'user-100',
        username: 'TestUser',
      },
      member: {
        roles: {
          cache: roleMap,
        },
      },
      replied: false,
      deferred: false,
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

    return interaction;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Command Registration & Loader Discovery', () => {
    test('registers as /daily with correct metadata', () => {
      expect(data.name).toBe('daily');
      expect(data.description).toBe('Claim your daily Sparks allowance');
      expect(data.options).toHaveLength(0); // No arguments needed
    });

    test('is automatically discovered by command loader', async () => {
      const commandsRoot = path.resolve(__dirname, '../../commands');
      const loaded = await loadCommands(commandsRoot);
      expect(loaded.has('daily')).toBe(true);

      const entry = loaded.get('daily');
      expect(entry?.data.name).toBe('daily');
      expect(typeof entry?.default).toBe('function');
    });
  });

  describe('Guild-Only Guard', () => {
    test('rejects execution outside a server (e.g. DM)', async () => {
      const interaction = createMockInteraction({ guildId: null });

      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❌ This command can only be used in a server.',
        ephemeral: true,
      });
      expect(dailyService.claimDaily).not.toHaveBeenCalled();
    });
  });

  describe('Claim Execution Handling', () => {
    test('renders standard tier success embed for normal members (+500 Sparks)', async () => {
      const nextClaim = new Date(Date.now() + 24 * 3600 * 1000);
      (dailyService.claimDaily as jest.Mock).mockResolvedValueOnce({
        success: true,
        sparksAwarded: 500,
        isHighKarma: false,
        nextClaimAt: nextClaim,
        message: 'Daily sparks claimed',
      });

      const interaction = createMockInteraction({
        guildId: 'guild-123',
        userId: 'user-standard',
        roles: ['standard-role'],
      });

      await execute(interaction);

      expect(dailyService.claimDaily).toHaveBeenCalledWith(
        'user-standard',
        'guild-123',
        ['standard-role']
      );

      const reply = interaction.getReplyData();
      expect(reply.embeds).toHaveLength(1);

      const embed = reply.embeds[0].data;
      expect(embed.title).toBe('🪙 Daily Sparks Claimed (Standard Tier)');
      expect(embed.description).toContain('+500 Sparks');
      expect(embed.fields[0].value).toContain('+500 Sparks');
      expect(embed.fields[1].value).toContain('Standard');
    });

    test('renders High-Karma tier success embed for High-Karma members (+2,000 Sparks)', async () => {
      const nextClaim = new Date(Date.now() + 24 * 3600 * 1000);
      (dailyService.claimDaily as jest.Mock).mockResolvedValueOnce({
        success: true,
        sparksAwarded: 2000,
        isHighKarma: true,
        nextClaimAt: nextClaim,
        message: 'Daily sparks claimed',
      });

      const interaction = createMockInteraction({
        guildId: 'guild-123',
        userId: 'user-karma',
        roles: [HIGH_KARMA_ROLE_ID],
      });

      await execute(interaction);

      expect(dailyService.claimDaily).toHaveBeenCalledWith(
        'user-karma',
        'guild-123',
        [HIGH_KARMA_ROLE_ID]
      );

      const reply = interaction.getReplyData();
      const embed = reply.embeds[0].data;
      expect(embed.title).toBe('⚡ Daily Sparks Claimed (High-Karma Tier)');
      expect(embed.description).toContain('+2,000 Sparks');
      expect(embed.fields[0].value).toContain('+2,000 Sparks');
      expect(embed.fields[1].value).toContain('High-Karma');
    });

    test('renders cooldown embed when user is on cooldown', async () => {
      const nextClaim = new Date(Date.now() + 18 * 3600 * 1000);
      (dailyService.claimDaily as jest.Mock).mockResolvedValueOnce({
        success: false,
        onCooldown: true,
        sparksAwarded: 0,
        isHighKarma: false,
        nextClaimAt: nextClaim,
        remainingMs: 18 * 3600 * 1000,
        message: 'Already claimed',
      });

      const interaction = createMockInteraction({
        guildId: 'guild-123',
        userId: 'user-cooldown',
      });

      await execute(interaction);

      const reply = interaction.getReplyData();
      expect(reply.ephemeral).toBe(true);

      const embed = reply.embeds[0].data;
      expect(embed.title).toBe('⏳ Daily Sparks Cooldown');
      expect(embed.description).toContain('already claimed');
      expect(embed.fields[0].name).toBe('Next Claim Available');
    });

    test('renders failure embed when economy synchronization fails', async () => {
      (dailyService.claimDaily as jest.Mock).mockResolvedValueOnce({
        success: false,
        onCooldown: false,
        sparksAwarded: 0,
        isHighKarma: false,
        error: 'API 500 error',
        message: 'Encountered issue',
      });

      const interaction = createMockInteraction({
        guildId: 'guild-123',
        userId: 'user-fail',
      });

      await execute(interaction);

      const reply = interaction.getReplyData();
      expect(reply.ephemeral).toBe(true);

      const embed = reply.embeds[0].data;
      expect(embed.title).toBe('❌ Economy Synchronization Failed');
      expect(embed.description).toContain('not consumed');
    });
  });
});
