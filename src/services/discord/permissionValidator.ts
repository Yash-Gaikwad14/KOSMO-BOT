import { Guild, GuildMember } from 'discord.js';
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
 * Result of a moderation target safety validation check.
 */
export interface TargetSafetyCheckResult {
  safe: boolean;
  reason?: string;
}

/**
 * Helper to determine if a member possesses any privileged roles.
 */
export function hasPrivilegedRole(member: any): boolean {
  if (!member?.roles) return false;
  const rolesCollection = member.roles.cache || member.roles;
  if (rolesCollection && typeof rolesCollection.some === 'function') {
    return rolesCollection.some((role: any) =>
      PRIVILEGED_ROLE_NAMES.some((priv) => priv.toLowerCase() === role.name?.toLowerCase())
    );
  }
  if (rolesCollection && typeof rolesCollection.values === 'function') {
    for (const role of rolesCollection.values()) {
      if (PRIVILEGED_ROLE_NAMES.some((priv) => priv.toLowerCase() === role.name?.toLowerCase())) {
        return true;
      }
    }
  }
  if (Array.isArray(rolesCollection)) {
    return rolesCollection.some((role: any) =>
      PRIVILEGED_ROLE_NAMES.some((priv) => priv.toLowerCase() === (role.name || role)?.toLowerCase())
    );
  }
  return false;
}

/**
 * Helper to extract highest role position from a member.
 */
export function getHighestRolePosition(member: any): number {
  if (!member) return 0;
  if (member.roles?.highest && typeof member.roles.highest.position === 'number') {
    return member.roles.highest.position;
  }
  const rolesCollection = member.roles?.cache || member.roles;
  if (rolesCollection && typeof rolesCollection.values === 'function') {
    let max = 0;
    for (const r of rolesCollection.values()) {
      if (typeof r.position === 'number' && r.position > max) {
        max = r.position;
      }
    }
    return max;
  }
  return 0;
}

/**
 * Validates target safety and role hierarchy constraints for moderation operations (timeout, kick, etc.).
 */
export function validateModerationTargetSafety(
  guild: Guild,
  caller: GuildMember,
  target: GuildMember
): TargetSafetyCheckResult {
  // 1. Self-target rejection
  if (caller.id === target.id) {
    return { safe: false, reason: 'You cannot moderate yourself.' };
  }

  // 2. Bot target rejection
  if (target.user?.bot) {
    return { safe: false, reason: 'Cannot moderate bot accounts.' };
  }

  // 3. Server owner target rejection
  if (target.id === guild.ownerId) {
    return { safe: false, reason: 'Cannot moderate the server owner.' };
  }

  // 4. Privileged staff target rejection
  if (hasPrivilegedRole(target)) {
    return { safe: false, reason: 'Cannot moderate staff members with privileged roles.' };
  }

  const targetHighest = getHighestRolePosition(target);

  // 5. Caller role hierarchy check (Unless caller is server owner)
  const isCallerOwner = caller.id === guild.ownerId;
  if (!isCallerOwner) {
    const callerHighest = getHighestRolePosition(caller);
    if (callerHighest <= targetHighest) {
      return {
        safe: false,
        reason: 'You cannot moderate a member with an equal or higher role than your highest role.',
      };
    }
  }

  // 6. Bot role hierarchy check
  const botMember = guild.members.me;
  if (botMember) {
    const botHighest = getHighestRolePosition(botMember);
    if (botHighest <= targetHighest) {
      return {
        safe: false,
        reason: 'The bot cannot moderate a member with an equal or higher role than its highest role.',
      };
    }
  }

  return { safe: true };
}

/**
 * Backward-compatible alias for timeout target safety checks.
 */
