import { Guild } from 'discord.js';
import { validateAction, PermissionValidator } from '../../services/discord/permissionValidator';
import { DiscordAction } from '../../services/discord/types';

const mockGuild = {} as unknown as Guild;

describe('PermissionValidator Safety Constraints', () => {
  test('rejects privileged role creation', () => {
    const action: DiscordAction = { type: 'createRole', payload: { name: 'Founder' } };
    expect(() => validateAction(mockGuild, action)).toThrow(/privileged role/);
  });

  test('allows non‑privileged role creation', () => {
    const action: DiscordAction = { type: 'createRole', payload: { name: 'Member' } };
    expect(() => validateAction(mockGuild, action)).not.toThrow();
  });

  // Phase 3D Destructive Action Validation Tests
  test('validates deleteChannel action with valid name', () => {
    const action: DiscordAction = { type: 'deleteChannel', payload: { channelName: 'old-chat' } };
    const res = PermissionValidator.validateAction(action);
    expect(res.valid).toBe(true);
    expect(res.blocked).toBe(false);
  });

  test('rejects deleteChannel action with empty name', () => {
    const action: DiscordAction = { type: 'deleteChannel', payload: { channelName: '   ' } };
    const res = PermissionValidator.validateAction(action);
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('Channel name cannot be empty for deletion.');
  });

  test('validates deleteCategory action with valid name', () => {
    const action: DiscordAction = { type: 'deleteCategory', payload: { categoryName: 'ARCHIVED' } };
    const res = PermissionValidator.validateAction(action);
    expect(res.valid).toBe(true);
    expect(res.blocked).toBe(false);
  });

  test('rejects deleteCategory action with empty name', () => {
    const action: DiscordAction = { type: 'deleteCategory', payload: { categoryName: '' } };
    const res = PermissionValidator.validateAction(action);
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('Category name cannot be empty for deletion.');
  });

  test('validates deleteRole action for unprivileged roles', () => {
    const action: DiscordAction = { type: 'deleteRole', payload: { roleName: 'TemporaryGuest' } };
    const res = PermissionValidator.validateAction(action);
    expect(res.valid).toBe(true);
    expect(res.blocked).toBe(false);
  });

  test('blocks deletion of privileged roles (Founder, Admin, Moderator, etc.)', () => {
    const privilegedRoles = ['Founder', 'Admin', 'Administrator', 'Team Kosmo', 'Moderator', 'Owner'];
    for (const roleName of privilegedRoles) {
      const action: DiscordAction = { type: 'deleteRole', payload: { roleName } };
      const res = PermissionValidator.validateAction(action);
      expect(res.blocked).toBe(true);
      expect(res.valid).toBe(false);
      expect(res.blockedReasons?.[0]).toMatch(/Deletion of privileged role/i);
      expect(() => validateAction(mockGuild, action)).toThrow(/Deletion of privileged role/i);
    }
  });

  // Phase 4B Member Role Safety Tests
  test('allows normal non-privileged role assignment', () => {
    const action: DiscordAction = {
      type: 'assignRole',
      payload: { roleName: 'Community Member', memberId: '123456789' },
    };
    const res = PermissionValidator.validateAction(action);
    expect(res.valid).toBe(true);
    expect(res.blocked).toBe(false);
  });

  test('allows normal non-privileged role removal', () => {
    const action: DiscordAction = {
      type: 'removeRole',
      payload: { roleName: 'Beta Tester', memberId: '123456789' },
    };
    const res = PermissionValidator.validateAction(action);
    expect(res.valid).toBe(true);
    expect(res.blocked).toBe(false);
  });

  test('blocks Founder role assignment', () => {
    const action: DiscordAction = {
      type: 'assignRole',
      payload: { roleName: 'Founder', memberId: '123456789' },
    };
    const res = PermissionValidator.validateAction(action);
    expect(res.valid).toBe(false);
    expect(res.blocked).toBe(true);
    expect(res.blockedReasons?.[0]).toMatch(/privileged role/i);
    expect(() => validateAction(mockGuild, action)).toThrow(/privileged role/i);
  });

  test('blocks Admin role assignment', () => {
    const action: DiscordAction = {
      type: 'assignRole',
      payload: { roleName: 'Admin', memberId: '123456789' },
    };
    const res = PermissionValidator.validateAction(action);
    expect(res.valid).toBe(false);
    expect(res.blocked).toBe(true);
    expect(res.blockedReasons?.[0]).toMatch(/privileged role/i);
    expect(() => validateAction(mockGuild, action)).toThrow(/privileged role/i);
  });

  test('blocks Moderator role assignment', () => {
    const action: DiscordAction = {
      type: 'assignRole',
      payload: { roleName: 'Moderator', memberId: '123456789' },
    };
    const res = PermissionValidator.validateAction(action);
    expect(res.valid).toBe(false);
    expect(res.blocked).toBe(true);
    expect(res.blockedReasons?.[0]).toMatch(/privileged role/i);
    expect(() => validateAction(mockGuild, action)).toThrow(/privileged role/i);
  });

  test('blocks Founder role removal', () => {
    const action: DiscordAction = {
      type: 'removeRole',
      payload: { roleName: 'Founder', memberId: '123456789' },
    };
    const res = PermissionValidator.validateAction(action);
    expect(res.valid).toBe(false);
    expect(res.blocked).toBe(true);
    expect(res.blockedReasons?.[0]).toMatch(/privileged role/i);
    expect(() => validateAction(mockGuild, action)).toThrow(/privileged role/i);
  });

  test('blocks Admin role removal', () => {
    const action: DiscordAction = {
      type: 'removeRole',
      payload: { roleName: 'Admin', memberId: '123456789' },
    };
    const res = PermissionValidator.validateAction(action);
    expect(res.valid).toBe(false);
    expect(res.blocked).toBe(true);
    expect(res.blockedReasons?.[0]).toMatch(/privileged role/i);
    expect(() => validateAction(mockGuild, action)).toThrow(/privileged role/i);
  });

  // Permission template targetName validation tests
  describe('applyPermissionTemplate targetName validation', () => {
    test('rejects targetName that resolves to a role name', () => {
      const roleNames = [
        'Tech & Engineering',
        'Business & Strategy',
        'Academia & Education',
        'Law & Compliance',
        'Creative & Design',
        'Founder',
        'Team Kosmo',
        'Moderator',
      ];

      for (const roleName of roleNames) {
        const action: DiscordAction = {
          type: 'applyPermissionTemplate',
          payload: {
            targetName: roleName,
            permissionOverwrites: [{ id: '@everyone', deny: ['ViewChannel'] }],
          },
        };
        const res = PermissionValidator.validateAction(action);
        expect(res.valid).toBe(false);
        expect(res.blocked).toBe(true);
        expect(res.blockedReasons?.[0]).toMatch(/is a role name/i);
      }
    });

    test('rejects role-derived slugs that are not channel targets (e.g. academia-and-education)', () => {
      const invalidRoleSlugs = [
        'academia-and-education',
        'law-and-compliance',
        'creative-and-design',
        'kosmo-founder',
        'team-kosmo',
      ];

      for (const slug of invalidRoleSlugs) {
        const action: DiscordAction = {
          type: 'applyPermissionTemplate',
          payload: {
            targetName: slug,
            permissionOverwrites: [{ id: '@everyone', deny: ['ViewChannel'] }],
          },
        };
        const res = PermissionValidator.validateAction(action);
        expect(res.valid).toBe(false);
        expect(res.blocked).toBe(true);
        expect(res.blockedReasons?.[0]).toMatch(/is a role name/i);
      }
    });

    test('allows valid Guild Discussion channel targets', () => {
      const validChannels = [
        'tech-and-engineering',
        'business-and-strategy',
        'academia-and-research',
        'legal-and-policy',
        'creatives-lounge',
        '#tech-and-engineering',
        '#academia-and-research',
      ];

      for (const chan of validChannels) {
        const action: DiscordAction = {
          type: 'applyPermissionTemplate',
          payload: {
            targetName: chan,
            permissionOverwrites: [{ id: '@everyone', deny: ['ViewChannel'] }],
          },
        };
        const res = PermissionValidator.validateAction(action);
        expect(res.valid).toBe(true);
        expect(res.blocked).toBe(false);
      }
    });
  });
});
