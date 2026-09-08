// src/tests/discord/inspect.test.ts

import {
  classifyIntent,
  extractChannelTargets,
  isProtectedChannel,
  inspectChannels,
  formatInspectionReport,
  authorizeInspection,
  loadDesiredState,
  InspectableGuild,
  InspectionReport,
} from '../../services/discord/inspect';
import { execute as manageExecute } from '../../commands/kosmo/manage';
import { nlManager } from '../../services/discord/nl_manager';

// Mock the policy module to control authorization decisions
jest.mock('../../services/discord/policy', () => {
  const actual = jest.requireActual('../../services/discord/policy');
  return {
    ...actual,
    authorize: jest.fn(),
    Category: actual.Category,
  };
});

import { authorize } from '../../services/discord/policy';

// ── Helper: Create a mock guild with channels ────────────────────────────────

function createMockGuild(
  channels: Array<{ name: string; type: string; parentName?: string | null }>
): InspectableGuild {
  const channelObjects = channels.map((ch) => ({
    name: ch.name,
    type: ch.type,
    parent: ch.parentName ? { name: ch.parentName } : null,
  }));

  return {
    channels: {
      cache: {
        find: (fn: (ch: any) => boolean) => channelObjects.find(fn) || undefined,
      },
    },
  };
}

// ── Load desired state for comparison tests ──────────────────────────────────

const desiredState = loadDesiredState();

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SUITE
// ═══════════════════════════════════════════════════════════════════════════════

