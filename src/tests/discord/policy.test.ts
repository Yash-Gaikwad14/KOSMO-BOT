// src/tests/discord/policy.test.ts

import {
  authorize,
  Category,
  PolicyDecision,
  getLogicalRoles,
  LogicalRole,
  AuthLevel,
  getAuthLevel,
  evaluatePolicy,
} from '../../services/discord/policy';

describe('Phase 3C Human Authorization Model (Policy Layer)', () => {
  const founder = ['111111111111111111'];
  const teamKosmo = ['222222222222222222'];
  const admin = ['333333333333333333'];
  const moderator = ['444444444444444444'];
  const unknown = ['999999999999999999'];
  const empty: string[] = [];

  // =========================================================================
  // 1. SERVER OWNER AUTHORIZATION
  // =========================================================================
  describe('Server Owner Authorization (Dynamic guild.ownerId)', () => {
    const ownerContext = { userId: 'owner-user-123', guildOwnerId: 'owner-user-123' };
    const nonOwnerContext = { userId: 'regular-user-456', guildOwnerId: 'owner-user-123' };

    test('owner with no configured role is allowed for all categories', () => {
      expect(getAuthLevel(empty, ownerContext)).toBe(AuthLevel.OWNER);
      expect(authorize(empty, Category.AUDIT, ownerContext)).toBe('ALLOW');
      expect(authorize(empty, Category.MANAGE, ownerContext)).toBe('ALLOW');
      expect(authorize(empty, Category.DRY_RUN, ownerContext)).toBe('ALLOW');
      expect(authorize(empty, Category.REPAIR, ownerContext)).toBe('ALLOW');
      expect(authorize(empty, Category.CONFIRM, ownerContext)).toBe('ALLOW');
      expect(authorize(empty, Category.MODERATE, ownerContext)).toBe('ALLOW');
    });

    test('owner with Founder role is allowed (owner takes precedence)', () => {
      expect(getAuthLevel(founder, ownerContext)).toBe(AuthLevel.OWNER);
      expect(authorize(founder, Category.AUDIT, ownerContext)).toBe('ALLOW');
      expect(authorize(founder, Category.MANAGE, ownerContext)).toBe('ALLOW');
      expect(authorize(founder, Category.DRY_RUN, ownerContext)).toBe('ALLOW');
      expect(authorize(founder, Category.REPAIR, ownerContext)).toBe('ALLOW');
      expect(authorize(founder, Category.CONFIRM, ownerContext)).toBe('ALLOW');
      expect(authorize(founder, Category.MODERATE, ownerContext)).toBe('ALLOW');
    });

    test('owner with unrelated role is allowed for all categories', () => {
      expect(getAuthLevel(unknown, ownerContext)).toBe(AuthLevel.OWNER);
      expect(authorize(unknown, Category.AUDIT, ownerContext)).toBe('ALLOW');
      expect(authorize(unknown, Category.MANAGE, ownerContext)).toBe('ALLOW');
      expect(authorize(unknown, Category.DRY_RUN, ownerContext)).toBe('ALLOW');
      expect(authorize(unknown, Category.REPAIR, ownerContext)).toBe('ALLOW');
      expect(authorize(unknown, Category.CONFIRM, ownerContext)).toBe('ALLOW');
      expect(authorize(unknown, Category.MODERATE, ownerContext)).toBe('ALLOW');
    });

    test('non-owner caller does not receive owner authorization', () => {
      expect(getAuthLevel(empty, nonOwnerContext)).toBe(AuthLevel.NONE);
      expect(authorize(empty, Category.AUDIT, nonOwnerContext)).toBe('DENY');
    });
  });

  // =========================================================================
  // 2. FOUNDER AUTHORIZATION
  // =========================================================================
  describe('Founder Authorization', () => {
    test('Founder resolves to FOUNDER AuthLevel', () => {
      expect(getAuthLevel(founder)).toBe(AuthLevel.FOUNDER);
    });

    test('Founder is allowed for normal management categories', () => {
      expect(authorize(founder, Category.AUDIT)).toBe('ALLOW');
      expect(authorize(founder, Category.MANAGE)).toBe('ALLOW');
      expect(authorize(founder, Category.DRY_RUN)).toBe('ALLOW');
    });

    test('Founder is allowed for high-level operations (repair and confirmation)', () => {
      expect(authorize(founder, Category.REPAIR)).toBe('ALLOW');
      expect(authorize(founder, Category.CONFIRM)).toBe('ALLOW');
      expect(authorize(founder, Category.MODERATE)).toBe('ALLOW');
    });
  });

  // =========================================================================
  // 3. TEAM KOSMO AUTHORIZATION
  // =========================================================================
  describe('Team Kosmo Authorization', () => {
    test('Team Kosmo resolves to TEAM_KOSMO AuthLevel', () => {
      expect(getAuthLevel(teamKosmo)).toBe(AuthLevel.TEAM_KOSMO);
    });

    test('Team Kosmo is allowed for all management categories', () => {
      expect(authorize(teamKosmo, Category.AUDIT)).toBe('ALLOW');
      expect(authorize(teamKosmo, Category.MANAGE)).toBe('ALLOW');
      expect(authorize(teamKosmo, Category.DRY_RUN)).toBe('ALLOW');
      expect(authorize(teamKosmo, Category.REPAIR)).toBe('ALLOW');
      expect(authorize(teamKosmo, Category.CONFIRM)).toBe('ALLOW');
      expect(authorize(teamKosmo, Category.MODERATE)).toBe('ALLOW');
    });
  });

  // =========================================================================
  // 4. ADMIN AUTHORIZATION
  // =========================================================================
  describe('Admin Authorization', () => {
    test('Admin resolves to ADMIN AuthLevel', () => {
      expect(getAuthLevel(admin)).toBe(AuthLevel.ADMIN);
    });

    test('Admin is allowed for audit, manage, and dry-run', () => {
      expect(authorize(admin, Category.AUDIT)).toBe('ALLOW');
      expect(authorize(admin, Category.MANAGE)).toBe('ALLOW');
      expect(authorize(admin, Category.DRY_RUN)).toBe('ALLOW');
      expect(authorize(admin, Category.MODERATE)).toBe('ALLOW');
    });

    test('Admin preserves existing high-risk repair approval behavior', () => {
      expect(authorize(admin, Category.REPAIR)).toBe('REQUIRES_FOUNDERS_APPROVAL');
    });

    test('Admin confirmation requires founders approval and is not silently granted', () => {
      expect(authorize(admin, Category.CONFIRM)).toBe('REQUIRES_FOUNDERS_APPROVAL');
    });
  });

  // =========================================================================
  // 5. MODERATOR AUTHORIZATION
  // =========================================================================
  describe('Moderator Authorization', () => {
    test('Moderator resolves to MODERATOR AuthLevel', () => {
      expect(getAuthLevel(moderator)).toBe(AuthLevel.MODERATOR);
    });

    test('Moderator is allowed for read-only audit', () => {
      expect(authorize(moderator, Category.AUDIT)).toBe('ALLOW');
    });

    test('Moderator is denied for repair', () => {
      expect(authorize(moderator, Category.REPAIR)).toBe('DENY');
    });

    test('Moderator is denied for confirmation', () => {
      expect(authorize(moderator, Category.CONFIRM)).toBe('DENY');
    });

    test('Moderator is denied for management planning and dry-run', () => {
      expect(authorize(moderator, Category.MANAGE)).toBe('DENY');
      expect(authorize(moderator, Category.DRY_RUN)).toBe('DENY');
    });

    test('Moderator is allowed for member moderation (Phase 4D Category.MODERATE)', () => {
      expect(authorize(moderator, Category.MODERATE)).toBe('ALLOW');
    });
  });

  // =========================================================================
  // 6. NONE / UNRECOGNIZED USERS
  // =========================================================================
  describe('None / Unrecognized Users', () => {
    test('Unknown role IDs resolve to NONE AuthLevel', () => {
      expect(getAuthLevel(unknown)).toBe(AuthLevel.NONE);
      expect(getAuthLevel(empty)).toBe(AuthLevel.NONE);
    });

    test('Denied for all protected Kosmo operation categories', () => {
      expect(authorize(unknown, Category.AUDIT)).toBe('DENY');
      expect(authorize(unknown, Category.MANAGE)).toBe('DENY');
      expect(authorize(unknown, Category.DRY_RUN)).toBe('DENY');
      expect(authorize(unknown, Category.REPAIR)).toBe('DENY');
      expect(authorize(unknown, Category.CONFIRM)).toBe('DENY');
      expect(authorize(unknown, Category.MODERATE)).toBe('DENY');

      expect(authorize(empty, Category.AUDIT)).toBe('DENY');
      expect(authorize(empty, Category.MANAGE)).toBe('DENY');
      expect(authorize(empty, Category.DRY_RUN)).toBe('DENY');
      expect(authorize(empty, Category.REPAIR)).toBe('DENY');
      expect(authorize(empty, Category.CONFIRM)).toBe('DENY');
      expect(authorize(empty, Category.MODERATE)).toBe('DENY');
    });
  });

  // =========================================================================
  // 7. ROLE COMBINATIONS (PRECEDENCE)
  // =========================================================================
  describe('Role Combinations and Precedence Rules', () => {
    test('Founder + Moderator resolves to Founder precedence', () => {
      const combined = [...founder, ...moderator];
      expect(getAuthLevel(combined)).toBe(AuthLevel.FOUNDER);
      expect(authorize(combined, Category.REPAIR)).toBe('ALLOW');
      expect(authorize(combined, Category.MANAGE)).toBe('ALLOW');
    });

    test('Team Kosmo + Moderator resolves to Team Kosmo precedence', () => {
      const combined = [...teamKosmo, ...moderator];
      expect(getAuthLevel(combined)).toBe(AuthLevel.TEAM_KOSMO);
      expect(authorize(combined, Category.REPAIR)).toBe('ALLOW');
      expect(authorize(combined, Category.MANAGE)).toBe('ALLOW');
    });

    test('Admin + Moderator resolves to Admin precedence', () => {
      const combined = [...admin, ...moderator];
      expect(getAuthLevel(combined)).toBe(AuthLevel.ADMIN);
      expect(authorize(combined, Category.MANAGE)).toBe('ALLOW');
      expect(authorize(combined, Category.REPAIR)).toBe('REQUIRES_FOUNDERS_APPROVAL');
    });

    test('Owner context + any role combination resolves to Owner precedence', () => {
      const ownerContext = { userId: 'owner-id', guildOwnerId: 'owner-id' };
      const combined = [...admin, ...moderator, ...unknown];
      expect(getAuthLevel(combined, ownerContext)).toBe(AuthLevel.OWNER);
      expect(authorize(combined, Category.REPAIR, ownerContext)).toBe('ALLOW');
    });
  });

  // =========================================================================
  // 8. DIRECT MATRIX EVALUATION
  // =========================================================================
  describe('evaluatePolicy Direct Matrix Evaluation', () => {
    test('OWNER, FOUNDER, and TEAM_KOSMO have ALLOW across all categories', () => {
      const fullAccessLevels = [AuthLevel.OWNER, AuthLevel.FOUNDER, AuthLevel.TEAM_KOSMO];
      const allCategories = [
        Category.AUDIT,
        Category.MANAGE,
        Category.DRY_RUN,
        Category.REPAIR,
        Category.CONFIRM,
      ];

      for (const level of fullAccessLevels) {
        for (const cat of allCategories) {
          expect(evaluatePolicy(level, cat)).toBe('ALLOW');
        }
      }
    });

    test('ADMIN has restricted repair and confirm', () => {
      expect(evaluatePolicy(AuthLevel.ADMIN, Category.AUDIT)).toBe('ALLOW');
      expect(evaluatePolicy(AuthLevel.ADMIN, Category.MANAGE)).toBe('ALLOW');
      expect(evaluatePolicy(AuthLevel.ADMIN, Category.DRY_RUN)).toBe('ALLOW');
      expect(evaluatePolicy(AuthLevel.ADMIN, Category.REPAIR)).toBe('REQUIRES_FOUNDERS_APPROVAL');
      expect(evaluatePolicy(AuthLevel.ADMIN, Category.CONFIRM)).toBe('REQUIRES_FOUNDERS_APPROVAL');
    });

    test('MODERATOR is read-only audit only', () => {
      expect(evaluatePolicy(AuthLevel.MODERATOR, Category.AUDIT)).toBe('ALLOW');
      expect(evaluatePolicy(AuthLevel.MODERATOR, Category.MANAGE)).toBe('DENY');
      expect(evaluatePolicy(AuthLevel.MODERATOR, Category.DRY_RUN)).toBe('DENY');
      expect(evaluatePolicy(AuthLevel.MODERATOR, Category.REPAIR)).toBe('DENY');
      expect(evaluatePolicy(AuthLevel.MODERATOR, Category.CONFIRM)).toBe('DENY');
    });

    test('NONE is denied across all categories', () => {
      const allCategories = [
        Category.AUDIT,
        Category.MANAGE,
        Category.DRY_RUN,
        Category.REPAIR,
        Category.CONFIRM,
      ];
      for (const cat of allCategories) {
        expect(evaluatePolicy(AuthLevel.NONE, cat)).toBe('DENY');
      }
    });
  });

  // =========================================================================
  // 9. LOGICAL ROLE RETRIEVAL
  // =========================================================================
  describe('getLogicalRoles', () => {
    test('getLogicalRoles returns correct logical roles', () => {
      expect(getLogicalRoles(founder)).toContain(LogicalRole.Founder);
      expect(getLogicalRoles(teamKosmo)).toContain(LogicalRole.TeamKosmo);
      expect(getLogicalRoles(admin)).toContain(LogicalRole.Admin);
      expect(getLogicalRoles(moderator)).toContain(LogicalRole.Moderator);
      expect(getLogicalRoles(unknown)).toHaveLength(0);
    });
  });
});
