// src/tests/discord/repair.test.ts

import { Guild, ChannelType } from 'discord.js';
import { generateRepairPlan } from '../../services/discord/repair';
import * as actionsModule from '../../services/discord/actions';
import { DesiredState } from '../../types/desiredState';

describe('Phase 3 Step 4: Repair Service (generateRepairPlan)', () => {
  const founderRoleIds = ['111111111111111111'];
  const teamKosmoRoleIds = ['222222222222222222'];
  const adminRoleIds = ['333333333333333333'];
  const moderatorRoleIds = ['444444444444444444'];
  const unauthorizedRoleIds = ['999999999999999999'];

  const sampleDesiredState: DesiredState = {
    guildId: 'test-guild-id',
    roles: [
      {
        logical: 'Founder' as any,
        name: 'Founder',
        position: 4,
        permissions: ['ADMINISTRATOR'],
      },
      {
        logical: 'Team Kosmo' as any,
        name: 'Team Kosmo',
        position: 3,
        permissions: ['MANAGE_GUILD'],
      },
      {
        logical: 'Admin' as any,
        name: 'Admin',
        position: 2,
        permissions: ['MANAGE_MESSAGES'],
      },
      {
        logical: 'Moderator' as any,
        name: 'Moderator',
        position: 1,
        permissions: ['KICK_MEMBERS'],
      },
      {
        logical: 'CommunityBuilder' as any,
        name: 'CommunityBuilder',
        position: 0,
        permissions: ['VIEW_CHANNEL'],
      },
    ],
    channels: [
      { name: 'Community', type: 'GUILD_CATEGORY' },
      { name: 'general', type: 'GUILD_TEXT', parent: 'Community', permissionTemplate: 'PUBLIC' },
      { name: 'announcements', type: 'GUILD_TEXT', parent: 'Community', permissionTemplate: 'PUBLIC_READONLY' },
      { name: 'voice-lobby', type: 'GUILD_VOICE', parent: 'Community' },
    ],
    permissionTemplates: [
      {
        name: 'PUBLIC_READONLY',
        overwrites: [
          { id: 'role:Everyone', allow: ['VIEW_CHANNEL'], deny: ['SEND_MESSAGES'] },
        ],
      },
      {
        name: 'PUBLIC',
        overwrites: [],
      },
    ],
  };

  const createMockGuild = (rolesMap = new Map(), channelsMap = new Map()): Guild => {
    return {
      id: 'test-guild-id',
      name: 'Test Guild',
      roles: {
        cache: rolesMap,
      },
      channels: {
        cache: channelsMap,
      },
    } as unknown as Guild;
  };

  let runActionSpy: jest.SpyInstance;

  beforeEach(() => {
    runActionSpy = jest.spyOn(actionsModule, 'runAction');
  });

  afterEach(() => {
    runActionSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // 1. Authorization Tests
  // -------------------------------------------------------------------------
  test('DENY -> returns status DENIED and 0 actions for unauthorized user', async () => {
    const mockGuild = createMockGuild();
    const result = await generateRepairPlan({
      guild: mockGuild,
      userRoleIds: unauthorizedRoleIds,
      desiredState: sampleDesiredState,
    });

    expect(result.status).toBe('DENIED');
    expect(result.actions).toEqual([]);
    expect(result.errors).toContain('Unauthorized: repair operation is not permitted for your role.');
    expect(runActionSpy).not.toHaveBeenCalled();
  });

  test('DENY -> returns status DENIED for Moderator (only allowed AUDIT)', async () => {
    const mockGuild = createMockGuild();
    const result = await generateRepairPlan({
      guild: mockGuild,
      userRoleIds: moderatorRoleIds,
      desiredState: sampleDesiredState,
    });

    expect(result.status).toBe('DENIED');
    expect(result.actions).toEqual([]);
    expect(runActionSpy).not.toHaveBeenCalled();
  });

  test('REQUIRES_FOUNDERS_APPROVAL -> returns status PENDING_APPROVAL for Admin', async () => {
    const mockGuild = createMockGuild();
    const result = await generateRepairPlan({
      guild: mockGuild,
      userRoleIds: adminRoleIds,
      desiredState: sampleDesiredState,
    });

    expect(result.status).toBe('PENDING_APPROVAL');
    expect(result.actions).toEqual([]);
    expect(result.warnings.some((w) => w.includes('Founder approval'))).toBe(true);
    expect(runActionSpy).not.toHaveBeenCalled();
  });

  test('ALLOW -> proceeds for Founder / Team Kosmo', async () => {
    const mockGuild = createMockGuild();
    const result = await generateRepairPlan({
      guild: mockGuild,
      userRoleIds: founderRoleIds,
      desiredState: sampleDesiredState,
    });

    expect(['READY', 'NO_OP']).toContain(result.status);
    expect(runActionSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 2. Create-Only Generation & Founder Drift Protection
  // -------------------------------------------------------------------------
  test('Missing roles and channels generate createRole, createChannel, applyPermissionTemplate actions', async () => {
    // Empty guild – everything missing
    const mockGuild = createMockGuild();
    const result = await generateRepairPlan({
      guild: mockGuild,
      userRoleIds: founderRoleIds,
      desiredState: sampleDesiredState,
    });

    expect(result.status).toBe('READY');
    expect(result.actions.length).toBeGreaterThan(0);

    // Verify all emitted action types are exclusively supported ones
    const allowedTypes = ['createRole', 'createChannel', 'applyPermissionTemplate', 'assignRole', 'removeRole'];
    result.actions.forEach((act) => {
      expect(allowedTypes).toContain(act.type);
    });

    // Founder drift protection: missing Founder role MUST NOT generate createRole action
    const founderCreateAction = result.actions.find(
      (a) => a.type === 'createRole' && a.payload.name === 'Founder'
    );
    expect(founderCreateAction).toBeUndefined();

    // Verify Founder drift was logged as DriftItem
    const founderDrift = result.driftItems.find((d) => d.type === 'FOUNDER_DRIFT');
    expect(founderDrift).toBeDefined();
    expect(founderDrift?.severity).toBe('PROTECTED');

    // Verify non-founder missing role was generated
    const communityBuilderAction = result.actions.find(
      (a) => a.type === 'createRole' && a.payload.name === 'CommunityBuilder'
    );
    expect(communityBuilderAction).toBeDefined();

    // Verify missing channel actions
    const generalChannelAction = result.actions.find(
      (a) => a.type === 'createChannel' && a.payload.name === 'general'
    );
    expect(generalChannelAction).toBeDefined();

    // Verify applyPermissionTemplate for announcements
    const templateAction = result.actions.find(
      (a) => a.type === 'applyPermissionTemplate' && a.payload.targetName === 'announcements'
    );
    expect(templateAction).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 3. Channel Type Mismatch Error Handling
  // -------------------------------------------------------------------------
  test('Channel type mismatch is treated as an error and produces NO mutation for that channel', async () => {
    const channelsMap = new Map();
    // 'Community' is expected as GUILD_CATEGORY (type 4), but exists as GUILD_TEXT (type 0)
    channelsMap.set('1', { id: '1', name: 'Community', type: ChannelType.GuildText });

    const mockGuild = createMockGuild(new Map(), channelsMap);
    const result = await generateRepairPlan({
      guild: mockGuild,
      userRoleIds: founderRoleIds,
      desiredState: sampleDesiredState,
    });

    // Should detect type mismatch
    const mismatchDrift = result.driftItems.find((d) => d.type === 'CHANNEL_TYPE_MISMATCH');
    expect(mismatchDrift).toBeDefined();
    expect(mismatchDrift?.severity).toBe('ERROR');
    expect(result.errors.some((e) => e.includes('type mismatch'))).toBe(true);

    // Should NOT emit a createChannel mutation for 'Community'
    const communityAction = result.actions.find(
      (a) => a.type === 'createChannel' && a.payload.name === 'Community'
    );
    expect(communityAction).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 4. Existing Resource Drift Treated as Warnings
  // -------------------------------------------------------------------------
  test('Existing roles and channels drift is reported as warnings in create-only mode', async () => {
    const rolesMap = new Map();
    rolesMap.set('1', { id: '1', name: 'Admin', position: 2 });
    const channelsMap = new Map();
    channelsMap.set('2', { id: '2', name: 'general', type: ChannelType.GuildText });

    const mockGuild = createMockGuild(rolesMap, channelsMap);
    const result = await generateRepairPlan({
      guild: mockGuild,
      userRoleIds: founderRoleIds,
      desiredState: sampleDesiredState,
    });

    const roleDrift = result.driftItems.find(
      (d) => d.type === 'ROLE_DRIFT' && d.targetName === 'Admin'
    );
    expect(roleDrift).toBeDefined();
    expect(roleDrift?.severity).toBe('WARNING');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 5. Unmanaged / Third-Party Resources Marked as PROTECTED
  // -------------------------------------------------------------------------
  test('Third-party/unmanaged roles are marked as PROTECTED', async () => {
    const rolesMap = new Map();
    rolesMap.set('10', { id: '10', name: 'Carl-bot' });
    rolesMap.set('11', { id: '11', name: 'UnbelievaBoat' });

    const mockGuild = createMockGuild(rolesMap, new Map());
    const result = await generateRepairPlan({
      guild: mockGuild,
      userRoleIds: founderRoleIds,
      desiredState: sampleDesiredState,
    });

    const unmanaged = result.driftItems.filter((d) => d.type === 'UNMANAGED_RESOURCE');
    expect(unmanaged.length).toBe(2);
    expect(unmanaged[0].severity).toBe('PROTECTED');
  });

  // -------------------------------------------------------------------------
  // 6. Safety Validation Loop Blocks Unsafe Actions
  // -------------------------------------------------------------------------
  test('If validateAction fails for any action, status is BLOCKED and actions are emptied', async () => {
    // Custom desired state that attempts to apply forbidden Administrator permission
    const unsafeDesiredState: DesiredState = {
      guildId: 'test-guild-id',
      roles: [],
      channels: [
        { name: 'secret-room', type: 'GUILD_TEXT', permissionTemplate: 'UNSAFE_ADMIN' },
      ],
      permissionTemplates: [
        {
          name: 'UNSAFE_ADMIN',
          overwrites: [
            { id: 'role:Everyone', allow: ['Administrator'], deny: [] },
          ],
        },
      ],
    };

    const mockGuild = createMockGuild();
    const result = await generateRepairPlan({
      guild: mockGuild,
      userRoleIds: founderRoleIds,
      desiredState: unsafeDesiredState,
    });

    expect(result.status).toBe('BLOCKED');
    expect(result.actions).toEqual([]); // Zero executable actions
    expect(result.blockedReasons).toBeDefined();
    expect(result.blockedReasons?.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 7. Strictly Read-Only (runAction is NEVER called)
  // -------------------------------------------------------------------------
  test('Execution invariant: runAction is NEVER called during repair planning', async () => {
    const mockGuild = createMockGuild();
    await generateRepairPlan({
      guild: mockGuild,
      userRoleIds: founderRoleIds,
      desiredState: sampleDesiredState,
    });

    expect(runActionSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 8. Deterministic & Idempotent
  // -------------------------------------------------------------------------
  test('Deterministic execution: running twice yields identical results', async () => {
    const mockGuild = createMockGuild();
    const result1 = await generateRepairPlan({
      guild: mockGuild,
      userRoleIds: founderRoleIds,
      desiredState: sampleDesiredState,
    });

    const result2 = await generateRepairPlan({
      guild: mockGuild,
      userRoleIds: founderRoleIds,
      desiredState: sampleDesiredState,
    });

    expect(result1.status).toEqual(result2.status);
    expect(result1.actions).toEqual(result2.actions);
    expect(result1.driftItems).toEqual(result2.driftItems);
    expect(result1.warnings).toEqual(result2.warnings);
    expect(result1.errors).toEqual(result2.errors);
  });
});