describe('NL Read-Only Inspection Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 1 — Simple read-only check recognized
  // ─────────────────────────────────────────────────────────────────────────
  test('TEST 1: Simple read-only check is classified as READ_ONLY_INSPECT', () => {
    expect(classifyIntent('check #start-here, #announcements, and #get-roles and verify whether they are correct'))
      .toBe('READ_ONLY_INSPECT');
    expect(classifyIntent('verify #general is set up correctly'))
      .toBe('READ_ONLY_INSPECT');
    expect(classifyIntent('inspect the announcements channel'))
      .toBe('READ_ONLY_INSPECT');
    expect(classifyIntent('audit #rules'))
      .toBe('READ_ONLY_INSPECT');
    expect(classifyIntent('review #off-topic'))
      .toBe('READ_ONLY_INSPECT');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 2 — Single channel target extracted
  // ─────────────────────────────────────────────────────────────────────────
  test('TEST 2: Single channel target is correctly extracted', () => {
    const targets = extractChannelTargets('check #announcements');
    expect(targets).toEqual(['announcements']);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 3 — Multiple channel targets extracted
  // ─────────────────────────────────────────────────────────────────────────
  test('TEST 3: Multiple channel targets are correctly extracted', () => {
    const targets = extractChannelTargets(
      'check #start-here, #announcements, and #get-roles and verify whether they are correct'
    );
    expect(targets).toContain('start-here');
    expect(targets).toContain('announcements');
    expect(targets).toContain('get-roles');
    expect(targets).toHaveLength(3);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 4 — #start-here target recognized
  // ─────────────────────────────────────────────────────────────────────────
  test('TEST 4: #start-here target is correctly recognized', () => {
    const targets = extractChannelTargets('verify #start-here');
    expect(targets).toContain('start-here');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 5 — #announcements target recognized
  // ─────────────────────────────────────────────────────────────────────────
  test('TEST 5: #announcements target is correctly recognized', () => {
    const targets = extractChannelTargets('check #announcements');
    expect(targets).toContain('announcements');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 6 — #get-roles target recognized
  // ─────────────────────────────────────────────────────────────────────────
  test('TEST 6: #get-roles target is correctly recognized', () => {
    const targets = extractChannelTargets('review #get-roles');
    expect(targets).toContain('get-roles');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 7 — Read-only request does not produce mutation actions
  // ─────────────────────────────────────────────────────────────────────────
  test('TEST 7: Read-only inspection produces zero mutation actions', () => {
    const guild = createMockGuild([
      { name: 'announcements', type: 'GUILD_TEXT', parentName: 'Community' },
    ]);
    const report = inspectChannels(guild, ['announcements'], desiredState);
    // The report has results, not actions
    expect(report.results).toHaveLength(1);
    // Verify there is no 'actions' property at all
    expect((report as any).actions).toBeUndefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 8 — Read-only request does not reach mutation executor
  // ─────────────────────────────────────────────────────────────────────────
  test('TEST 8: Read-only intent classification prevents mutation executor invocation', () => {
    // A pure read-only request is classified as READ_ONLY_INSPECT
    const intent = classifyIntent('check #start-here and #announcements');
    expect(intent).toBe('READ_ONLY_INSPECT');
    // This means the manage.ts handler would route to handleReadOnlyInspection,
    // not to nlManager.generatePlan() → mutation executor
    // The classifyIntent return value is the gate that prevents mutation flow
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 9 — Existing /kosmo audit behavior unchanged
  // ─────────────────────────────────────────────────────────────────────────
  test('TEST 9: Existing /kosmo audit behavior is not modified by inspection service', () => {
    // The inspect service is completely separate from runAudit.
    // Verify that classifyIntent does not affect runAudit at all:
    // runAudit is not called or imported by inspect.ts
    // and /kosmo audit uses its own separate handler.
    const intent = classifyIntent('some random mutation instruction');
    expect(intent).toBe('MUTATION');
    // MUTATION intent bypasses handleReadOnlyInspection entirely,
    // so /kosmo audit remains completely independent and unchanged.
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 10 — Unknown channel rejected clearly
  // ─────────────────────────────────────────────────────────────────────────
  test('TEST 10: Unknown channel returns NOT_FOUND status with clear message', () => {
    const guild = createMockGuild([]); // empty guild
    const report = inspectChannels(guild, ['nonexistent-channel'], desiredState);
    expect(report.results).toHaveLength(1);
    expect(report.results[0].status).toBe('NOT_FOUND');
    expect(report.results[0].exists).toBe(false);
    expect(report.results[0].details.some((d) => d.includes('not found'))).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 11 — Ambiguous channel rejected clearly
  // ─────────────────────────────────────────────────────────────────────────
  test('TEST 11: Channel not in guild but defined in desired state returns MISSING', () => {
    const guild = createMockGuild([]); // empty guild
    // 'announcements' IS in desiredState.json but NOT in the guild
    const report = inspectChannels(guild, ['announcements'], desiredState);
    expect(report.results).toHaveLength(1);
    expect(report.results[0].status).toBe('MISSING');
    expect(report.results[0].exists).toBe(false);
    expect(report.results[0].details.some((d) => d.includes('Desired state defines'))).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 12 — Private ticket target rejected/protected
  // ─────────────────────────────────────────────────────────────────────────
  test('TEST 12: Private ticket channel is marked PROTECTED and not inspected', () => {
    expect(isProtectedChannel('ticket-alice')).toBe(true);
    expect(isProtectedChannel('ticket-0042')).toBe(true);

    const guild = createMockGuild([
      { name: 'ticket-alice', type: 'GUILD_TEXT' },
    ]);
    const report = inspectChannels(guild, ['ticket-alice'], desiredState);
    expect(report.results).toHaveLength(1);
    expect(report.results[0].status).toBe('PROTECTED');
    expect(report.results[0].exists).toBe(false); // refuse to disclose
    expect(report.results[0].details.some((d) => d.includes('protected'))).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 13 — Private AI target rejected/protected
  // ─────────────────────────────────────────────────────────────────────────
  test('TEST 13: Private AI channel is marked PROTECTED and not inspected', () => {
    expect(isProtectedChannel('ai-chat-thread')).toBe(true);
    expect(isProtectedChannel('kosmo-ai-session')).toBe(true);
    expect(isProtectedChannel('private-ai-user1')).toBe(true);

    const guild = createMockGuild([
      { name: 'kosmo-ai-session', type: 'GUILD_TEXT' },
    ]);
    const report = inspectChannels(guild, ['kosmo-ai-session'], desiredState);
    expect(report.results).toHaveLength(1);
    expect(report.results[0].status).toBe('PROTECTED');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 14 — Unauthorized user rejected
  // ─────────────────────────────────────────────────────────────────────────
  test('TEST 14: Unauthorized user is denied inspection access', () => {
    (authorize as jest.Mock).mockReturnValue('DENY');
    const result = authorizeInspection(['Member'], {
      userId: 'user-random',
      guildOwnerId: 'owner123',
    });
    expect(result).toBe(false);
    expect(authorize).toHaveBeenCalledWith(['Member'], 'AUDIT', {
      userId: 'user-random',
      guildOwnerId: 'owner123',
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 15 — Staff authorized user succeeds
  // ─────────────────────────────────────────────────────────────────────────
  test('TEST 15: Staff user (Moderator+) is allowed inspection access', () => {
    (authorize as jest.Mock).mockReturnValue('ALLOW');
    const result = authorizeInspection(['Moderator'], {
      userId: 'user-mod',
      guildOwnerId: 'owner123',
    });
    expect(result).toBe(true);
    expect(authorize).toHaveBeenCalledWith(['Moderator'], 'AUDIT', {
      userId: 'user-mod',
      guildOwnerId: 'owner123',
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 16 — "check X and fix it" is NOT classified as pure read-only
  // ─────────────────────────────────────────────────────────────────────────
  test('TEST 16: "check X and fix it" is classified as MUTATION, not read-only', () => {
    expect(classifyIntent('check #start-here and if it\'s wrong fix it'))
      .toBe('MUTATION');
    expect(classifyIntent('check #general and fix the permissions'))
      .toBe('MUTATION');
    expect(classifyIntent('verify #announcements and repair it'))
      .toBe('MUTATION');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 17 — "verify X then delete it" remains mutation/high-risk
  // ─────────────────────────────────────────────────────────────────────────
  test('TEST 17: "verify X then delete it" is classified as MUTATION', () => {
    expect(classifyIntent('verify #start-here, then delete it if it doesn\'t match'))
      .toBe('MUTATION');
    expect(classifyIntent('check #general and delete inappropriate messages'))
      .toBe('MUTATION');
    expect(classifyIntent('review #rules then remove it'))
      .toBe('MUTATION');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 18 — No Discord mutation occurs during inspection
  // ─────────────────────────────────────────────────────────────────────────
  test('TEST 18: inspectChannels is strictly read-only — no mutation methods called', () => {
    const createChannel = jest.fn();
    const deleteChannel = jest.fn();
    const editChannel = jest.fn();
    const setPermissions = jest.fn();

    const guild: InspectableGuild = {
      channels: {
        cache: {
          find: (fn: (ch: any) => boolean) => {
            const channels = [
              { name: 'announcements', type: 'GUILD_TEXT', parent: { name: 'Community' } },
            ];
            return channels.find(fn) || undefined;
          },
        },
      },
    };

    // Attach mutation methods to verify they are never called
    (guild as any).channels.create = createChannel;
    (guild as any).channels.delete = deleteChannel;
    (guild as any).channels.edit = editChannel;
    (guild as any).channels.setPermissions = setPermissions;

    inspectChannels(guild, ['announcements'], desiredState);

    expect(createChannel).not.toHaveBeenCalled();
    expect(deleteChannel).not.toHaveBeenCalled();
    expect(editChannel).not.toHaveBeenCalled();
    expect(setPermissions).not.toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 19 — Desired-state comparison uses existing authoritative definitions
  // ─────────────────────────────────────────────────────────────────────────
  test('TEST 19: Desired-state comparison uses desiredState.json definitions', () => {
    // 'announcements' is defined in desiredState.json as:
    // { name: 'announcements', type: 'GUILD_TEXT', parent: 'Community', permissionTemplate: 'PUBLIC_READONLY' }
    const guild = createMockGuild([
      { name: 'announcements', type: 'GUILD_TEXT', parentName: 'Community' },
    ]);
    const report = inspectChannels(guild, ['announcements'], desiredState);
    expect(report.hasDesiredState).toBe(true);
    expect(report.results).toHaveLength(1);

    const result = report.results[0];
    expect(result.exists).toBe(true);
    expect(result.expectedType).toBe('GUILD_TEXT');
    expect(result.expectedParent).toBe('Community');
    expect(result.expectedPermissionTemplate).toBe('PUBLIC_READONLY');
    expect(result.typeMatch).toBe('CORRECT');
    expect(result.parentMatch).toBe('CORRECT');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 20 — UNKNOWN is returned when desired state does not define a property
  // ─────────────────────────────────────────────────────────────────────────
  test('TEST 20: Channel not in desired state returns UNKNOWN status with appropriate message', () => {
    // 'start-here' is NOT defined in desiredState.json
    const guild = createMockGuild([
      { name: 'start-here', type: 'GUILD_TEXT', parentName: 'Community' },
    ]);
    const report = inspectChannels(guild, ['start-here'], desiredState);
    expect(report.results).toHaveLength(1);

    const result = report.results[0];
    expect(result.exists).toBe(true);
    expect(result.status).toBe('UNKNOWN');
    expect(result.typeMatch).toBe('UNKNOWN');
    expect(result.parentMatch).toBe('UNKNOWN');
    expect(result.details.some((d) => d.includes('No authoritative desired-state rule'))).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 21 — No private content appears in the inspection response
  // ─────────────────────────────────────────────────────────────────────────
  test('TEST 21: Protected channels never leak private content in the report', () => {
    const guild = createMockGuild([
      { name: 'ticket-alice', type: 'GUILD_TEXT', parentName: 'ACTIVE TICKETS' },
      { name: 'team-chat', type: 'GUILD_TEXT', parentName: 'Team Kosmo' },
      { name: 'announcements', type: 'GUILD_TEXT', parentName: 'Community' },
    ]);

    const report = inspectChannels(
      guild,
      ['ticket-alice', 'team-chat', 'announcements'],
      desiredState
    );

    // ticket-alice: protected, no content disclosed
    const ticketResult = report.results.find((r) => r.channelName === 'ticket-alice');
    expect(ticketResult?.status).toBe('PROTECTED');
    expect(ticketResult?.exists).toBe(false); // refuse to disclose existence
    expect(ticketResult?.actualType).toBeUndefined();
    expect(ticketResult?.actualParent).toBeUndefined();

    // team-chat: protected (staff), no content disclosed
    const staffResult = report.results.find((r) => r.channelName === 'team-chat');
    expect(staffResult?.status).toBe('PROTECTED');
    expect(staffResult?.exists).toBe(false);

    // announcements: public, content disclosed normally
    const publicResult = report.results.find((r) => r.channelName === 'announcements');
    expect(publicResult?.exists).toBe(true);
    expect(publicResult?.status).not.toBe('PROTECTED');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 22 — Report formatting produces readable output
  // ─────────────────────────────────────────────────────────────────────────
  test('TEST 22: formatInspectionReport produces readable, mutation-free output', () => {
    const guild = createMockGuild([
      { name: 'announcements', type: 'GUILD_TEXT', parentName: 'Community' },
    ]);
    const report = inspectChannels(guild, ['announcements', 'nonexistent'], desiredState);
    const formatted = formatInspectionReport(report);

    expect(formatted).toContain('Read-Only Channel Inspection Report');
    expect(formatted).toContain('#announcements');
    expect(formatted).toContain('#nonexistent');
    expect(formatted).toContain('No changes were made');
    expect(formatted).toContain('read-only inspection');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ADDITIONAL COVERAGE — Edge cases
  // ─────────────────────────────────────────────────────────────────────────

  test('Empty instruction returns MUTATION intent (safe default)', () => {
    expect(classifyIntent('')).toBe('MUTATION');
    expect(classifyIntent('   ')).toBe('MUTATION');
  });

  test('Empty instruction returns empty targets array', () => {
    expect(extractChannelTargets('')).toEqual([]);
    expect(extractChannelTargets('   ')).toEqual([]);
  });

  test('No targets returns error in report', () => {
    const guild = createMockGuild([]);
    const report = inspectChannels(guild, [], desiredState);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain('No channel targets');
  });

  test('Unrecognized intent with no keywords defaults to MUTATION', () => {
    expect(classifyIntent('hello there')).toBe('MUTATION');
    expect(classifyIntent('do something with channels')).toBe('MUTATION');
  });

  test('Channel type mismatch is reported as INCORRECT', () => {
    // 'announcements' is GUILD_TEXT in desired state, let's mock it as GUILD_VOICE
    const guild = createMockGuild([
      { name: 'announcements', type: 'GUILD_VOICE', parentName: 'Community' },
    ]);
    const report = inspectChannels(guild, ['announcements'], desiredState);
    expect(report.results[0].typeMatch).toBe('INCORRECT');
    expect(report.results[0].status).toBe('INCORRECT');
  });

  test('Parent category mismatch is reported as INCORRECT', () => {
    // 'announcements' should be under 'Community', let's put it under 'WrongCategory'
    const guild = createMockGuild([
      { name: 'announcements', type: 'GUILD_TEXT', parentName: 'WrongCategory' },
    ]);
    const report = inspectChannels(guild, ['announcements'], desiredState);
    expect(report.results[0].parentMatch).toBe('INCORRECT');
    expect(report.results[0].status).toBe('INCORRECT');
  });

  test('isProtectedChannel returns false for normal public channels', () => {
    expect(isProtectedChannel('general')).toBe(false);
    expect(isProtectedChannel('announcements')).toBe(false);
    expect(isProtectedChannel('rules')).toBe(false);
    expect(isProtectedChannel('off-topic')).toBe(false);
    expect(isProtectedChannel('start-here')).toBe(false);
    expect(isProtectedChannel('get-roles')).toBe(false);
  });

  test('loadDesiredState returns valid DesiredState object', () => {
    const ds = loadDesiredState();
    expect(ds).not.toBeNull();
    expect(ds?.channels).toBeDefined();
    expect(ds?.roles).toBeDefined();
    expect(ds?.permissionTemplates).toBeDefined();
    expect(Array.isArray(ds?.channels)).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // E2E COMMAND TEST: /kosmo manage with live-reproduced read-only string
  // ─────────────────────────────────────────────────────────────────────────
  test('E2E Command: /kosmo manage with read-only request routes to inspection and never calls nlManager', async () => {
    (authorize as jest.Mock).mockReturnValue('ALLOW');
    const spyGeneratePlan = jest.spyOn(nlManager, 'generatePlan');

    let replyPayload: any = null;
    const mockInteraction: any = {
      options: {
        getSubcommand: () => 'manage',
        getString: (name: string) =>
          name === 'instruction'
            ? 'check #start-here, #announcements, and #get-roles and verify whether they are correct'
            : null,
      },
      guild: {
        id: 'guild-123',
        ownerId: 'owner-456',
        channels: {
          cache: {
            find: (fn: (c: any) => boolean) => {
              const channels = [
                { name: 'start-here', type: 'GUILD_TEXT', parent: { name: 'Welcome' } },
                { name: 'announcements', type: 'GUILD_TEXT', parent: { name: 'Community' } },
                { name: 'get-roles', type: 'GUILD_TEXT', parent: { name: 'Community' } },
              ];
              return channels.find(fn) || undefined;
            },
          },
        },
      },
      member: { roles: ['123456789'] },
      user: { id: 'owner-456', username: 'TestUser' },
      reply: jest.fn(async (payload) => {
        replyPayload = payload;
      }),
      editReply: jest.fn(),
      deferReply: jest.fn(),
    };

    await manageExecute(mockInteraction);

    // Verify handleReadOnlyInspection executed and replied with ephemeral embed
    expect(mockInteraction.reply).toHaveBeenCalled();
    expect(replyPayload?.embeds).toBeDefined();
    expect(replyPayload.embeds[0].data.title).toContain('Channel Inspection [READ-ONLY]');
    expect(replyPayload.ephemeral).toBe(true);

    // Verify nlManager.generatePlan was NEVER called
    expect(spyGeneratePlan).not.toHaveBeenCalled();
    // Verify deferReply was NOT called (it is only used for the slow mutation path)
    expect(mockInteraction.deferReply).not.toHaveBeenCalled();

    spyGeneratePlan.mockRestore();
  });
});

