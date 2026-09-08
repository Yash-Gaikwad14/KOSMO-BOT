// src/tests/support/ticket_command.test.ts

import execute, { data } from '../../commands/support/ticket';
import * as ticketService from '../../services/support/ticketService';
import { ChannelType, PermissionFlagsBits } from 'discord.js';

describe('Phase 6 — /ticket Slash Command', () => {
  const mockGuild: any = {
    id: 'guild-123',
    ownerId: 'owner-id',
    roles: {
      everyone: { id: 'guild-123', name: '@everyone' },
      cache: new Map([
        ['role-mod-id', { id: 'role-mod-id', name: 'Moderator' }],
        ['role-team-id', { id: 'role-team-id', name: 'Team Kosmo' }],
        ['role-founder-id', { id: 'role-founder-id', name: 'Founder' }],
      ]),
    },
    channels: {
      cache: new Map([
        ['cat-active', { id: 'cat-active', name: 'ACTIVE TICKETS', type: ChannelType.GuildCategory }],
        ['cat-support', { id: 'cat-support', name: 'FEEDBACK & SUPPORT', type: ChannelType.GuildCategory }],
        ['chan-mod-logs', { id: 'chan-mod-logs', name: 'mod-logs', send: jest.fn().mockResolvedValue({}) }],
      ]),
      fetch: jest.fn(),
    },
    members: {
      me: { id: 'bot-123' },
    },
  };

  function createMockInteraction(options: {
    subcommand: string;
    destination?: string;
    callerRoles?: string[];
    callerId?: string;
    channelName?: string;
    channelParent?: string;
    guild?: any;
  }) {
    const {
      subcommand,
      destination,
      callerRoles = ['role-mod-id'],
      callerId = 'caller-mod',
      channelName = 'ticket-alice',
      channelParent = 'ACTIVE TICKETS',
      guild = mockGuild,
    } = options;

    const roleNameMap: Record<string, string> = {
      'role-mod-id': 'Moderator',
      'role-team-id': 'Team Kosmo',
      'role-founder-id': 'Founder',
      'role-admin-id': 'Admin',
      '1545398110359126066': 'Moderator',
      '1544801399068434443': 'Team Kosmo',
      '1544750811207442532': 'Founder',
    };

    const channel: any = {
      id: 'chan-ticket-1',
      name: channelName,
      parentId: 'cat-active',
      parent: channelParent ? { name: channelParent } : null,
      createdAt: new Date('2026-09-01T00:00:00Z'),
      permissionOverwrites: {
        cache: new Map([
          [
            'guild-123',
            {
              id: 'guild-123',
              deny: { has: (p: bigint) => p === PermissionFlagsBits.ViewChannel },
              allow: { has: () => false },
            },
          ],
          [
            'role-mod-id',
            {
              id: 'role-mod-id',
              allow: { has: (p: bigint) => p === PermissionFlagsBits.ViewChannel },
              deny: { has: () => false },
            },
          ],
        ]),
      },
      setParent: jest.fn().mockResolvedValue({}),
    };

    const reply = jest.fn().mockResolvedValue({});
    const deferReply = jest.fn().mockResolvedValue({});
    const editReply = jest.fn().mockResolvedValue({});

    const interaction: any = {
      guild,
      guildId: guild?.id,
      user: { id: callerId, tag: 'User#1234', username: 'user123' },
      member: {
        roles: {
          cache: new Map(callerRoles.map((r) => [r, { id: r, name: roleNameMap[r] || r }])),
        },
      },
      channel,
      options: {
        getSubcommand: () => subcommand,
        getString: (name: string) => (name === 'destination' ? destination : null),
      },
      reply,
      deferReply,
      editReply,
    };

    return { interaction, channel, reply, deferReply, editReply };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Command registration data', () => {
    test('defines /ticket command with required subcommands', () => {
      expect(data.name).toBe('ticket');
      expect(data.description).toBeDefined();
      const subcommands = data.options.map((opt: any) => opt.name);
      expect(subcommands).toContain('inspect');
      expect(subcommands).toContain('verify-privacy');
      expect(subcommands).toContain('route');
      expect(subcommands).toContain('close');
    });
  });

  describe('Guild-only & Authorization Checks', () => {
    test('rejects execution when outside of guild', async () => {
      const { interaction, reply } = createMockInteraction({
        subcommand: 'inspect',
        guild: null,
      });

      await execute(interaction);

      expect(reply).toHaveBeenCalledWith({
        content: '❌ This command can only be used in a Discord server.',
        ephemeral: true,
      });
    });

    test('rejects unauthorized members (regular Kosmosian)', async () => {
      const { interaction, reply } = createMockInteraction({
        subcommand: 'inspect',
        callerRoles: ['unauthorized-role'],
      });

      await execute(interaction);

      expect(reply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                title: '❌ Unauthorized',
              }),
            }),
          ]),
          ephemeral: true,
        })
      );
    });

    test('allows Founder, Team Kosmo, and Moderator', async () => {
      for (const role of ['role-founder-id', 'role-team-id', 'role-mod-id']) {
        const { interaction, reply } = createMockInteraction({
          subcommand: 'inspect',
          callerRoles: [role],
        });

        await execute(interaction);

        expect(reply).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.arrayContaining([
              expect.objectContaining({
                data: expect.objectContaining({
                  title: expect.stringContaining('Ticket Inspection'),
                }),
              }),
            ]),
          })
        );
      }
    });

    test('allows server owner dynamically even without configured roles', async () => {
      const { interaction, reply } = createMockInteraction({
        subcommand: 'inspect',
        callerId: 'owner-id',
        callerRoles: [],
      });

      await execute(interaction);

      expect(reply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                title: expect.stringContaining('Ticket Inspection'),
              }),
            }),
          ]),
        })
      );
    });
  });

  describe('Channel context check', () => {
    test('rejects execution when channel is not a ticket channel', async () => {
      const { interaction, reply } = createMockInteraction({
        subcommand: 'inspect',
        channelName: 'general',
        channelParent: 'Community',
      });

      await execute(interaction);

      expect(reply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                title: '❌ Invalid Channel',
              }),
            }),
          ]),
          ephemeral: true,
        })
      );
    });
  });

  describe('Subcommand: /ticket inspect', () => {
    test('returns ephemeral inspection embed with privacy status and audits action', async () => {
      const { interaction, reply } = createMockInteraction({
        subcommand: 'inspect',
      });

      await execute(interaction);

      expect(reply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                title: expect.stringContaining('Ticket Inspection — #ticket-alice'),
              }),
            }),
          ]),
          ephemeral: true,
        })
      );

      const embed = reply.mock.calls[0][0].embeds[0].data;
      expect(embed.fields.some((f: any) => f.name === 'Privacy Status' && f.value.includes('Private'))).toBe(true);
      expect(embed.footer.text).toContain('Strict Privacy');
    });
  });

  describe('Subcommand: /ticket verify-privacy', () => {
    test('returns verified privacy embed for properly configured ticket', async () => {
      const { interaction, reply } = createMockInteraction({
        subcommand: 'verify-privacy',
      });

      await execute(interaction);

      expect(reply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                title: '🔒 Ticket Privacy Integrity: Verified',
              }),
            }),
          ]),
          ephemeral: true,
        })
      );
    });
  });

  describe('Subcommand: /ticket route', () => {
    test('routes ticket to destination category and edits reply', async () => {
      const { interaction, deferReply, editReply, channel } = createMockInteraction({
        subcommand: 'route',
        destination: 'FEEDBACK_AND_SUPPORT',
      });

      mockGuild.channels.fetch.mockResolvedValue({
        id: channel.id,
        parentId: 'cat-support',
      });

      await execute(interaction);

      expect(deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                title: '✅ Ticket Routed',
              }),
            }),
          ]),
        })
      );
    });

    test('handles routing error gracefully and reports failure embed', async () => {
      const { interaction, deferReply, editReply } = createMockInteraction({
        subcommand: 'route',
        destination: 'NON_EXISTENT_DESTINATION' as any,
      });

      await execute(interaction);

      expect(deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                title: '❌ Routing Failed',
              }),
            }),
          ]),
        })
      );
    });
  });

  describe('Subcommand: /ticket close', () => {
    test('reports Ticket Tool authoritative closure boundary and native close guidance', async () => {
      const { interaction, reply } = createMockInteraction({
        subcommand: 'close',
      });

      await execute(interaction);

      expect(reply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                title: '🔒 Ticket Tool Closure Authority',
                description: expect.stringContaining('Ticket Tool is the authoritative lifecycle owner'),
              }),
            }),
          ]),
          ephemeral: true,
        })
      );
    });
  });
});
