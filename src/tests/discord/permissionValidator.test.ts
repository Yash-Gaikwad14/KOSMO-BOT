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
});
