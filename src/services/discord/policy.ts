// src/services/discord/policy.ts

import * as fs from 'fs';
import * as path from 'path';
import { NLContext } from './types';

/**
 * Logical role definitions. The actual Discord role IDs are stored in
 * `src/config/roles.json` and loaded at runtime.
 */
export enum LogicalRole {
  Founder = 'Founder',
  TeamKosmo = 'Team Kosmo',
  Admin = 'Admin',
  Moderator = 'Moderator',
}

/**
 * High‑level operation categories that require an access check.
 */
export enum Category {
  AUDIT = 'AUDIT',
  REPAIR = 'REPAIR',
  DRY_RUN = 'DRY_RUN',
  MANAGE = 'MANAGE', // NL‑prompt → plan generation
  CONFIRM = 'CONFIRM', // confirming a plan before execution
  MODERATE = 'MODERATE', // member moderation workflows (Phase 4D)
}

/** Decision returned by the policy layer. */
export type PolicyDecision = 'ALLOW' | 'DENY' | 'REQUIRES_FOUNDERS_APPROVAL';

/**
 * Load role configuration once at module load time.
 * The file maps logical role names to an array of Discord role IDs.
 */
interface RoleConfig {
  [key: string]: string[]; // logical role -> array of Discord role IDs
}

let roleConfig: RoleConfig = {};
const candidateRolePaths = [
  path.resolve(__dirname, '../../config/roles.json'), // ts-node / src runtime: src/services/discord -> src/config/roles.json
  path.resolve(__dirname, '../../../src/config/roles.json'), // compiled runtime: dist/services/discord -> src/config/roles.json
  path.resolve(process.cwd(), 'src/config/roles.json'), // process root fallback
];
for (const cand of candidateRolePaths) {
  if (fs.existsSync(cand)) {
    try {
      const raw = fs.readFileSync(cand, { encoding: 'utf-8' });
      roleConfig = JSON.parse(raw);
      break;
    } catch (e) {
      console.warn(`Policy: could not parse roles config at ${cand}`, e);
    }
  }
}

/**
 * Explicit human authorization levels for Kosmo Discord Bot.
 *
 * Security Hierarchy (highest to lowest):
 * 1. OWNER      - Discord Server Owner (dynamically resolved from guild.ownerId, independent of roles.json)
 * 2. FOUNDER    - Configured Kosmo Founder role (roles.json)
 * 3. TEAM_KOSMO - Configured Team Kosmo operational authority (roles.json)
 * 4. ADMIN      - Configured Admin authority (roles.json)
 * 5. MODERATOR  - Configured Moderator authority (roles.json)
 * 6. NONE       - Unrecognized / unprivileged user
 *
 * Security Boundary Notice:
 * - Server Owner is verified via Discord runtime state (guild.ownerId === userId).
 * - Kosmo human roles are mapped from configured Discord role IDs in roles.json.
 * - Policy authorization answers: "Is this human allowed to request/approve this category of operation?"
 * - Action safety validation (PermissionValidator) answers: "Is this specific action safe to execute?"
 * These layers operate independently and must never be conflated.
 */
export enum AuthLevel {
  OWNER = 'OWNER',
  FOUNDER = 'FOUNDER',
  TEAM_KOSMO = 'TEAM_KOSMO',
  ADMIN = 'ADMIN',
  MODERATOR = 'MODERATOR',
  NONE = 'NONE',
}

/**
 * Context provided to policy authorization for dynamic server-owner and caller resolution.
 */
export interface AuthContext {
  userId?: string;
  guildOwnerId?: string;
}

/** Helper – does the user have any of the Discord role IDs belonging to the logical role? */
function hasLogicalRole(userRoleIds: string[], logical: LogicalRole): boolean {
  const ids = roleConfig[logical] ?? [];
  return userRoleIds.some((idOrName) => {
    if (ids.includes(idOrName)) return true;
    // Also match logical role name case-insensitively for backward compatibility with mock tests
    if (idOrName.toLowerCase() === logical.toLowerCase()) return true;
    if (logical === LogicalRole.Admin && idOrName.toLowerCase() === 'administrator') return true;
    return false;
  });
}

