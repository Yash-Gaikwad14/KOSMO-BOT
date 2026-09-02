import { Guild } from 'discord.js';
import { runAction } from '../../services/discord/actions';
import { DiscordAction } from '../../services/discord/types';

// Minimal mock Guild
const mockGuild = {
  roles: {
    cache: new Map(),
    create: jest.fn().mockResolvedValue(undefined),
  },
  channels: {
    cache: new Map(),
    create: jest.fn().mockResolvedValue(undefined),
  },
  members: {
    fetch: jest.fn().mockResolvedValue({
      roles: { cache: new Map(), add: jest.fn().mockResolvedValue(undefined) },
      user: { tag: 'User#1234' },
    }),
  },
} as unknown as Guild;

test('createRole idempotent – creates when missing', async () => {
  const action: DiscordAction = { type: 'createRole', payload: { name: 'NewRole' } };
  const msg = await runAction(mockGuild, action);
  expect(msg).toBe('Created role "NewRole".');
  expect(mockGuild.roles.create).toHaveBeenCalled();
});

test('createRole idempotent – skips when exists', async () => {
  // Insert existing role
  (mockGuild.roles.cache as any).set('1', { id: '1', name: 'Existing' } as any);
  const action: DiscordAction = { type: 'createRole', payload: { name: 'Existing' } };
  const msg = await runAction(mockGuild, action);
  expect(msg).toBe('Role "Existing" already exists.');
});
