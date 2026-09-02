import { Guild } from 'discord.js';
import { DiscordAction } from './types';

/**
 * List of role names that are considered privileged and must never be granted
 * by AI-generated actions. These names match the human-controlled roles in the
 * server (Founder, Team Kosmo, Moderator, Administrator).
 */
const PRIVILEGED_ROLE_NAMES = [
  'Founder',
  'Team Kosmo',
  'Moderator',
  'Administrator',
];

/**
 * Validate a proposed DiscordAction. Throws an Error if the action would grant
 * a privileged role or permission.
 */
export function validateAction(guild: Guild, action: DiscordAction): void {
  switch (action.type) {
    case 'createRole': {
      const { name } = action.payload;
      if (PRIVILEGED_ROLE_NAMES.includes(name)) {
        throw new Error('Creation of privileged role is not allowed.');
      }
      break;
    }
    case 'assignRole': {
      const { roleName } = action.payload;
      if (PRIVILEGED_ROLE_NAMES.includes(roleName)) {
        throw new Error('Assigning privileged role is not allowed.');
      }
      break;
    }
    default:
      break;
  }
}