export const validateTimeoutTargetSafety = validateModerationTargetSafety;

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

  // Guild-specific runtime checks for member actions
  if (action.type === 'timeoutMember' && guild) {
    if (action.payload.memberId === guild.ownerId) {
      throw new Error('Cannot timeout the server owner.');
    }
    const member = guild.members.cache?.get?.(action.payload.memberId);
    if (member) {
      if (member.user?.bot) {
        throw new Error('Cannot timeout bot accounts.');
      }
      if (hasPrivilegedRole(member)) {
        throw new Error('Cannot timeout staff members with privileged roles.');
      }
    }
  }

  if (action.type === 'kickMember' && guild) {
    if (action.payload.targetId === guild.ownerId) {
      throw new Error('Cannot kick the server owner.');
    }
    const member = guild.members.cache?.get?.(action.payload.targetId);
    if (member) {
      if (member.user?.bot) {
        throw new Error('Cannot kick bot accounts.');
      }
      if (hasPrivilegedRole(member)) {
        throw new Error('Cannot kick staff members with privileged roles.');
      }
    }
  }

  if (action.type === 'banMember' && guild) {
    if (action.payload.targetId === guild.ownerId) {
      throw new Error('Cannot ban the server owner.');
    }
    const member = guild.members.cache?.get?.(action.payload.targetId);
    if (member) {
      if (member.user?.bot) {
        throw new Error('Cannot ban bot accounts.');
      }
      if (hasPrivilegedRole(member)) {
        throw new Error('Cannot ban staff members with privileged roles.');
      }
    }
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
        if (!roleName) {
          errors.push('Role name cannot be empty for assignment.');
        }
        if (!action.payload.memberId || !action.payload.memberId.trim()) {
          errors.push('Member ID cannot be empty for role assignment.');
        }
        break;
      }

      case 'removeRole': {
        const roleName = action.payload.roleName?.trim() || '';
        const lowerName = roleName.toLowerCase();
        if (PRIVILEGED_ROLE_NAMES.some((p) => p.toLowerCase() === lowerName)) {
          blocked = true;
          blockedReasons.push(`Removing privileged role '${roleName}' is not allowed.`);
        }
        if (!roleName) {
          errors.push('Role name cannot be empty for removal.');
        }
        if (!action.payload.memberId || !action.payload.memberId.trim()) {
          errors.push('Member ID cannot be empty for role removal.');
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

      case 'deleteRole': {
        const roleName = action.payload.roleName?.trim() || '';
        const lowerName = roleName.toLowerCase();
        if (PRIVILEGED_ROLE_NAMES.some((p) => p.toLowerCase() === lowerName)) {
          blocked = true;
          blockedReasons.push(`Deletion of privileged role '${roleName}' is not allowed.`);
        }
        if (!roleName) {
          errors.push('Role name cannot be empty for deletion.');
        }
        break;
      }

      case 'deleteChannel': {
        const channelName = action.payload.channelName?.trim() || '';
        if (!channelName) {
          errors.push('Channel name cannot be empty for deletion.');
        }
        break;
      }

      case 'deleteCategory': {
        const categoryName = action.payload.categoryName?.trim() || '';
        if (!categoryName) {
          errors.push('Category name cannot be empty for deletion.');
        }
        break;
      }

      case 'timeoutMember': {
        const memberId = action.payload.memberId?.trim() || '';
        if (!memberId) {
          errors.push('Member ID cannot be empty for timeout.');
        }
        const duration = action.payload.durationMinutes;
        if (typeof duration !== 'number' || duration < 1 || duration > 10080 || !Number.isInteger(duration)) {
          errors.push('Timeout duration must be an integer between 1 and 10080 minutes (7 days).');
        }
        const reason = action.payload.reason?.trim() || '';
        if (!reason) {
          errors.push('Timeout reason cannot be empty.');
        }
        break;
      }

      case 'kickMember': {
        const targetId = action.payload.targetId?.trim() || '';
        if (!targetId) {
          errors.push('Target ID cannot be empty for kick.');
        }
        const reason = action.payload.reason?.trim() || '';
        if (!reason) {
          errors.push('Kick reason cannot be empty.');
        } else if (reason.length > 512) {
          errors.push('Kick reason cannot exceed 512 characters.');
        }
        break;
      }

      case 'banMember': {
        const targetId = action.payload.targetId?.trim() || '';
        if (!targetId) {
          errors.push('Target ID cannot be empty for ban.');
        }
        const reason = action.payload.reason?.trim() || '';
        if (!reason) {
          errors.push('Ban reason cannot be empty.');
        } else if (reason.length > 512) {
          errors.push('Ban reason cannot exceed 512 characters.');
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

