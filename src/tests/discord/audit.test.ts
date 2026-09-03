// src/tests/discord/audit.test.ts

import { runAudit } from '../../services/discord/audit';
import { Guild, Role, GuildChannel, ApplicationCommand, Collection } from 'discord.js';
import * as fs from 'fs';

// Mock the policy module to control authorization decisions
jest.mock('../../services/discord/policy', () => {
  return {
    authorize: jest.fn(),
    Category: { AUDIT: 'AUDIT' },
  };
});

import { authorize } from '../../services/discord/policy';

// Helper to create a minimal mock Guild
function createMockGuild(): Guild {
  const mockGuild = {
    id: 'guild123',
    name: 'TestGuild',
    roles: {
      cache: new Collection<string, Role>([
        [
          'role1',
          {
            id: 'role1',
            name: 'RoleOne',
            position: 1,
            permissions: { bitfield: 0n },
          } as any,
        ],
        [
          'role2',
          {
            id: 'role2',
            name: 'RoleTwo',
            position: 2,
            permissions: { bitfield: 8n },
          } as any,
        ],
      ]),
    },
    channels: {
      cache: new Collection<string, GuildChannel>([
        [
          'chan1',
          {
            id: 'chan1',
            name: 'general',
            type: 'GUILD_TEXT',
            parentId: null,
            permissionOverwrites: {
              cache: new Collection<string, any>([
                [
                  'over1',
                  {
                    id: 'over1',
                    allow: { toArray: () => ['VIEW_CHANNEL'] },
                    deny: { toArray: () => [] },
                  } as any,
                ],
              ]),
            },
          } as any,
        ],
      ]),
    },
    commands: {
      fetch: jest.fn().mockResolvedValue(
        new Collection<string, ApplicationCommand>([
          [
            'cmd1',
            {
              id: 'cmd1',
              name: 'ping',
              description: 'Ping command',
              defaultPermission: true,
            } as any,
          ],
        ])
      ),
    },
  } as unknown as Guild;
  return mockGuild;
}

describe('Audit Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('authorized user receives a correctly shaped audit report', async () => {
    (authorize as jest.Mock).mockReturnValue('ALLOW');
    // Desired state config detection handled by actual file

    const mockGuild = createMockGuild();
    const report = await runAudit(mockGuild, ['111111111111111111']);

    // Guild info
    expect(report.guild).toEqual({ id: 'guild123', name: 'TestGuild' });

    // Roles
    expect(report.roles).toHaveLength(2);
    expect(report.roles[0]).toMatchObject({ id: 'role1', name: 'RoleOne', position: 1 });

    // Channels
    expect(report.channels).toHaveLength(1);
    const channel = report.channels[0];
    expect(channel).toMatchObject({ id: 'chan1', name: 'general', type: 'GUILD_TEXT', parentId: null });
    expect(channel.permissionOverwrites).toHaveLength(1);
    expect(channel.permissionOverwrites[0]).toMatchObject({ id: 'over1', allow: ['VIEW_CHANNEL'], deny: [] });

    // Commands
    expect(report.commands).toHaveLength(1);
    expect(report.commands[0]).toMatchObject({ id: 'cmd1', name: 'ping', description: 'Ping command', defaultPermission: true });

    // Desired‑state config detection result should be a boolean
    expect(typeof report.hasDesiredStateConfig).toBe('boolean');
  });

  test('unauthorized user triggers policy denial', async () => {
    (authorize as jest.Mock).mockReturnValue('DENY');
    const mockGuild = createMockGuild();
    await expect(runAudit(mockGuild, ['999999999999999999'])).rejects.toThrow('Unauthorized');
  });
});
