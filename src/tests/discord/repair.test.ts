// src/tests/discord/repair.test.ts

import { generateRepairPlan } from '../../services/discord/repair';
import { LogicalRole } from '../../services/discord/policy';

import type { RepairInput } from '../../types/repair.d';
import type { AuditReport, RoleInfo, ChannelInfo, CommandInfo } from '../../types/audit.d';
import type { DesiredState } from '../../types/desiredState.d';

/** Helper to create a minimal audit report */
function makeAudit(overrides?: Partial<AuditReport>): AuditReport {
  const base: AuditReport = {
    guild: { id: '12345', name: 'TestGuild' },
    roles: [],
    channels: [],
    commands: [],
    hasDesiredStateConfig: true,
    ...overrides,
  } as AuditReport;
  return base;
}

/** Minimal desired state for tests */
function makeDesired(overrides?: Partial<DesiredState>): DesiredState {
  const base: DesiredState = {
    guildId: 'GUILD_ID_PLACEHOLDER',
    roles: [],
    channels: [],
    permissionTemplates: [],
    commands: [],
    ...overrides,
  } as DesiredState;
  return base;
}

const founderRoleIds = ['111111111111111111'];

describe('Repair planning', () => {
  test('clean audit produces zero actions', () => {
    const audit = makeAudit({
      roles: [{ id: 'r1', name: 'Founder', position: 4, permissions: '0' }],
    });
    const desired = makeDesired({
      roles: [{ logical: LogicalRole.Founder, name: 'Founder', position: 4, permissions: ['ADMINISTRATOR'] }],
    });
    const input: RepairInput = { audit, desired, userRoleIds: founderRoleIds };
    const result = generateRepairPlan(input);
    expect(result.actions).toHaveLength(0);
    expect(result.status).toBe('READY');
  });

  test('missing role generates createRole action', () => {
    const audit = makeAudit({ roles: [] });
    const desired = makeDesired({
      roles: [{ logical: LogicalRole.Admin, name: 'Admin', position: 2, permissions: ['MANAGE_MESSAGES'] }],
    });
    const input: RepairInput = { audit, desired, userRoleIds: founderRoleIds };
    const result = generateRepairPlan(input);
    expect(result.actions).toEqual([
      { type: 'createRole', payload: { name: 'Admin' } },
    ]);
    expect(result.summary?.missingRoles).toContain('Admin');
  });

  test('missing channel generates createChannel action', () => {
    const audit = makeAudit({ channels: [] });
    const desired = makeDesired({
      channels: [{ name: 'general', type: 'GUILD_TEXT' }],
    });
    const input: RepairInput = { audit, desired, userRoleIds: founderRoleIds };
    const result = generateRepairPlan(input);
    expect(result.actions).toContainEqual({ type: 'createChannel', payload: { name: 'general', type: 'GUILD_TEXT' } });
  });

  test('permission template drift emits applyPermissionTemplate', () => {
    const audit = makeAudit({
      roles: [{ id: 'r1', name: 'Everyone', position: 0, permissions: '0' }],
      channels: [
        {
          id: 'c1',
          name: 'rules',
          type: 'GUILD_TEXT',
          parentId: null,
          permissionOverwrites: [],
        },
      ],
    });
    const desired = makeDesired({
      channels: [
        { name: 'rules', type: 'GUILD_TEXT', permissionTemplate: 'PUBLIC_READONLY' },
      ],
      permissionTemplates: [
        {
          name: 'PUBLIC_READONLY',
          overwrites: [
            { id: 'role:Everyone', allow: ['VIEW_CHANNEL'], deny: ['SEND_MESSAGES'] },
          ],
        },
      ],
    });
    const input: RepairInput = { audit, desired, userRoleIds: founderRoleIds };
    const result = generateRepairPlan(input);
    expect(result.actions).toContainEqual({
      type: 'applyPermissionTemplate',
      payload: {
        targetName: 'rules',
        permissionOverwrites: [{ id: 'r1', allow: ['VIEW_CHANNEL'], deny: ['SEND_MESSAGES'] }],
      },
    });
  });

  test('unresolved placeholder adds warning and no action', () => {
    const audit = makeAudit({
      roles: [],
      channels: [
        {
          id: 'c1',
          name: 'public',
          type: 'GUILD_TEXT',
          parentId: null,
          permissionOverwrites: [],
        },
      ],
    });
    const desired = makeDesired({
      channels: [
        { name: 'public', type: 'GUILD_TEXT', permissionTemplate: 'UNKNOWN' },
      ],
      permissionTemplates: [
        { name: 'UNKNOWN', overwrites: [{ id: 'role:Missing', allow: [], deny: [] }] },
      ],
    });
    const input: RepairInput = { audit, desired, userRoleIds: founderRoleIds };
    const result = generateRepairPlan(input);
    expect(result.actions).toHaveLength(0);
    expect(result.warnings?.some((w) => w.includes('Unable to resolve placeholder'))).toBe(true);
  });

  test('unauthorized user results in denied repair', () => {
    const audit = makeAudit();
    const desired = makeDesired();
    const input: RepairInput = { audit, desired, userRoleIds: [] };
    const result = generateRepairPlan(input);
    expect(result.status).toBe('DENIED');
    expect(result.actions).toHaveLength(0);
    expect(result.errors?.some((e) => e.includes('not authorized'))).toBe(true);
  });
});
