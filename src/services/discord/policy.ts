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
const configPath = path.resolve(__dirname, '../../config/roles.json');
try {
  const raw = fs.readFileSync(configPath, { encoding: 'utf-8' });
  roleConfig = JSON.parse(raw);
} catch (e) {
  // If the file is missing we keep an empty config – the policy will simply deny.
  console.warn('Policy: could not read roles config', e);
}

/** Helper – does the user have any of the Discord role IDs belonging to the logical role? */
function hasLogicalRole(userRoleIds: string[], logical: LogicalRole): boolean {
  const ids = roleConfig[logical] ?? [];
  return userRoleIds.some((id) => ids.includes(id));
}

/**
 * Centralised authorization check.
 *
 * @param userRoleIds – array of Discord role IDs the user possesses.
 * @param category – the operation the user wants to perform.
 * @returns PolicyDecision – ALLOW, DENY, or REQUIRES_FOUNDERS_APPROVAL.
 */
export function authorize(userRoleIds: string[], category: Category): PolicyDecision {
  // Founder can always do everything.
  if (hasLogicalRole(userRoleIds, LogicalRole.Founder)) {
    return 'ALLOW';
  }

  // Team Kosmo has full privileges similar to Founder for Phase 3.
  if (hasLogicalRole(userRoleIds, LogicalRole.TeamKosmo)) {
    return 'ALLOW';
  }

  // Admins have broad permissions but repairs are considered high‑risk.
  if (hasLogicalRole(userRoleIds, LogicalRole.Admin)) {
    if (category === Category.REPAIR) {
      // Requires explicit Founder/Team approval.
      return 'REQUIRES_FOUNDERS_APPROVAL';
    }
    // All other categories are allowed.
    return 'ALLOW';
  }

  // Moderators can only perform safe, read‑only operations like AUDIT.
  if (hasLogicalRole(userRoleIds, LogicalRole.Moderator)) {
    if (category === Category.AUDIT) {
      return 'ALLOW';
    }
    return 'DENY';
  }

  // No recognised logical role – deny everything.
  return 'DENY';
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
   */
  public canExecuteNLManagement(context: NLContext): boolean {
    if (!context) return false;

    // Explicit founder override
    if (context.isFounder) {
      return true;
    }

    // Role check against authorized logical management roles
    const userRoles = (context.roles || []).map((r) => r.toLowerCase().trim());
    return userRoles.some((r) => ALLOWED_MANAGEMENT_ROLES.includes(r));
  }
}

export const policyService = new PolicyService();
