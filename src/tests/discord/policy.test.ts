// src/tests/discord/policy.test.ts

import { authorize, Category, PolicyDecision, getLogicalRoles, LogicalRole } from '../../services/discord/policy';

describe('Policy Layer Authorization', () => {
  const founder = ['111111111111111111'];
  const teamKosmo = ['222222222222222222'];
  const admin = ['333333333333333333'];
  const moderator = ['444444444444444444'];
  const unknown = ['999999999999999999'];

  test('Founder has full access', () => {
    expect(authorize(founder, Category.AUDIT)).toBe('ALLOW');
    expect(authorize(founder, Category.REPAIR)).toBe('ALLOW');
    expect(authorize(founder, Category.DRY_RUN)).toBe('ALLOW');
    expect(authorize(founder, Category.MANAGE)).toBe('ALLOW');
  });

  test('Team Kosmo has full access', () => {
    expect(authorize(teamKosmo, Category.REPAIR)).toBe('ALLOW');
    expect(authorize(teamKosmo, Category.MANAGE)).toBe('ALLOW');
  });

  test('Admin can audit but repair requires founder approval', () => {
    expect(authorize(admin, Category.AUDIT)).toBe('ALLOW');
    expect(authorize(admin, Category.DRY_RUN)).toBe('ALLOW');
    expect(authorize(admin, Category.REPAIR)).toBe('REQUIRES_FOUNDERS_APPROVAL');
  });

  test('Moderator can only audit', () => {
    expect(authorize(moderator, Category.AUDIT)).toBe('ALLOW');
    expect(authorize(moderator, Category.REPAIR)).toBe('DENY');
    expect(authorize(moderator, Category.DRY_RUN)).toBe('DENY');
  });

  test('Unknown user denied for all categories', () => {
    expect(authorize(unknown, Category.AUDIT)).toBe('DENY');
    expect(authorize(unknown, Category.REPAIR)).toBe('DENY');
    expect(authorize(unknown, Category.MANAGE)).toBe('DENY');
  });

  test('getLogicalRoles returns correct logical roles', () => {
    expect(getLogicalRoles(founder)).toContain(LogicalRole.Founder);
    expect(getLogicalRoles(teamKosmo)).toContain(LogicalRole.TeamKosmo);
    expect(getLogicalRoles(admin)).toContain(LogicalRole.Admin);
    expect(getLogicalRoles(moderator)).toContain(LogicalRole.Moderator);
    expect(getLogicalRoles(unknown)).toHaveLength(0);
  });
});
