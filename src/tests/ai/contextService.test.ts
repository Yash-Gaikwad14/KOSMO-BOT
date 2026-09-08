// src/tests/ai/contextService.test.ts

import {
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';
import {
  CommunityContextService,
  classifyChannel,
  sanitizeContent,
  MAX_MESSAGES_PER_CHANNEL,
  MAX_CONTEXT_CHARACTERS,
  MAX_CHANNELS_PER_REQUEST,
  MAX_CONTEXT_CHANNEL_CONCURRENCY,
} from '../../services/ai/contextService';

describe('Phase 9.1: CommunityContextService & Channel Safety Boundaries', () => {
  let service: CommunityContextService;

  beforeEach(() => {
    service = new CommunityContextService();
    jest.clearAllMocks();
  });

  const createMockChannel = (overrides: Partial<any> = {}) => {
    const mockMessagesFetch = jest.fn().mockResolvedValue(new Map());

    const channel: any = {
      id: 'chan-general-123',
      name: 'general',
      type: ChannelType.GuildText,
      isTextBased: () => true,
      isThread: () => false,
      parent: { name: 'Community' },
      guild: {
        id: 'guild-kosmo',
        name: 'Kosmo Community',
        memberCount: 150,
        roles: { everyone: { id: 'guild-kosmo' } },
        members: {
          me: {
            id: 'bot-kosmo',
            displayName: 'KosmoBot',
          },
        },
        channels: {
          cache: new Map(),
        },
      },
      permissionOverwrites: {
        cache: new Map(),
      },
      permissionsFor: jest.fn().mockReturnValue({
        has: (perm: any) => true,
      }),
      messages: {
        fetch: mockMessagesFetch,
      },
      ...overrides,
    };

    return channel;
  };

  test('1. public channel accepted', async () => {
    const channel = createMockChannel({
      name: 'tech-and-engineering',
      parent: { name: '🎯 GUILD DISCUSSIONS' },
    });

    const classification = service.classify(channel);
    expect(classification).toBe('PUBLIC_COMMUNITY');

    const activity = await service.getRecentChannelActivity(channel);
    expect(activity.status).toBe('SUCCESS');
    expect(activity.classification).toBe('PUBLIC_COMMUNITY');
    expect(activity.channelId).toBe('chan-general-123');
  });

  test('2. public channel bounded to 20 messages max per request', async () => {
    const messages = new Map();
    for (let i = 1; i <= 30; i++) {
      messages.set(`msg-${i}`, {
        id: `msg-${i}`,
        content: `Message ${i}`,
        author: { id: `user-${i}`, username: `User${i}`, bot: false },
        createdAt: new Date(Date.now() - (30 - i) * 1000),
      });
    }

    const channel = createMockChannel({
      name: 'general',
      messages: {
        fetch: jest.fn().mockImplementation(({ limit }) => {
          const sliced = Array.from(messages.values()).slice(0, limit);
          return Promise.resolve(sliced);
        }),
      },
    });

    // Request 50 messages, which exceeds boundary
    const activity = await service.getRecentChannelActivity(channel, {
      limit: 50,
      includeMessages: true,
    });

    expect(channel.messages.fetch).toHaveBeenCalledWith({ limit: MAX_MESSAGES_PER_CHANNEL });
    expect(activity.status).toBe('SUCCESS');
    expect(activity.messageCount).toBeLessThanOrEqual(20);
    expect(activity.boundedMessages?.length).toBeLessThanOrEqual(20);
  });

  test('3. message count aggregation', async () => {
    const mockMsgs = [
      { id: '1', content: 'hello', author: { id: 'u1' }, createdAt: new Date() },
      { id: '2', content: 'world', author: { id: 'u2' }, createdAt: new Date() },
      { id: '3', content: 'test', author: { id: 'u3' }, createdAt: new Date() },
    ];

    const channel = createMockChannel({
      name: 'showcase',
      messages: {
        fetch: jest.fn().mockResolvedValue(mockMsgs),
      },
    });

    const activity = await service.getRecentChannelActivity(channel);
    expect(activity.status).toBe('SUCCESS');
    expect(activity.messageCount).toBe(3);
  });

  test('4. active author aggregation (unique deduplicated author IDs)', async () => {
    const mockMsgs = [
      { id: '1', content: 'A', author: { id: 'user-alpha' }, createdAt: new Date() },
      { id: '2', content: 'B', author: { id: 'user-beta' }, createdAt: new Date() },
      { id: '3', content: 'C', author: { id: 'user-alpha' }, createdAt: new Date() },
      { id: '4', content: 'D', author: { id: 'user-gamma' }, createdAt: new Date() },
      { id: '5', content: 'E', author: { id: 'user-beta' }, createdAt: new Date() },
    ];

    const channel = createMockChannel({
      name: 'count-to-infinity',
      messages: {
        fetch: jest.fn().mockResolvedValue(mockMsgs),
      },
    });

    const activity = await service.getRecentChannelActivity(channel);
    expect(activity.status).toBe('SUCCESS');
    expect(activity.activeAuthors).toHaveLength(3);
    expect(activity.activeAuthors).toEqual(expect.arrayContaining(['user-alpha', 'user-beta', 'user-gamma']));
  });

  test('5. unknown channel rejected / fail closed', async () => {
    const unknownChannel = createMockChannel({
      name: 'unregistered-private-room',
      parent: { name: 'Miscellaneous' },
    });

    const classification = service.classify(unknownChannel);
    expect(classification).toBe('OTHER');

    const activity = await service.getRecentChannelActivity(unknownChannel);
    expect(activity.status).toBe('UNAVAILABLE');
    expect(activity.errorReason).toContain('fail-closed');
    expect(unknownChannel.messages.fetch).not.toHaveBeenCalled();
  });

  test('6. staff-only channel rejected by default', async () => {
    const staffChannel = createMockChannel({
      name: 'team-chat',
      parent: { name: 'Team Kosmo' },
    });

    const classification = service.classify(staffChannel);
    expect(classification).toBe('STAFF_INTERNAL');

    // Default call: rejected
    const defaultActivity = await service.getRecentChannelActivity(staffChannel);
    expect(defaultActivity.status).toBe('UNAVAILABLE');
    expect(defaultActivity.errorReason).toContain('Staff-only channels are excluded by default');
    expect(staffChannel.messages.fetch).not.toHaveBeenCalled();

    // Explicitly authorized call
    const authorizedActivity = await service.getRecentChannelActivity(staffChannel, {
      allowStaffChannels: true,
    });
    expect(authorizedActivity.status).toBe('SUCCESS');
    expect(staffChannel.messages.fetch).toHaveBeenCalled();
  });

  test('7. Ticket Tool channel rejected', async () => {
    const ticketChannelByName = createMockChannel({
      name: 'ticket-1042',
      parent: { name: 'Some Category' },
    });
    expect(service.classify(ticketChannelByName)).toBe('PRIVATE_TICKET');

    const ticketChannelByCategory = createMockChannel({
      name: 'user-inquiry',
      parent: { name: '🛠️ ACTIVE TICKETS' },
    });
    expect(service.classify(ticketChannelByCategory)).toBe('PRIVATE_TICKET');

    const activity = await service.getRecentChannelActivity(ticketChannelByName);
    expect(activity.status).toBe('UNAVAILABLE');
    expect(activity.classification).toBe('PRIVATE_TICKET');
    expect(activity.errorReason).toContain('Active ticket channels are strictly excluded');
    expect(ticketChannelByName.messages.fetch).not.toHaveBeenCalled();
  });

  test('8. private AI channel rejected', async () => {
    const privateAiThread = createMockChannel({
      name: 'ai-chat-thread',
      type: ChannelType.PrivateThread,
      isThread: () => true,
    });
    expect(service.classify(privateAiThread)).toBe('PRIVATE_AI');

    const privateAiChannel = createMockChannel({
      name: 'kosmo-ai-session',
      type: ChannelType.GuildText,
    });
    expect(service.classify(privateAiChannel)).toBe('PRIVATE_AI');

    const activity = await service.getRecentChannelActivity(privateAiThread);
    expect(activity.status).toBe('UNAVAILABLE');
    expect(activity.classification).toBe('PRIVATE_AI');
    expect(activity.errorReason).toContain('Private AI conversations are strictly excluded');
    expect(privateAiThread.messages.fetch).not.toHaveBeenCalled();
  });

  test('9. missing permission handled safely (does not report "no activity")', async () => {
    const channel = createMockChannel({
      name: 'general',
      permissionsFor: jest.fn().mockReturnValue({
        has: (perm: any) => false, // missing all permissions
      }),
    });

    const activity = await service.getRecentChannelActivity(channel);
    expect(activity.status).toBe('FORBIDDEN');
    expect(activity.errorReason).toContain('missing ViewChannel');
    expect(activity.messageCount).toBe(0);
    expect(channel.messages.fetch).not.toHaveBeenCalled();
  });

  test('10. Discord API failure handled safely (does not report "no activity")', async () => {
    const channel = createMockChannel({
      name: 'general',
      messages: {
        fetch: jest.fn().mockRejectedValue(new Error('Rate limited: 429 Too Many Requests')),
      },
    });

    const activity = await service.getRecentChannelActivity(channel);
    expect(activity.status).toBe('ERROR');
    expect(activity.errorReason).toContain('Rate limited: 429');
    expect(activity.messageCount).toBe(0);
  });

  test('11. context size limit enforces character cap and truncated metadata', async () => {
    const hugeMessage = 'A'.repeat(8000);
    const mockMsgs = [
      { id: '1', content: hugeMessage, author: { id: 'u1' }, createdAt: new Date() },
      { id: '2', content: hugeMessage, author: { id: 'u2' }, createdAt: new Date() },
    ];

    const channel = createMockChannel({
      name: 'showcase',
      messages: {
        fetch: jest.fn().mockResolvedValue(mockMsgs),
      },
    });

    const activity = await service.getRecentChannelActivity(channel, {
      includeMessages: true,
    });

    expect(activity.status).toBe('SUCCESS');
    expect(activity.truncated).toBe(true);
    expect(activity.boundedMessages).toBeDefined();

    const totalChars = activity.boundedMessages!.reduce((acc, m) => acc + m.content.length, 0);
    expect(totalChars).toBeLessThanOrEqual(MAX_CONTEXT_CHARACTERS + 20); // within bounded budget
    expect(activity.boundedMessages![activity.boundedMessages!.length - 1].content).toContain('[TRUNCATED]');
  });

  test('12. no persistence of raw messages (purely in-memory request-scoped context)', async () => {
    const channel = createMockChannel({
      name: 'general',
      messages: {
        fetch: jest.fn().mockResolvedValue([
          { id: 'm1', content: 'Hello community', author: { id: 'u1' }, createdAt: new Date() },
        ]),
      },
    });

    const activity = await service.getRecentChannelActivity(channel, { includeMessages: true });
    expect(activity.boundedMessages).toHaveLength(1);

    // Context is returned directly to caller and not retained on the service instance
    expect((service as any).messageCache).toBeUndefined();
    expect((service as any).rawMessages).toBeUndefined();
  });

  test('13. no LLM invocation during context gathering', async () => {
    // Inspect service prototype and properties to verify zero external AI clients
    expect((service as any).openai).toBeUndefined();
    expect((service as any).anthropic).toBeUndefined();
    expect((service as any).llmClient).toBeUndefined();
    expect((service as any).generateResponse).toBeUndefined();

    const channel = createMockChannel({ name: 'general' });
    const activity = await service.getRecentChannelActivity(channel);
    expect(activity.status).toBe('SUCCESS');
  });

  test('14. no Discord mutations executed by context service', async () => {
    const editSpy = jest.fn();
    const deleteSpy = jest.fn();

    const channel = createMockChannel({
      name: 'general',
      edit: editSpy,
      delete: deleteSpy,
    });

    await service.getRecentChannelActivity(channel);
    expect(editSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  test('15. no secrets in context (tokens, API keys, credentials sanitized)', () => {
    const textWithOpenAiKey = 'Here is my key: sk-abcdef12345678901234567890 please keep it safe';
    const sanitizedOpenAi = sanitizeContent(textWithOpenAiKey);
    expect(sanitizedOpenAi).not.toContain('sk-abcdef');
    expect(sanitizedOpenAi).toContain('[REDACTED_SECRET]');

    const textWithDiscordToken = 'Token: fake_discord_token_test0.mock00.mock_signature_for_tests_00000001';
    const sanitizedDiscord = sanitizeContent(textWithDiscordToken);
    expect(sanitizedDiscord).not.toContain('fake_discord_token_test0');
    expect(sanitizedDiscord).toContain('[REDACTED_SECRET]');

    const textWithBearer = 'Authorization: Bearer secret_access_token_123456789';
    const sanitizedBearer = sanitizeContent(textWithBearer);
    expect(sanitizedBearer).not.toContain('secret_access_token_123456789');
    expect(sanitizedBearer).toContain('[REDACTED_SECRET]');
  });

  test('16. getCommunityMetadata returns accurate categorization and public names', () => {
    const mockGuild: any = {
      id: 'guild-kosmo',
      name: 'Kosmo Discord',
      memberCount: 200,
      channels: {
        cache: new Map([
          ['1', createMockChannel({ id: '1', name: 'general' })],
          ['2', createMockChannel({ id: '2', name: 'tech-and-engineering' })],
          ['3', createMockChannel({ id: '3', name: 'team-chat' })],
          ['4', createMockChannel({ id: '4', name: 'ticket-001' })],
          ['5', createMockChannel({ id: '5', name: 'ai-session', type: ChannelType.PrivateThread })],
          ['6', createMockChannel({ id: '6', name: 'unknown-room' })],
        ]),
      },
    };

    const metadata = service.getCommunityMetadata(mockGuild);
    expect(metadata.guildId).toBe('guild-kosmo');
    expect(metadata.memberCount).toBe(200);
    expect(metadata.channelsSummary.totalChannels).toBe(6);
    expect(metadata.channelsSummary.publicChannels).toBe(2);
    expect(metadata.channelsSummary.staffChannels).toBe(1);
    expect(metadata.channelsSummary.ticketChannels).toBe(1);
    expect(metadata.channelsSummary.privateAiChannels).toBe(1);
    expect(metadata.channelsSummary.otherChannels).toBe(1);
    expect(metadata.publicChannelNames).toEqual(['general', 'tech-and-engineering']);
  });

  test('17. getCommunityContext aggregates across public channels bounded to MAX_CHANNELS_PER_REQUEST', async () => {
    const mockChannels = new Map<string, any>();
    for (let i = 1; i <= 15; i++) {
      mockChannels.set(
        `ch-${i}`,
        createMockChannel({
          id: `ch-${i}`,
          name: 'tech-and-engineering', // public channel
          messages: {
            fetch: jest.fn().mockResolvedValue([
              { id: `m-${i}`, content: `Post ${i}`, author: { id: `u-${i}` }, createdAt: new Date() },
            ]),
          },
        })
      );
    }

    const mockGuild: any = {
      id: 'guild-kosmo',
      channels: { cache: mockChannels },
    };

    const response = await service.getCommunityContext(mockGuild);
    expect(response.status).toBe('SUCCESS');
    expect(response.channels.length).toBe(MAX_CHANNELS_PER_REQUEST);
    expect(response.truncated).toBe(true);
    expect(response.totalMessages).toBe(10);
    expect(response.totalActiveAuthors).toBe(10);
  });

  test('18. [H-02] bounded concurrency never exceeds MAX_CONTEXT_CHANNEL_CONCURRENCY simultaneously', async () => {
    let activeConcurrency = 0;
    let maxObservedConcurrency = 0;

    const mockChannels = new Map<string, any>();
    for (let i = 1; i <= 10; i++) {
      mockChannels.set(
        `ch-${i}`,
        createMockChannel({
          id: `ch-${i}`,
          name: 'tech-and-engineering',
          messages: {
            fetch: jest.fn().mockImplementation(async () => {
              activeConcurrency++;
              if (activeConcurrency > maxObservedConcurrency) {
                maxObservedConcurrency = activeConcurrency;
              }
              // Add a non-flaky microtask pause
              await new Promise((resolve) => setTimeout(resolve, 20));
              activeConcurrency--;
              return [{ id: `m-${i}`, content: `Content ${i}`, author: { id: `u-${i}` }, createdAt: new Date() }];
            }),
          },
        })
      );
    }

    const mockGuild: any = {
      id: 'guild-kosmo',
      channels: { cache: mockChannels },
    };

    const response = await service.getCommunityContext(mockGuild);
    expect(response.status).toBe('SUCCESS');
    expect(response.channels.length).toBe(10);
    expect(maxObservedConcurrency).toBeGreaterThan(1);
    expect(maxObservedConcurrency).toBeLessThanOrEqual(MAX_CONTEXT_CHANNEL_CONCURRENCY);
  });

  test('19. [H-02] result ordering remains strictly deterministic regardless of individual completion delay', async () => {
    // Stagger completion times deliberately: channel 1 finishes last, channel 5 finishes first
    const delays: Record<string, number> = {
      'ch-1': 40,
      'ch-2': 30,
      'ch-3': 20,
      'ch-4': 10,
      'ch-5': 5,
    };

    const mockChannels = new Map<string, any>();
    for (let i = 1; i <= 5; i++) {
      const id = `ch-${i}`;
      mockChannels.set(
        id,
        createMockChannel({
          id,
          name: 'tech-and-engineering',
          messages: {
            fetch: jest.fn().mockImplementation(async () => {
              await new Promise((resolve) => setTimeout(resolve, delays[id] || 10));
              return [{ id: `m-${i}`, content: `Delayed msg ${i}`, author: { id: `u-${i}` }, createdAt: new Date() }];
            }),
          },
        })
      );
    }

    const mockGuild: any = {
      id: 'guild-kosmo',
      channels: { cache: mockChannels },
    };

    const response = await service.getCommunityContext(mockGuild);
    expect(response.status).toBe('SUCCESS');
    expect(response.channels.length).toBe(5);

    // Verify deterministic index preservation matching original request order
    for (let i = 0; i < 5; i++) {
      expect(response.channels[i].channelId).toBe(`ch-${i + 1}`);
    }
  });

  test('20. [H-02] one channel failure is isolated and does not abort remaining retrievals', async () => {
    const mockChannels = new Map<string, any>();
    for (let i = 1; i <= 5; i++) {
      const id = `ch-${i}`;
      mockChannels.set(
        id,
        createMockChannel({
          id,
          name: 'tech-and-engineering',
          messages: {
            fetch: jest.fn().mockImplementation(async () => {
              if (id === 'ch-3') {
                throw new Error('Discord API 50035: Gateway error on channel 3');
              }
              return [{ id: `m-${i}`, content: `Msg ${i}`, author: { id: `u-${i}` }, createdAt: new Date() }];
            }),
          },
        })
      );
    }

    const mockGuild: any = {
      id: 'guild-kosmo',
      channels: { cache: mockChannels },
    };

    const response = await service.getCommunityContext(mockGuild);
    // Preserves partial failure semantics
    expect(response.status).toBe('PARTIAL');
    expect(response.channels.length).toBe(5);
    expect(response.channels[0].status).toBe('SUCCESS');
    expect(response.channels[1].status).toBe('SUCCESS');
    expect(response.channels[2].status).toBe('ERROR');
    expect(response.channels[2].channelId).toBe('ch-3');
    expect(response.channels[3].status).toBe('SUCCESS');
    expect(response.channels[4].status).toBe('SUCCESS');
    expect(response.totalMessages).toBe(4);
  });

  test('21. [H-02] privacy boundaries exclude staff, private, and ticket channels before parallel message retrieval', async () => {
    const fetchSpy1 = jest.fn().mockResolvedValue([]);
    const fetchSpyStaff = jest.fn().mockResolvedValue([]);
    const fetchSpyTicket = jest.fn().mockResolvedValue([]);
    const fetchSpyPrivate = jest.fn().mockResolvedValue([]);

    const mockChannels = new Map<string, any>([
      ['ch-public', createMockChannel({ id: 'ch-public', name: 'tech-and-engineering', messages: { fetch: fetchSpy1 } })],
      ['ch-staff', createMockChannel({ id: 'ch-staff', name: 'mod-chat', messages: { fetch: fetchSpyStaff } })],
      ['ch-ticket', createMockChannel({ id: 'ch-ticket', name: 'ticket-101', messages: { fetch: fetchSpyTicket } })],
      ['ch-private', createMockChannel({ id: 'ch-private', name: 'admin-discuss', type: ChannelType.PrivateThread, messages: { fetch: fetchSpyPrivate } })],
    ]);

    const mockGuild: any = {
      id: 'guild-kosmo',
      channels: { cache: mockChannels },
    };

    // Explicitly request all channel IDs to test parallel filtering
    const response = await service.getCommunityContext(mockGuild, {
      channelIds: ['ch-public', 'ch-staff', 'ch-ticket', 'ch-private'],
      allowStaffChannels: false,
    });

    expect(response.channels.length).toBe(4);
    expect(fetchSpy1).toHaveBeenCalledTimes(1);
    expect(fetchSpyStaff).not.toHaveBeenCalled();
    expect(fetchSpyTicket).not.toHaveBeenCalled();
    expect(fetchSpyPrivate).not.toHaveBeenCalled();
    expect(response.channels.find((c) => c.channelId === 'ch-staff')?.status).toBe('UNAVAILABLE');
    expect(response.channels.find((c) => c.channelId === 'ch-ticket')?.status).toBe('UNAVAILABLE');
  });

  test('22. [H-02] aggregate context limits and truncation remain strictly preserved under parallel retrieval', async () => {
    // Generate channels with messages exceeding MAX_CONTEXT_CHARACTERS (e.g. 2 messages of 8,000 chars)
    const mockChannels = new Map<string, any>();
    for (let i = 1; i <= 5; i++) {
      const msgs = [
        { id: `m-${i}-1`, content: 'X'.repeat(8000), author: { id: `u-${i}` }, createdAt: new Date() },
        { id: `m-${i}-2`, content: 'Y'.repeat(8000), author: { id: `u-${i}` }, createdAt: new Date() },
      ];

      mockChannels.set(
        `ch-${i}`,
        createMockChannel({
          id: `ch-${i}`,
          name: 'tech-and-engineering',
          messages: {
            fetch: jest.fn().mockResolvedValue(msgs),
          },
        })
      );
    }

    const mockGuild: any = {
      id: 'guild-kosmo',
      channels: { cache: mockChannels },
    };

    const response = await service.getCommunityContext(mockGuild, { includeMessages: true });
    expect(response.status).toBe('SUCCESS');
    expect(response.channels.length).toBe(5);
    expect(response.truncated).toBe(true);
    expect(response.channels.some((c) => c.truncated)).toBe(true);
  });
});
