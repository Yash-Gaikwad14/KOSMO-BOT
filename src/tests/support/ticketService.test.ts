// src/tests/support/ticketService.test.ts

import {
  isTicketChannel,
  auditTicketPrivacy,
  inspectTicket,
  findDestinationCategory,
  routeTicket,
  logTicketAudit,
} from '../../services/support/ticketService';
import { ChannelType, PermissionFlagsBits } from 'discord.js';

describe('Phase 6 — Support Ticket Service', () => {
  describe('isTicketChannel()', () => {
    test('returns true for channel name starting with ticket-', () => {
      expect(isTicketChannel({ name: 'ticket-alice' })).toBe(true);
      expect(isTicketChannel({ name: 'ticket-0042' })).toBe(true);
      expect(isTicketChannel({ name: 'tickets' })).toBe(true);
    });

    test('returns true for channel under ACTIVE TICKETS category', () => {
      const channel = {
        name: 'custom-case',
        parent: { name: 'ACTIVE TICKETS' },
      };
      expect(isTicketChannel(channel)).toBe(true);

      const channelWithEmoji = {
        name: 'support-inquiry',
        parent: { name: '🛠️ ACTIVE TICKETS' },
      };
      expect(isTicketChannel(channelWithEmoji)).toBe(true);
    });

    test('returns false for non-ticket channels', () => {
      expect(isTicketChannel({ name: 'general', parent: { name: 'Community' } })).toBe(false);
      expect(isTicketChannel({ name: 'announcements' })).toBe(false);
      expect(isTicketChannel(null)).toBe(false);
      expect(isTicketChannel({})).toBe(false);
    });
  });

  describe('auditTicketPrivacy()', () => {
    const mockGuild: any = {
      id: 'guild-1',
      roles: {
        everyone: { id: 'guild-1', name: '@everyone' },
        cache: new Map([
          ['role-mod', { id: 'role-mod', name: 'Moderator' }],
          ['role-founder', { id: 'role-founder', name: 'Founder' }],
        ]),
      },
      members: {
        me: { id: 'bot-id' },
      },
    };

    test('verifies private ticket with @everyone denied and staff allowed', () => {
      const channel: any = {
        id: 'chan-ticket-1',
        name: 'ticket-user1',
        permissionOverwrites: {
          cache: new Map([
            [
              'guild-1',
              {
                id: 'guild-1',
                deny: { has: (perm: bigint) => perm === PermissionFlagsBits.ViewChannel },
                allow: { has: () => false },
              },
            ],
            [
              'role-mod',
              {
                id: 'role-mod',
                allow: { has: (perm: bigint) => perm === PermissionFlagsBits.ViewChannel },
                deny: { has: () => false },
              },
            ],
            [
              'user-creator',
              {
                id: 'user-creator',
                type: 1, // Member type
                allow: { has: (perm: bigint) => perm === PermissionFlagsBits.ViewChannel },
                deny: { has: () => false },
              },
            ],
          ]),
        },
      };

      const report = auditTicketPrivacy(mockGuild, channel);

      expect(report.isPrivate).toBe(true);
      expect(report.everyoneDeniesView).toBe(true);
      expect(report.staffHasAccess).toBe(true);
      expect(report.creatorHasAccess).toBe(true);
      expect(report.creatorId).toBe('user-creator');
      expect(report.issues).toHaveLength(0);
    });

    test('flags critical issue when @everyone is not denied ViewChannel', () => {
      const exposedChannel: any = {
        id: 'chan-ticket-exposed',
        name: 'ticket-exposed',
        permissionOverwrites: {
          cache: new Map([
            [
              'guild-1',
              {
                id: 'guild-1',
                deny: { has: () => false },
                allow: { has: (perm: bigint) => perm === PermissionFlagsBits.ViewChannel },
              },
            ],
            [
              'role-mod',
              {
                id: 'role-mod',
                allow: { has: (perm: bigint) => perm === PermissionFlagsBits.ViewChannel },
                deny: { has: () => false },
              },
            ],
          ]),
        },
      };

      const report = auditTicketPrivacy(mockGuild, exposedChannel);

      expect(report.isPrivate).toBe(false);
      expect(report.everyoneDeniesView).toBe(false);
      expect(report.issues.some((i) => i.includes('not denied ViewChannel'))).toBe(true);
    });

    test('flags critical issue when no overwrite exists for @everyone', () => {
      const unconfiguredChannel: any = {
        id: 'chan-ticket-no-ow',
        name: 'ticket-no-ow',
        permissionOverwrites: { cache: new Map() },
      };

      const report = auditTicketPrivacy(mockGuild, unconfiguredChannel);

      expect(report.isPrivate).toBe(false);
      expect(report.issues.some((i) => i.includes('No permission overwrite for @everyone'))).toBe(true);
    });

    test('warns when no staff role has ViewChannel permission', () => {
      const channelWithoutStaff: any = {
        id: 'chan-ticket-no-staff',
        name: 'ticket-no-staff',
        permissionOverwrites: {
          cache: new Map([
            [
              'guild-1',
              {
                id: 'guild-1',
                deny: { has: (perm: bigint) => perm === PermissionFlagsBits.ViewChannel },
                allow: { has: () => false },
              },
            ],
          ]),
        },
      };

      const report = auditTicketPrivacy(mockGuild, channelWithoutStaff);

      expect(report.staffHasAccess).toBe(false);
      expect(report.warnings.some((w) => w.includes('No configured staff role'))).toBe(true);
    });

    test('detects creator from channel topic if member overwrite missing', () => {
      const channelWithTopic: any = {
        id: 'chan-ticket-topic',
        name: 'ticket-user2',
        topic: 'Ticket Creator: 123456789012345678 | Ticket Tool',
        permissionOverwrites: {
          cache: new Map([
            [
              'guild-1',
              {
                id: 'guild-1',
                deny: { has: (perm: bigint) => perm === PermissionFlagsBits.ViewChannel },
                allow: { has: () => false },
              },
            ],
            [
              'role-mod',
              {
                id: 'role-mod',
                allow: { has: (perm: bigint) => perm === PermissionFlagsBits.ViewChannel },
                deny: { has: () => false },
              },
            ],
          ]),
        },
      };

      const report = auditTicketPrivacy(mockGuild, channelWithTopic);

      expect(report.creatorHasAccess).toBe(true);
      expect(report.creatorId).toBe('123456789012345678');
    });
  });

  describe('inspectTicket()', () => {
    test('returns metadata without leaking message contents', () => {
      const mockGuild: any = {
        id: 'guild-1',
        roles: {
          everyone: { id: 'guild-1', name: '@everyone' },
          cache: new Map([['role-mod', { id: 'role-mod', name: 'Moderator' }]]),
        },
        members: { me: { id: 'bot-id' } },
        channels: {
          cache: new Map([
            ['cat-active', { id: 'cat-active', name: 'ACTIVE TICKETS', type: ChannelType.GuildCategory }],
          ]),
        },
      };

      const channel: any = {
        id: 'chan-ticket-inspect',
        name: 'ticket-alice',
        parentId: 'cat-active',
        parent: { name: 'ACTIVE TICKETS' },
        createdAt: new Date('2026-09-01T12:00:00Z'),
        messages: { cache: new Map([['m1', { content: 'SUPER SENSITIVE PASSWORD' }]]) },
        permissionOverwrites: {
          cache: new Map([
            [
              'guild-1',
              {
                id: 'guild-1',
                deny: { has: (perm: bigint) => perm === PermissionFlagsBits.ViewChannel },
                allow: { has: () => false },
              },
            ],
            [
              'role-mod',
              {
                id: 'role-mod',
                allow: { has: (perm: bigint) => perm === PermissionFlagsBits.ViewChannel },
                deny: { has: () => false },
              },
            ],
          ]),
        },
      };

      const meta = inspectTicket(mockGuild, channel);

      expect(meta.channelId).toBe('chan-ticket-inspect');
      expect(meta.channelName).toBe('ticket-alice');
      expect(meta.categoryName).toBe('ACTIVE TICKETS');
      expect(meta.isPrivate).toBe(true);
      // Strictly verify sensitive message content is never present in returned metadata
      expect(JSON.stringify(meta)).not.toContain('SUPER SENSITIVE PASSWORD');
    });
  });

  describe('findDestinationCategory() & routeTicket()', () => {
    const catActive = { id: 'cat-active', name: '🛠️ ACTIVE TICKETS', type: ChannelType.GuildCategory };
    const catSupport = { id: 'cat-support', name: 'FEEDBACK & SUPPORT', type: ChannelType.GuildCategory };
    const catPriority = { id: 'cat-priority', name: '💎 KOSMO PRO & MAX', type: ChannelType.GuildCategory };

    const mockGuild: any = {
      id: 'guild-1',
      channels: {
        cache: new Map([
          ['cat-active', catActive],
          ['cat-support', catSupport],
          ['cat-priority', catPriority],
        ]),
        fetch: jest.fn(),
      },
    };

    test('finds appropriate destination categories matching fuzzy names and emojis', () => {
      expect(findDestinationCategory(mockGuild, 'ACTIVE_TICKETS')?.id).toBe('cat-active');
      expect(findDestinationCategory(mockGuild, 'FEEDBACK_AND_SUPPORT')?.id).toBe('cat-support');
      expect(findDestinationCategory(mockGuild, 'PRIORITY_SUPPORT')?.id).toBe('cat-priority');
    });

    test('routeTicket safely sets parent with lockPermissions: false and verifies state', async () => {
      const channel: any = {
        id: 'chan-ticket-move',
        parentId: 'cat-active',
        setParent: jest.fn().mockImplementation(async (targetId, options) => {
          channel.parentId = targetId;
        }),
      };

      mockGuild.channels.fetch.mockResolvedValue({
        id: 'chan-ticket-move',
        parentId: 'cat-support',
      });

      const result = await routeTicket(mockGuild, channel, 'FEEDBACK_AND_SUPPORT', 'actor-mod');

      expect(result.success).toBe(true);
      expect(result.previousCategoryId).toBe('cat-active');
      expect(result.newCategoryId).toBe('cat-support');
      expect(channel.setParent).toHaveBeenCalledWith('cat-support', { lockPermissions: false });
    });

    test('routeTicket returns already routed if channel already has target parent', async () => {
      const channel: any = {
        id: 'chan-ticket-same',
        parentId: 'cat-active',
        setParent: jest.fn(),
      };

      const result = await routeTicket(mockGuild, channel, 'ACTIVE_TICKETS', 'actor-mod');

      expect(result.success).toBe(true);
      expect(result.message).toContain('already routed');
      expect(channel.setParent).not.toHaveBeenCalled();
    });

    test('routeTicket throws when destination category does not exist', async () => {
      const emptyGuild: any = {
        id: 'guild-empty',
        channels: { cache: new Map() },
      };
      const channel: any = { id: 'chan-1', setParent: jest.fn() };

      await expect(routeTicket(emptyGuild, channel, 'ACTIVE_TICKETS', 'actor-1')).rejects.toThrow(
        'Destination category "ACTIVE_TICKETS" could not be found'
      );
    });

    test('routeTicket throws when post-action verification fails', async () => {
      const channel: any = {
        id: 'chan-ticket-fail',
        parentId: 'cat-active',
        setParent: jest.fn(),
      };

      mockGuild.channels.fetch.mockResolvedValue({
        id: 'chan-ticket-fail',
        parentId: 'cat-active', // Did NOT change
      });

      await expect(
        routeTicket(mockGuild, channel, 'FEEDBACK_AND_SUPPORT', 'actor-mod')
      ).rejects.toThrow('Verification failed');
    });
  });

  describe('logTicketAudit()', () => {
    test('sends rich embed to #mod-logs with redacted metadata', async () => {
      const mockSend = jest.fn().mockResolvedValue({});
      const modLogsChannel = {
        id: 'chan-mod-logs',
        name: 'mod-logs',
        send: mockSend,
      };

      const mockGuild: any = {
        id: 'guild-1',
        channels: {
          cache: new Map([['chan-mod-logs', modLogsChannel]]),
        },
      };

      await logTicketAudit(mockGuild, {
        guildId: 'guild-1',
        channelId: 'chan-ticket-1',
        channelName: 'ticket-alice',
        actorId: 'mod-123',
        actorTag: 'Mod#0001',
        action: 'TICKET_ROUTE',
        destinationCategory: 'FEEDBACK & SUPPORT',
        details: 'Routed for bug triage',
        status: 'SUCCESS',
        timestamp: new Date('2026-09-05T12:00:00Z'),
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const payload = mockSend.mock.calls[0][0];
      expect(payload.embeds).toBeDefined();
      expect(payload.embeds[0].data.title).toContain('TICKET_ROUTE');
      expect(JSON.stringify(payload)).toContain('ticket-alice');
      expect(JSON.stringify(payload)).toContain('Mod#0001');
    });

    test('gracefully succeeds without throwing when #mod-logs channel is absent', async () => {
      const emptyGuild: any = {
        id: 'guild-1',
        channels: { cache: new Map() },
      };

      await expect(
        logTicketAudit(emptyGuild, {
          guildId: 'guild-1',
          channelId: 'chan-1',
          channelName: 'ticket-1',
          actorId: 'mod-1',
          actorTag: 'Mod#1',
          action: 'TICKET_INSPECT',
          status: 'SUCCESS',
          timestamp: new Date(),
        })
      ).resolves.not.toThrow();
    });
  });
});