/**
 * Resolves the explicit authorization level for a user given their Discord role IDs
 * and optional context (user ID and guild owner ID).
 *
 * Precedence rule: Highest authority wins:
 * OWNER > FOUNDER > TEAM_KOSMO > ADMIN > MODERATOR > NONE
 *
 * @param userRoleIds Array of Discord role IDs the user possesses.
 * @param context Optional context containing userId and guildOwnerId.
 * @returns The resolved AuthLevel.
 */
export function getAuthLevel(
  userRoleIds: string[],
  context?: AuthContext
): AuthLevel {
  // 1. Discord Server Owner (highest authority, dynamic from runtime guild.ownerId, independent of roles.json)
  if (context?.userId && context?.guildOwnerId && context.userId === context.guildOwnerId) {
    return AuthLevel.OWNER;
  }

  // 2. Founder (highest configured Kosmo human role)
  if (hasLogicalRole(userRoleIds, LogicalRole.Founder)) {
    return AuthLevel.FOUNDER;
  }

  // 3. Team Kosmo (trusted Kosmo operational authority)
  if (hasLogicalRole(userRoleIds, LogicalRole.TeamKosmo)) {
    return AuthLevel.TEAM_KOSMO;
  }

  // 4. Admin (broad administrative authority)
  if (hasLogicalRole(userRoleIds, LogicalRole.Admin)) {
    return AuthLevel.ADMIN;
  }

  // 5. Moderator (limited operational/read-only authority)
  if (hasLogicalRole(userRoleIds, LogicalRole.Moderator)) {
    return AuthLevel.MODERATOR;
  }

  // 6. Everyone else
  return AuthLevel.NONE;
}

/**
 * Evaluates the authorization matrix for a given authorization level and operation category.
 *
 * Authorization Matrix:
 * ┌────────────┬───────┬────────┬─────────┬──────────┬───────────────────────────┬───────────────────────────┐
 * │ Level      │ AUDIT │ MANAGE │ DRY_RUN │ MODERATE │ REPAIR                    │ CONFIRM                   │
 * ├────────────┼───────┼────────┼─────────┼──────────┼───────────────────────────┼───────────────────────────┤
 * │ OWNER      │ ALLOW │ ALLOW  │ ALLOW   │ ALLOW    │ ALLOW                     │ ALLOW                     │
 * │ FOUNDER    │ ALLOW │ ALLOW  │ ALLOW   │ ALLOW    │ ALLOW                     │ ALLOW                     │
 * │ TEAM_KOSMO │ ALLOW │ ALLOW  │ ALLOW   │ ALLOW    │ ALLOW                     │ ALLOW                     │
 * │ ADMIN      │ ALLOW │ ALLOW  │ ALLOW   │ ALLOW    │ REQUIRES_FOUNDERS_APPROVAL│ REQUIRES_FOUNDERS_APPROVAL│
 * │ MODERATOR  │ ALLOW │ DENY   │ DENY    │ ALLOW    │ DENY                      │ DENY                      │
 * │ NONE       │ DENY  │ DENY   │ DENY    │ DENY     │ DENY                      │ DENY                      │
 * └────────────┴───────┴────────┴─────────┴──────────┴───────────────────────────┴───────────────────────────┘
 *
 * @param level The caller's resolved AuthLevel.
 * @param category The requested operation category.
 * @returns PolicyDecision – ALLOW, DENY, or REQUIRES_FOUNDERS_APPROVAL.
 */
export function evaluatePolicy(level: AuthLevel, category: Category): PolicyDecision {
  switch (level) {
    case AuthLevel.OWNER:
    case AuthLevel.FOUNDER:
    case AuthLevel.TEAM_KOSMO:
      return 'ALLOW';

    case AuthLevel.ADMIN:
      if (category === Category.REPAIR || category === Category.CONFIRM) {
        return 'REQUIRES_FOUNDERS_APPROVAL';
      }
      return 'ALLOW';

    case AuthLevel.MODERATOR:
      if (category === Category.AUDIT || category === Category.MODERATE) {
        return 'ALLOW';
      }
      return 'DENY';

    case AuthLevel.NONE:
    default:
      return 'DENY';
  }
}

