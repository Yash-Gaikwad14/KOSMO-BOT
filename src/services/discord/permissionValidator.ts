import { Guild } from 'discord.js';
import { DiscordAction, ValidationResult } from './types';

/**
 * List of role names that are considered privileged and must never be granted
 * or created by AI-generated actions. These names match the human-controlled roles in the
 * server (Founder, Team Kosmo, Moderator, Administrator).
 */
export const PRIVILEGED_ROLE_NAMES = [
  'Founder',
  'Team Kosmo',
  'Moderator',
  'Administrator',
  'Owner',
  'Admin',
  'KosmoBot',
];

/**
 * Dangerous permissions that must NEVER be granted via NL management or AI planning.
 */
export const FORBIDDEN_PERMISSIONS = [
  'Administrator',
  'ADMINISTRATOR',
  'ManageGuild',
  'MANAGE_GUILD',
  'KickMembers',
  'KICK_MEMBERS',
  'BanMembers',
  'BAN_MEMBERS',
];

/**
 * Validate a proposed DiscordAction (Phase 2 legacy signature).
 * Throws an Error if the action would grant a privileged role or permission.
 */
export function validateAction(guild: Guild, action: DiscordAction): void {
  const result = PermissionValidator.validateAction(action);
  if (!result.valid || result.blocked) {
    const reason = result.blockedReasons?.[0] || result.errors[0] || 'Action rejected by permission validator.';
    throw new Error(reason);
  }
}

/**
 * Phase 3 Permission Validator class for structured validation & risk management.
 */
export class PermissionValidator {
  /**
   * Validates an individual action against safety constraints.
   */
  public static validateAction(action: DiscordAction): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const blockedReasons: string[] = [];
    let blocked = false;

    if (!action || !action.type) {
      return {
        valid: false,
        errors: ['Invalid or null action.'],
        blocked: false,
      };
    }

    switch (action.type) {
      case 'createRole': {
        const roleName = action.payload.name?.trim() || '';
        const lowerName = roleName.toLowerCase();
        if (PRIVILEGED_ROLE_NAMES.some((p) => p.toLowerCase() === lowerName)) {
          blocked = true;
          blockedReasons.push(`Creation of privileged role is not allowed.`);
        }
        break;
      }

      case 'assignRole': {
        const roleName = action.payload.roleName?.trim() || '';
        const lowerName = roleName.toLowerCase();
        if (PRIVILEGED_ROLE_NAMES.some((p) => p.toLowerCase() === lowerName)) {
          blocked = true;
          blockedReasons.push(`Assigning privileged role is not allowed.`);
        }
        break;
      }

      case 'removeRole': {
        const roleName = action.payload.roleName?.trim() || '';
        const lowerName = roleName.toLowerCase();
        if (['founder', 'owner', 'administrator', 'admin'].includes(lowerName)) {
          blocked = true;
          blockedReasons.push(`Removing ultra-privileged role '${roleName}' via AI is not allowed.`);
        }
        break;
      }

      case 'applyPermissionTemplate': {
        const overwrites = action.payload.permissionOverwrites || [];
        for (const ow of overwrites) {
          const allows = ow.allow || [];
          for (const perm of allows) {
            if (FORBIDDEN_PERMISSIONS.includes(perm)) {
              blocked = true;
              blockedReasons.push(`Permission template cannot grant ${perm} permission.`);
            }
          }
        }
        break;
      }

      case 'createChannel': {
        if (!['GUILD_TEXT', 'GUILD_VOICE', 'GUILD_CATEGORY'].includes(action.payload.type)) {
          errors.push(`Unsupported channel type: ${action.payload.type}`);
        }
        break;
      }

      default:
        warnings.push(`Unrecognized action type: ${(action as any).type}`);
    }

    return {
      valid: errors.length === 0 && !blocked,
      errors,
      warnings,
      blocked,
      blockedReasons: blocked ? blockedReasons : undefined,
    };
  }

  /**
   * Validates a batch of actions.
   */
  public static validateActions(actions: DiscordAction[]): ValidationResult {
    const allErrors: string[] = [];
    const allWarnings: string[] = [];
    const allBlockedReasons: string[] = [];
    let isBlocked = false;

    if (!actions || actions.length === 0) {
      return {
        valid: false,
        errors: ['Plan contains no actions.'],
        warnings: [],
        blocked: false,
      };
    }

    for (const action of actions) {
      const res = this.validateAction(action);
      if (res.errors.length > 0) {
        allErrors.push(...res.errors);
      }
      if (res.warnings && res.warnings.length > 0) {
        allWarnings.push(...res.warnings);
      }
      if (res.blocked) {
        isBlocked = true;
        if (res.blockedReasons) {
          allBlockedReasons.push(...res.blockedReasons);
        }
      }
    }

    return {
      valid: allErrors.length === 0 && !isBlocked,
      errors: allErrors,
      warnings: allWarnings,
      blocked: isBlocked,
      blockedReasons: isBlocked ? allBlockedReasons : undefined,
    };
  }
}
