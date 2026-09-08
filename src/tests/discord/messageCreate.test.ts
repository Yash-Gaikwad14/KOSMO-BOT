// src/tests/discord/messageCreate.test.ts

import { handleMessageCreate } from '../../events/message/messageCreate';
import { InMemoryIntroductionRepository } from '../../services/engagement/introductionRepository';
import { PersonalityConfig } from '../../config/personality';
import { cache } from '../../services/cache';
import { COMMUNITY_ROAST_LIBRARY } from '../../services/ai/personality/roastLibrary';

describe('Discord messageCreate Pipeline (messageCreate.ts)', () => {
  let mockClient: any;
  let mockMessage: any;
  let introRepo: InMemoryIntroductionRepository;

  const defaultCfg: PersonalityConfig = {
    enabled: true,
    roastEnabled: true,
    introChannelId: 'intro-chan-123',
  };

  beforeEach(async () => {
    await cache.flush();
    introRepo = new InMemoryIntroductionRepository();

    mockClient = {
      user: {
        id: 'kosmobot-999',
        tag: 'KosmoBot#0001',
      },
    };

    mockMessage = {
      author: {
        id: 'user-456',
        bot: false,
      },
      guildId: 'guild-789',
      channelId: 'general-chan-111',
      content: '',
      mentions: {
        users: new Map(),
      },
      channel: {
        send: jest.fn().mockResolvedValue({}),
      },
      reply: jest.fn().mockResolvedValue({}),
    };
  });

  describe('Guardrails & Filters', () => {
    test('ignores messages authored by bots', async () => {
      mockMessage.author.bot = true;
      mockMessage.content = '<@kosmobot-999> hello';
      mockMessage.mentions.users.set('kosmobot-999', mockClient.user);

      await handleMessageCreate(mockMessage, mockClient, {
        config: defaultCfg,
        introRepo,
      });

      expect(mockMessage.reply).not.toHaveBeenCalled();
      expect(mockMessage.channel.send).not.toHaveBeenCalled();
    });

    test('ignores messages when personality is disabled', async () => {
      mockMessage.content = '<@kosmobot-999> hello';
      mockMessage.mentions.users.set('kosmobot-999', mockClient.user);

      await handleMessageCreate(mockMessage, mockClient, {
        config: { ...defaultCfg, enabled: false },
        introRepo,
      });

      expect(mockMessage.reply).not.toHaveBeenCalled();
    });

    test('ignores ordinary messages that do NOT mention KosmoBot', async () => {
      mockMessage.content = 'Just chatting about compiler optimizations with fellow humans';

      await handleMessageCreate(mockMessage, mockClient, {
        config: defaultCfg,
        introRepo,
      });

      expect(mockMessage.reply).not.toHaveBeenCalled();
      expect(mockMessage.channel.send).not.toHaveBeenCalled();
    });
  });

  describe('Introduction Channel Icebreaker', () => {
    test('sends icebreaker on first newcomer introduction in configured channel', async () => {
      mockMessage.channelId = 'intro-chan-123';
      mockMessage.content = 'Hello everyone! Excited to be here.';

      await handleMessageCreate(mockMessage, mockClient, {
        config: defaultCfg,
        introRepo,
      });

      expect(mockMessage.channel.send).toHaveBeenCalledWith(
        expect.stringContaining('Welcome to the Kosmoverse, <@user-456>.')
      );
      expect(mockMessage.reply).not.toHaveBeenCalled();
    });

    test('does NOT send repeated icebreakers to the same user in the intro channel', async () => {
      mockMessage.channelId = 'intro-chan-123';
      mockMessage.content = 'First message';

      await handleMessageCreate(mockMessage, mockClient, {
        config: defaultCfg,
        introRepo,
      });
      expect(mockMessage.channel.send).toHaveBeenCalledTimes(1);

      // Second message from the same user
      mockMessage.content = 'Forgot to mention I code in Rust';
      await handleMessageCreate(mockMessage, mockClient, {
        config: defaultCfg,
        introRepo,
      });

      // Still only called once!
      expect(mockMessage.channel.send).toHaveBeenCalledTimes(1);
    });

    test('triggers introduction icebreaker when channel name is introductions and introChannelId is unset', async () => {
      mockMessage.channelId = 'chan-999';
      mockMessage.channel.name = 'introductions';
      mockMessage.content = 'Hey all, excited to join!';

      await handleMessageCreate(mockMessage, mockClient, {
        config: { ...defaultCfg, introChannelId: '' },
        introRepo,
      });

      expect(mockMessage.channel.send).toHaveBeenCalledWith(
        expect.stringContaining('Welcome to the Kosmoverse, <@user-456>.')
      );
    });

    test('triggers introduction icebreaker when introChannelId is configured as channel name (#introductions)', async () => {
      mockMessage.channelId = 'chan-888';
      mockMessage.channel.name = 'introductions';
      mockMessage.content = 'Hello, happy to be here!';

      await handleMessageCreate(mockMessage, mockClient, {
        config: { ...defaultCfg, introChannelId: '#introductions' },
        introRepo,
      });

      expect(mockMessage.channel.send).toHaveBeenCalledWith(
        expect.stringContaining('Welcome to the Kosmoverse, <@user-456>.')
      );
    });

    test('does NOT trigger introduction icebreaker in non-intro channels', async () => {
      mockMessage.channelId = 'general-chan-111';
      mockMessage.channel.name = 'general-chat';
      mockMessage.content = 'Hello world, I am new here';

      await handleMessageCreate(mockMessage, mockClient, {
        config: defaultCfg,
        introRepo,
      });

      expect(mockMessage.channel.send).not.toHaveBeenCalled();
    });
  });

  describe('Mention-Driven Conversational Flow', () => {
    test('prompts user if mention has empty text', async () => {
      mockMessage.content = '<@kosmobot-999>';
      mockMessage.mentions.users.set('kosmobot-999', mockClient.user);

      await handleMessageCreate(mockMessage, mockClient, {
        config: defaultCfg,
        introRepo,
      });

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Speak up'),
        })
      );
    });

    test('triggers sharp roast and AskKosmo redirect when user offloads homework without saying roast me', async () => {
      mockMessage.content = '<@kosmobot-999> write my homework';
      mockMessage.mentions.users.set('kosmobot-999', mockClient.user);

      const mockLLM = jest.fn();

      await handleMessageCreate(mockMessage, mockClient, {
        config: defaultCfg,
        introRepo,
        llmCaller: mockLLM,
      });

      expect(mockLLM).not.toHaveBeenCalled();
      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('intent compiler, not a tutor'),
        })
      );
      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('askkosmo.com'),
        })
      );
    });

    test('routes Discord administrative actions to nlManager without roasting', async () => {
      mockMessage.content = '<@kosmobot-999> create channel announcements';
      mockMessage.mentions.users.set('kosmobot-999', mockClient.user);

      const mockPlan = {
        id: 'plan-123',
        name: 'Create announcements channel',
        description: 'Create text channel announcements',
        actions: [{ type: 'createChannel', payload: { name: 'announcements', type: 'GUILD_TEXT' } }],
        riskLevel: 'LOW',
        creatorId: 'user-456',
        createdAt: new Date(),
      };

      const mockNLManager = {
        generatePlan: jest.fn().mockResolvedValue({
          success: true,
          plan: mockPlan,
        }),
      };

      await handleMessageCreate(mockMessage, mockClient, {
        config: defaultCfg,
        introRepo,
        nlManager: mockNLManager as any,
      });

      expect(mockNLManager.generatePlan).toHaveBeenCalledWith(
        'create channel announcements',
        expect.objectContaining({ userId: 'user-456' })
      );
      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
    });

    test('responds seriously without roasting when user mentions billing/support issue', async () => {
      mockMessage.content = '<@kosmobot-999> I have a billing dispute on my credit card';
      mockMessage.mentions.users.set('kosmobot-999', mockClient.user);

      await handleMessageCreate(mockMessage, mockClient, {
        config: defaultCfg,
        introRepo,
      });

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('support ticket'),
        })
      );
      expect(mockMessage.reply).not.toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('roast'),
        })
      );
    });

    test('responds seriously without roasting when user says "my payment failed and I need help" and bypasses LLM', async () => {
      mockMessage.content = '<@kosmobot-999> my payment failed and I need help';
      mockMessage.mentions.users.set('kosmobot-999', mockClient.user);

      const mockLLM = jest.fn();

      await handleMessageCreate(mockMessage, mockClient, {
        config: defaultCfg,
        introRepo,
        llmCaller: mockLLM,
      });

      expect(mockLLM).not.toHaveBeenCalled(); // zero unnecessary LLM routing
      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('support ticket'),
        })
      );
      expect(mockMessage.reply).not.toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Nothing to report. Push cleaner code.'),
        })
      );
    });

    test('triggers safe roast if user asks silly question', async () => {
      mockMessage.content = '<@kosmobot-999> can you help me download more ram?';
      mockMessage.mentions.users.set('kosmobot-999', mockClient.user);

      const mockLLM = jest.fn();

      await handleMessageCreate(mockMessage, mockClient, {
        config: defaultCfg,
        introRepo,
        llmCaller: mockLLM,
      });

      expect(mockLLM).not.toHaveBeenCalled(); // Roast bypasses LLM
      expect(mockMessage.reply).toHaveBeenCalled();
      const replyContent = mockMessage.reply.mock.calls[0][0].content;
      const isExpectedRoast = COMMUNITY_ROAST_LIBRARY.SILLY_QUESTION.some(
        (t) => replyContent.includes(t) || t.includes(replyContent)
      );
      expect(isExpectedRoast).toBe(true);
    });

    test('triggers safe roast when user asks to write all code for them and bypasses LLM', async () => {
      mockMessage.content = '<@kosmobot-999> can you write all my code for me?';
      mockMessage.mentions.users.set('kosmobot-999', mockClient.user);

      const mockLLM = jest.fn();

      await handleMessageCreate(mockMessage, mockClient, {
        config: defaultCfg,
        introRepo,
        llmCaller: mockLLM,
      });

      expect(mockLLM).not.toHaveBeenCalled();
      expect(mockMessage.reply).toHaveBeenCalled();
      const replyContent = mockMessage.reply.mock.calls[0][0].content;
      const isExpectedRoast = COMMUNITY_ROAST_LIBRARY.CODE_VENDING.some(
        (t) => replyContent.includes(t) || t.includes(replyContent)
      );
      expect(isExpectedRoast).toBe(true);
    });

    test('triggers safe roast when user makes low-effort generic begging request and bypasses LLM', async () => {
      mockMessage.content = '<@kosmobot-999> do everything for me';
      mockMessage.mentions.users.set('kosmobot-999', mockClient.user);

      const mockLLM = jest.fn();

      await handleMessageCreate(mockMessage, mockClient, {
        config: defaultCfg,
        introRepo,
        llmCaller: mockLLM,
      });

      expect(mockLLM).not.toHaveBeenCalled();
      expect(mockMessage.reply).toHaveBeenCalled();
      const replyContent = mockMessage.reply.mock.calls[0][0].content;
      const isExpectedRoast = COMMUNITY_ROAST_LIBRARY.GENERIC_BEGGING.some(
        (t) => replyContent.includes(t) || t.includes(replyContent)
      );
      expect(isExpectedRoast).toBe(true);
    });

    test('calls conversational LLM, sanitizes em dashes, and replies to user', async () => {
      mockMessage.content = '<@kosmobot-999> What do you think of microservices?';
      mockMessage.mentions.users.set('kosmobot-999', mockClient.user);

      const mockLLM = jest
        .fn()
        .mockResolvedValue('Microservices are great — if you enjoy network latency.');

      await handleMessageCreate(mockMessage, mockClient, {
        config: defaultCfg,
        introRepo,
        llmCaller: mockLLM,
      });

      expect(mockLLM).toHaveBeenCalledWith(
        'What do you think of microservices?',
        expect.any(String)
      );

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Microservices are great - if you enjoy network latency.',
        })
      );
    });

    test('applies AskKosmo promotion when user asks about building complex AI workflows', async () => {
      mockMessage.content = '<@kosmobot-999> How do I build an AI workflow with multiple agents?';
      mockMessage.mentions.users.set('kosmobot-999', mockClient.user);

      const mockLLM = jest
        .fn()
        .mockResolvedValue('Start by establishing discrete responsibilities for each agent.');

      await handleMessageCreate(mockMessage, mockClient, {
        config: defaultCfg,
        introRepo,
        llmCaller: mockLLM,
      });

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('https://askkosmo.com'),
        })
      );
    });

    test('handles LLM failure gracefully with safe fallback message', async () => {
      mockMessage.content = '<@kosmobot-999> Explain quantum computing';
      mockMessage.mentions.users.set('kosmobot-999', mockClient.user);

      const mockLLM = jest.fn().mockRejectedValue(new Error('OpenRouter 502 Bad Gateway'));

      await handleMessageCreate(mockMessage, mockClient, {
        config: defaultCfg,
        introRepo,
        llmCaller: mockLLM,
      });

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('transient hiccup'),
        })
      );
    });

    test('enforces rate limit when user sends too many requests', async () => {
      mockMessage.content = '<@kosmobot-999> Spam question';
      mockMessage.mentions.users.set('kosmobot-999', mockClient.user);

      jest.spyOn(cache, 'checkAndIncrementRateLimit').mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
      });

      await handleMessageCreate(mockMessage, mockClient, {
        config: defaultCfg,
        introRepo,
      });

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Slow down'),
        })
      );
    });
  });
});
