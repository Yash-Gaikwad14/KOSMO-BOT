import { Guild } from 'discord.js';
import { validateAction } from '../../services/discord/permissionValidator';
import { DiscordAction } from '../../services/discord/types';

const mockGuild = {} as unknown as Guild;

test('rejects privileged role creation', () => {
  const action: DiscordAction = { type: 'createRole', payload: { name: 'Founder' } };
  expect(() => validateAction(mockGuild, action)).toThrow(/privileged role/);
});

test('allows non‑privileged role creation', () => {
  const action: DiscordAction = { type: 'createRole', payload: { name: 'Member' } };
  expect(() => validateAction(mockGuild, action)).not.toThrow();
});
