import path from 'path';
import { Collection } from 'discord.js';
import execute, { data } from '../../commands/economy/profile';
import { loadCommands } from '../../commands/loader';
import * as profileService from '../../services/economy/profileService';

jest.mock('../../services/economy/profileService');

describe('/profile Slash Command', () => {
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

  describe('Command Registration & Discovery', () => {
    test('registers as /profile with correct metadata', () => {
      expect(data.name).toBe('profile');
      expect(data.description).toContain('profile');
      expect(data.options).toHaveLength(0);
    });

    test('is automatically discovered by command loader', async () => {
      const commandsRoot = path.resolve(__dirname, '../../commands');
      const loaded = await loadCommands(commandsRoot);
      expect(loaded.has('profile')).toBe(true);

      const entry = loaded.get('profile');
      expect(entry?.data.name).toBe('profile');
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
      expect(profileService.getProfile).not.toHaveBeenCalled();
    });
  });

  describe('Profile Rendering', () => {
    test('renders ephemeral embed with badges, premium, guild affiliation, economy, and daily ready', async () => {
      (profileService.getProfile as jest.Mock).mockResolvedValueOnce({
        success: true,
        userId: 'user-vip',
        isHighKarma: true,
        dailyEligible: true,
        dailyAllowance: 2000,
        balance: {
          cash: 5000,
          bank: 15000,
          total: 20000,
        },
        recognition: {
          badges: ['🏆 Feedback Champion', '⚡ High-Karma'],
          premiumTier: '💎 Kosmo Max',
          domainRoles: ['💻 Tech & Engineering'],
        },
      });

      const interaction = createMockInteraction({
        guildId: 'guild-123',
        userId: 'user-vip',
        username: 'VipUser',
      });

      await execute(interaction);

      expect(profileService.getProfile).toHaveBeenCalledWith(
        'user-vip',
        'guild-123',
        interaction.member
      );

      const reply = interaction.getReplyData();
      expect(reply.ephemeral).toBe(true);
      expect(reply.embeds).toHaveLength(1);

      const embed = reply.embeds[0].data;
      expect(embed.title).toContain('Kosmo Profile — VipUser');
      expect(embed.color).toBe(0xf1c40f); // Gold

      // Check fields
      const recField = embed.fields.find((f: any) => f.name.includes('Recognition'));
      expect(recField.value).toContain('🏆 Feedback Champion');
      expect(recField.value).toContain('⚡ High-Karma');

      const premField = embed.fields.find((f: any) => f.name.includes('Premium'));
      expect(premField.value).toContain('💎 Kosmo Max');

      const domainField = embed.fields.find((f: any) => f.name.includes('Guild Affiliation'));
      expect(domainField.value).toContain('💻 Tech & Engineering');

      const econField = embed.fields.find((f: any) => f.name.includes('Sparks Economy'));
      expect(econField.value).toContain('5,000 Sparks'); // cash
      expect(econField.value).toContain('15,000 Sparks'); // bank
      expect(econField.value).toContain('20,000 Sparks'); // total

      const dailyField = embed.fields.find((f: any) => f.name.includes('Daily Allowance'));
      expect(dailyField.value).toContain('High-Karma (2,000 Sparks/day)');
      expect(dailyField.value).toContain('Ready to claim');
    });

    test('renders fallback empty state when member has no special badges or premium roles', async () => {
      (profileService.getProfile as jest.Mock).mockResolvedValueOnce({
        success: true,
        userId: 'user-std',
        isHighKarma: false,
        dailyEligible: false,
        dailyNextClaimAt: new Date(Date.now() + 10 * 3600 * 1000),
        dailyAllowance: 500,
        balance: {
          cash: 100,
          bank: 0,
          total: 100,
        },
        recognition: {
          badges: [],
          premiumTier: undefined,
          domainRoles: [],
        },
      });

      const interaction = createMockInteraction({
        guildId: 'guild-123',
        userId: 'user-std',
        username: 'StandardUser',
      });

      await execute(interaction);

      const reply = interaction.getReplyData();
      expect(reply.ephemeral).toBe(true);

      const embed = reply.embeds[0].data;
      const recField = embed.fields.find((f: any) => f.name.includes('Recognition'));
      expect(recField.value).toContain('No special recognition yet.');

      // Premium & Domain fields should NOT be present
      expect(embed.fields.find((f: any) => f.name.includes('Premium'))).toBeUndefined();
      expect(embed.fields.find((f: any) => f.name.includes('Guild Affiliation'))).toBeUndefined();
    });

    test('renders ephemeral cooldown embed on rapid consecutive queries', async () => {
      (profileService.getProfile as jest.Mock).mockResolvedValueOnce({
        success: false,
        onCooldown: true,
        remainingMs: 7000,
        userId: 'user-cool',
        isHighKarma: false,
        dailyEligible: false,
        dailyAllowance: 500,
        recognition: { badges: [], domainRoles: [] },
        message: 'You are checking your profile too quickly. Please wait 7s before querying again.',
      });

      const interaction = createMockInteraction({});

      await execute(interaction);

      const reply = interaction.getReplyData();
      expect(reply.ephemeral).toBe(true);

      const embed = reply.embeds[0].data;
      expect(embed.title).toContain('Profile Query Cooldown');
      expect(embed.description).toContain('7s');
    });

    test('renders ephemeral error embed on provider failure', async () => {
      (profileService.getProfile as jest.Mock).mockResolvedValueOnce({
        success: false,
        onCooldown: false,
        userId: 'user-fail',
        isHighKarma: false,
        dailyEligible: true,
        dailyAllowance: 500,
        recognition: { badges: [], domainRoles: [] },
        error: 'ECONNRESET',
      });

      const interaction = createMockInteraction({});

      await execute(interaction);

      const reply = interaction.getReplyData();
      expect(reply.ephemeral).toBe(true);

      const embed = reply.embeds[0].data;
      expect(embed.title).toBe('❌ Profile Lookup Failed');
    });
  });
});
