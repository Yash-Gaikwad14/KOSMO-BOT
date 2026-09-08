// src/tests/ai/summarize_command.test.ts

import execute, { data } from '../../commands/community/community';
import { summarizerService } from '../../services/ai/summarizerService';
import { AuthLevel } from '../../services/discord/policy';

jest.mock('../../services/ai/summarizerService');

describe('Phase 9.2: /community summarize Command', () => {
  let mockInteraction: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockInteraction = {
      guild: {
        id: 'guild-123',
        ownerId: 'owner-user-1',
      },
      user: {
        id: 'staff-user-1',
        tag: 'StaffUser#0001',
        username: 'StaffUser',
      },
      member: {
        roles: {
          cache: new Map([['role-mod', { id: 'role-mod', name: 'Moderator' }]]),
        },
      },
      options: {
        getSubcommand: jest.fn().mockReturnValue('summarize'),
        getChannel: jest.fn().mockReturnValue(null),
        getString: jest.fn().mockReturnValue(null),
      },
      channelId: 'chan-general-1',
      deferReply: jest.fn().mockResolvedValue({}),
      reply: jest.fn().mockResolvedValue({}),
      followUp: jest.fn().mockResolvedValue({}),
      deferred: false,
      replied: false,
    };
  });

  test('data exports correct subcommand name and options', () => {
    const json: any = data.toJSON();
    const summarizeSub: any = json.options?.find((opt: any) => opt.name === 'summarize');
    expect(summarizeSub).toBeDefined();
    expect(summarizeSub.description).toContain('Staff only');

    const channelOpt = summarizeSub.options?.find((opt: any) => opt.name === 'channel');
    expect(channelOpt).toBeDefined();

    const scopeOpt = summarizeSub.options?.find((opt: any) => opt.name === 'scope');
    expect(scopeOpt).toBeDefined();
  });

  test('non-staff caller receives unauthorized response', async () => {
    mockInteraction.member.roles.cache = new Map(); // unprivileged user
    mockInteraction.user.id = 'unprivileged-user';

    await execute(mockInteraction);

    expect(mockInteraction.reply).toHaveBeenCalled();
    const replyCall = mockInteraction.reply.mock.calls[0][0];
    expect(replyCall.ephemeral).toBe(true);
    expect(replyCall.embeds[0].data.title).toContain('Unauthorized');
    expect(summarizerService.summarize).not.toHaveBeenCalled();
  });

  test('authorized staff caller defers ephemerally and displays summary embed', async () => {
    (summarizerService.summarize as jest.Mock).mockResolvedValue({
      status: 'SUCCESS',
      summary: {
        headline: 'Active Technical Discussions',
        overview: 'Members discussed database indexing and bot features.',
        keyTopics: [{ topic: 'TypeScript', description: 'Strict typing rules.' }],
        highlightsByChannel: [{ channelName: 'tech-and-engineering', points: ['Discussed bot types'] }],
        toneObservation: 'Conversations were constructive.',
        provenance: {
          scope: 'COMMUNITY',
          channelsSummarized: ['tech-and-engineering'],
          totalMessagesAnalyzed: 15,
          totalUniqueAuthors: 4,
          truncated: false,
          excludedChannels: [],
          partialErrors: [],
        },
      },
      executionTimeMs: 120,
      generatedAt: new Date().toISOString(),
    });

    await execute(mockInteraction);

    expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(summarizerService.summarize).toHaveBeenCalled();
    expect(mockInteraction.followUp).toHaveBeenCalled();

    const followUpCall = mockInteraction.followUp.mock.calls[0][0];
    expect(followUpCall.ephemeral).toBe(true);
    const embed = followUpCall.embeds[0].data;
    expect(embed.title).toContain('Community Intelligence — Summary');
    expect(embed.description).toContain('Active Technical Discussions');
  });

  test('displays NO_DATA embed when message count is 0', async () => {
    (summarizerService.summarize as jest.Mock).mockResolvedValue({
      status: 'NO_DATA',
      errorReason: 'No recent message activity found in the authorized public community channels.',
      executionTimeMs: 50,
      generatedAt: new Date().toISOString(),
    });

    await execute(mockInteraction);

    const followUpCall = mockInteraction.followUp.mock.calls[0][0];
    const embed = followUpCall.embeds[0].data;
    expect(embed.title).toContain('No Recent Activity Found');
  });

  test('displays error embed when summarizer returns ERROR or UNAVAILABLE', async () => {
    (summarizerService.summarize as jest.Mock).mockResolvedValue({
      status: 'ERROR',
      errorReason: 'AI completion failed: OpenRouter 500',
      executionTimeMs: 250,
      generatedAt: new Date().toISOString(),
    });

    await execute(mockInteraction);

    const followUpCall = mockInteraction.followUp.mock.calls[0][0];
    const embed = followUpCall.embeds[0].data;
    expect(embed.title).toContain('Community Summary Unavailable');
    expect(embed.description).toContain('OpenRouter 500');
  });
});
