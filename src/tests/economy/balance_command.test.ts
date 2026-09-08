import path from 'path';
import { Collection } from 'discord.js';
import execute, { data } from '../../commands/economy/balance';
import { loadCommands } from '../../commands/loader';
import * as balanceService from '../../services/economy/balanceService';

jest.mock('../../services/economy/balanceService');

describe('/balance Slash Command', () => {
  const HIGH_KARMA_ROLE_ID = '999888777666555';

  function createMockInteraction(options: {
    guildId?: string | null;
    userId?: string;
    username?: string;
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
        username: options.username || 'TestUser',
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
    test('registers as /balance with correct metadata', () => {
      expect(data.name).toBe('balance');
      expect(data.description).toBe('View your Sparks balance, tier, and daily claim status');
      expect(data.options).toHaveLength(0);
    });

    test('is automatically discovered by command loader', async () => {
      const commandsRoot = path.resolve(__dirname, '../../commands');
      const loaded = await loadCommands(commandsRoot);
      expect(loaded.has('balance')).toBe(true);

      const entry = loaded.get('balance');
      expect(entry?.data.name).toBe('balance');
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
      expect(balanceService.getUserBalanceInfo).not.toHaveBeenCalled();
    });
  });

  describe('Balance Rendering', () => {
    test('renders standard tier embed with cash, bank, total, and daily ready status', async () => {
      (balanceService.getUserBalanceInfo as jest.Mock).mockResolvedValueOnce({
        success: true,
        balance: {
          cash: 1200,
          bank: 5000,
          total: 6200,
        },
        isHighKarma: false,
        dailyEligible: true,
      });

      const interaction = createMockInteraction({
        guildId: 'guild-123',
        userId: 'user-std',
        username: 'StandardUser',
        roles: ['standard-role'],
      });

      await execute(interaction);

      expect(balanceService.getUserBalanceInfo).toHaveBeenCalledWith(
        'user-std',
        'guild-123',
        ['standard-role']
      );

      const reply = interaction.getReplyData();
      expect(reply.ephemeral).toBe(true);
      expect(reply.embeds).toHaveLength(1);

      const embed = reply.embeds[0].data;
      expect(embed.title).toContain('Sparks Balance — StandardUser');
      expect(embed.fields[0].value).toContain('1,200 Sparks'); // Cash
      expect(embed.fields[1].value).toContain('5,000 Sparks'); // Bank
      expect(embed.fields[2].value).toContain('6,200 Sparks'); // Total
      expect(embed.fields[3].value).toContain('Standard Tier'); // Tier
      expect(embed.fields[4].value).toContain('Ready to claim now'); // Daily
    });

    test('renders High-Karma tier embed with gold styling and daily claim on cooldown', async () => {
      const nextClaim = new Date(Date.now() + 12 * 3600 * 1000);
      (balanceService.getUserBalanceInfo as jest.Mock).mockResolvedValueOnce({
        success: true,
        balance: {
          cash: 10000,
          bank: 25000,
          total: 35000,
        },
        isHighKarma: true,
        dailyEligible: false,
        dailyNextClaimAt: nextClaim,
      });

      const interaction = createMockInteraction({
        guildId: 'guild-123',
        userId: 'user-hk',
        username: 'HighKarmaUser',
        roles: [HIGH_KARMA_ROLE_ID],
      });

      await execute(interaction);

      const reply = interaction.getReplyData();
      const embed = reply.embeds[0].data;
      expect(embed.title).toContain('Sparks Balance — HighKarmaUser');
      expect(embed.color).toBe(0xf1c40f); // Gold
      expect(embed.fields[3].value).toContain('High-Karma Tier');
      expect(embed.fields[4].value).toContain('Already claimed');
    });

    test('renders query cooldown embed when user checks balance too quickly', async () => {
      (balanceService.getUserBalanceInfo as jest.Mock).mockResolvedValueOnce({
        success: false,
        onCooldown: true,
        remainingMs: 7500,
        isHighKarma: false,
        dailyEligible: false,
        message: 'You are checking balance too quickly. Please wait 8s before querying again.',
      });

      const interaction = createMockInteraction({
        guildId: 'guild-123',
        userId: 'user-cooldown',
      });

      await execute(interaction);

      const reply = interaction.getReplyData();
      expect(reply.ephemeral).toBe(true);

      const embed = reply.embeds[0].data;
      expect(embed.title).toContain('Balance Query Cooldown');
      expect(embed.description).toContain('8s');
    });

    test('renders failure embed safely when balance lookup fails', async () => {
      (balanceService.getUserBalanceInfo as jest.Mock).mockResolvedValueOnce({
        success: false,
        onCooldown: false,
        isHighKarma: false,
        dailyEligible: true,
        error: 'ECONNRESET',
      });

      const interaction = createMockInteraction({
        guildId: 'guild-123',
        userId: 'user-fail',
      });

      await execute(interaction);

      const reply = interaction.getReplyData();
      expect(reply.ephemeral).toBe(true);

      const embed = reply.embeds[0].data;
      expect(embed.title).toBe('❌ Balance Lookup Failed');
      expect(embed.description).toContain('economy provider');
    });
  });
});
