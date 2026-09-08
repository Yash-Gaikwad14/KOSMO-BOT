import path from 'path';
import { Collection } from 'discord.js';
import execute, { data } from '../../commands/economy/leaderboard';
import { loadCommands } from '../../commands/loader';
import * as leaderboardService from '../../services/economy/leaderboardService';

jest.mock('../../services/economy/leaderboardService');

describe('/leaderboard Slash Command', () => {
  function createMockInteraction(options: {
    guildId?: string | null;
    userId?: string;
    username?: string;
    sort?: string | null;
    page?: number | null;
  }) {
    let replyPayload: any = null;
    let followUpPayload: any = null;

    const interaction: any = {
      guildId: options.guildId !== undefined ? options.guildId : 'guild-123',
      user: {
        id: options.userId || 'user-100',
        username: options.username || 'TestUser',
      },
      options: {
        getString: jest.fn().mockImplementation((name: string) => {
          if (name === 'sort') return options.sort ?? null;
          return null;
        }),
        getInteger: jest.fn().mockImplementation((name: string) => {
          if (name === 'page') return options.page ?? null;
          return null;
        }),
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
    test('registers as /leaderboard with correct options', () => {
      expect(data.name).toBe('leaderboard');
      expect(data.description).toBe('View the server Sparks economy leaderboard');
      expect(data.options).toHaveLength(2); // sort and page
    });

    test('is automatically discovered by command loader', async () => {
      const commandsRoot = path.resolve(__dirname, '../../commands');
      const loaded = await loadCommands(commandsRoot);
      expect(loaded.has('leaderboard')).toBe(true);

      const entry = loaded.get('leaderboard');
      expect(entry?.data.name).toBe('leaderboard');
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
      expect(leaderboardService.getLeaderboard).not.toHaveBeenCalled();
    });
  });

  describe('Leaderboard Rendering', () => {
    test('renders public response with medal formatting for total sparks sort', async () => {
      (leaderboardService.getLeaderboard as jest.Mock).mockResolvedValueOnce({
        success: true,
        sort: 'total',
        page: 1,
        totalPages: 3,
        entries: [
          { rank: 1, userId: '111111111111111111', cash: 5000, bank: 15000, total: 20000 },
          { rank: 2, userId: '222222222222222222', cash: 3000, bank: 7000, total: 10000 },
          { rank: 3, userId: '333333333333333333', cash: 1000, bank: 4000, total: 5000 },
          { rank: 4, userId: '444444444444444444', cash: 500, bank: 500, total: 1000 },
        ],
      });

      const interaction = createMockInteraction({
        guildId: 'guild-123',
        userId: 'user-caller',
        sort: 'total',
        page: 1,
      });

      await execute(interaction);

      expect(leaderboardService.getLeaderboard).toHaveBeenCalledWith(
        'user-caller',
        'guild-123',
        'total',
        1
      );

      const reply = interaction.getReplyData();
      // Public response: ephemeral must NOT be true
      expect(reply.ephemeral).toBeUndefined();
      expect(reply.embeds).toHaveLength(1);

      const embed = reply.embeds[0].data;
      expect(embed.title).toContain('Total Sparks Leaderboard');
      expect(embed.description).toContain('🥇 <@111111111111111111> — **20,000 Sparks**');
      expect(embed.description).toContain('🥈 <@222222222222222222> — **10,000 Sparks**');
      expect(embed.description).toContain('🥉 <@333333333333333333> — **5,000 Sparks**');
      expect(embed.description).toContain('`4.` <@444444444444444444> — **1,000 Sparks**');
      expect(embed.footer.text).toContain('Page 1 of 3');
    });

    test('renders cash leaderboard with Cash Sparks in title and amounts', async () => {
      (leaderboardService.getLeaderboard as jest.Mock).mockResolvedValueOnce({
        success: true,
        sort: 'cash',
        page: 1,
        entries: [
          { rank: 1, userId: '111111111111111111', cash: 8888, bank: 100, total: 8988 },
        ],
      });

      const interaction = createMockInteraction({
        sort: 'cash',
        page: 1,
      });

      await execute(interaction);

      const reply = interaction.getReplyData();
      const embed = reply.embeds[0].data;
      expect(embed.title).toContain('Cash Sparks Leaderboard');
      expect(embed.description).toContain('8,888 Sparks');
      expect(embed.footer.text).toBe('Page 1 • UnbelievaBoat Economy');
    });

    test('renders bank leaderboard with Bank Sparks in title and amounts', async () => {
      (leaderboardService.getLeaderboard as jest.Mock).mockResolvedValueOnce({
        success: true,
        sort: 'bank',
        page: 2,
        entries: [
          { rank: 11, userId: '111111111111111111', cash: 0, bank: 99999, total: 99999 },
        ],
      });

      const interaction = createMockInteraction({
        sort: 'bank',
        page: 2,
      });

      await execute(interaction);

      const reply = interaction.getReplyData();
      const embed = reply.embeds[0].data;
      expect(embed.title).toContain('Bank Sparks Leaderboard');
      expect(embed.description).toContain('99,999 Sparks');
      expect(embed.footer.text).toBe('Page 2 • UnbelievaBoat Economy');
    });

    test('renders clean empty state embed when no users are found', async () => {
      (leaderboardService.getLeaderboard as jest.Mock).mockResolvedValueOnce({
        success: true,
        sort: 'total',
        page: 1,
        entries: [],
      });

      const interaction = createMockInteraction({});

      await execute(interaction);

      const reply = interaction.getReplyData();
      const embed = reply.embeds[0].data;
      expect(embed.description).toContain('No ranked users found for this server.');
    });

    test('renders ephemeral query cooldown embed when user checks too quickly', async () => {
      (leaderboardService.getLeaderboard as jest.Mock).mockResolvedValueOnce({
        success: false,
        onCooldown: true,
        remainingMs: 8000,
        sort: 'total',
        page: 1,
        entries: [],
        message: 'You are checking the leaderboard too quickly. Please wait 8s before querying again.',
      });

      const interaction = createMockInteraction({});

      await execute(interaction);

      const reply = interaction.getReplyData();
      expect(reply.ephemeral).toBe(true);

      const embed = reply.embeds[0].data;
      expect(embed.title).toContain('Leaderboard Query Cooldown');
      expect(embed.description).toContain('8s');
    });

    test('renders ephemeral failure embed when economy provider fails', async () => {
      (leaderboardService.getLeaderboard as jest.Mock).mockResolvedValueOnce({
        success: false,
        onCooldown: false,
        sort: 'total',
        page: 1,
        entries: [],
        error: 'ECONNRESET',
      });

      const interaction = createMockInteraction({});

      await execute(interaction);

      const reply = interaction.getReplyData();
      expect(reply.ephemeral).toBe(true);

      const embed = reply.embeds[0].data;
      expect(embed.title).toBe('❌ Leaderboard Lookup Failed');
      expect(embed.description).toContain('economy provider');
    });
  });
});