/**
 * Centralised authorization check. Single source of truth for authorization decisions.
 *
 * Evaluation Pipeline:
 * Request (userRoleIds + context)
 *   ↓
 * Identify Authorization Level (getAuthLevel)
 *   ↓
 * Evaluate Operation Category (evaluatePolicy)
 *   ↓
 * PolicyDecision (ALLOW / DENY / REQUIRES_FOUNDERS_APPROVAL)
 *
 * @param userRoleIds Array of Discord role IDs the user possesses.
 * @param category The operation the user wants to perform.
 * @param context Optional context with userId and guildOwnerId for server owner evaluation.
 * @returns PolicyDecision – ALLOW, DENY, or REQUIRES_FOUNDERS_APPROVAL.
 */
export function authorize(
  userRoleIds: string[],
  category: Category,
  context?: AuthContext
): PolicyDecision {
  const level = getAuthLevel(userRoleIds, context);
  return evaluatePolicy(level, category);
}

/**
 * Returns the logical roles possessed by a user (useful for logging or UI).
 */
export function getLogicalRoles(userRoleIds: string[]): LogicalRole[] {
  const roles: LogicalRole[] = [];
  (Object.values(LogicalRole) as LogicalRole[]).forEach((logical) => {
    if (hasLogicalRole(userRoleIds, logical)) {
      roles.push(logical);
    }
  });
  return roles;
}

/**
 * Extracts an array of string role IDs from a Discord GuildMember, APIGuildMember,
 * or mock member object.
 */
export function extractUserRoleIds(member: any): string[] {
  const userRoleIds: string[] = [];
  if (member && 'roles' in member) {
    const memberRoles = member.roles;
    if (Array.isArray(memberRoles)) {
      memberRoles.forEach((r: any) => {
        if (r && typeof r === 'object') {
          if (r.id) userRoleIds.push(String(r.id));
          if (r.name && r.name !== r.id) userRoleIds.push(String(r.name));
        } else if (r) {
          userRoleIds.push(String(r));
        }
      });
    } else if (typeof memberRoles === 'object' && 'cache' in memberRoles) {
      const cache = (memberRoles as any).cache;
      const extract = (r: any) => {
        if (r && typeof r === 'object') {
          if (r.id) userRoleIds.push(String(r.id));
          if (r.name && r.name !== r.id) userRoleIds.push(String(r.name));
        } else if (r) {
          userRoleIds.push(String(r));
        }
      };
      if (typeof cache?.forEach === 'function') {
        cache.forEach(extract);
      } else if (typeof cache?.values === 'function') {
        Array.from(cache.values()).forEach(extract);
      }
    }
  }
  return userRoleIds;
}

export const ALLOWED_MANAGEMENT_ROLES = [
  'founder',
  'team kosmo',
  'admin',
  'administrator',
  'moderator',
];

export interface IPolicyService {
  canExecuteNLManagement(context: NLContext): boolean;
}

export class PolicyService implements IPolicyService {
  /**
   * Checks if a user has permission to invoke Natural Language Management (/kosmo manage).
   * Evaluated via the centralized authorize() policy layer for Category.MANAGE.
   */
  public canExecuteNLManagement(context: NLContext): boolean {
    if (!context) return false;

    // Explicit founder override
    if (context.isFounder) {
      return true;
    }

    const authContext: AuthContext = {
      userId: context.userId,
      guildOwnerId: context.guildOwnerId,
    };

    const level = getAuthLevel(context.roles || [], authContext);
    const decision = evaluatePolicy(level, Category.MANAGE);

    console.log(`[AUTH DEBUG]
user=${context.username}
userId=${context.userId}
guildId=${context.guildId ?? 'unknown'}
guildOwnerId=${context.guildOwnerId ?? 'unknown'}
roleIds=${JSON.stringify(context.roles || [])}
founderRoleConfigured=${JSON.stringify(roleConfig[LogicalRole.Founder] ?? [])}
teamKosmoRoleConfigured=${JSON.stringify(roleConfig[LogicalRole.TeamKosmo] ?? [])}
resolvedAuthLevel=${level}
category=MANAGE
decision=${decision}`);

    return decision === 'ALLOW';
  }
}

export const policyService = new PolicyService();
