import { NLContext } from './types';

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
