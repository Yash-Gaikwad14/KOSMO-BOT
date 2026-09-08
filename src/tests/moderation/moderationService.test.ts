// src/tests/moderation/moderationService.test.ts

import {
  ModerationService,
  calculatePolicyRecommendation,
} from '../../services/moderation/moderationService';
import {
  InMemoryModerationRepository,
  PostgresModerationRepository,
  setModerationRepository,
} from '../../services/moderation/moderationRepository';
import { generateModerationAdvisory } from '../../services/moderation/aiAdvisory';

describe('Phase 7 — Moderation Service & Repository', () => {
  let inMemoryRepo: InMemoryModerationRepository;
  let service: ModerationService;

  beforeEach(() => {
    inMemoryRepo = new InMemoryModerationRepository();
    setModerationRepository(inMemoryRepo);
    service = new ModerationService();
  });

  afterEach(() => {
    setModerationRepository(null);
  });

  describe('calculatePolicyRecommendation()', () => {
    test('recommends Warning on 1st offense (1 strike)', () => {
      const rec = calculatePolicyRecommendation(1);
      expect(rec.recommendedAction).toBe('WARN');
      expect(rec.strikeCount).toBe(1);
      expect(rec.explanation).toContain('1st Offense baseline');
      expect(rec.commandHint).toContain('No further action required');
    });

    test('recommends 10-minute Timeout on 2nd offense (2 strikes)', () => {
      const rec = calculatePolicyRecommendation(2);
      expect(rec.recommendedAction).toBe('TIMEOUT');
      expect(rec.timeoutDurationMinutes).toBe(10);
      expect(rec.strikeCount).toBe(2);
      expect(rec.explanation).toContain('2nd Offense baseline');
      expect(rec.commandHint).toContain('/mod timeout');
    });

    test('recommends Permanent Ban on 3rd offense or higher (3+ strikes)', () => {
      const rec3 = calculatePolicyRecommendation(3);
      expect(rec3.recommendedAction).toBe('BAN');
      expect(rec3.strikeCount).toBe(3);
      expect(rec3.explanation).toContain('3rd Offense baseline');
      expect(rec3.commandHint).toContain('/mod ban');

      const rec4 = calculatePolicyRecommendation(4);
      expect(rec4.recommendedAction).toBe('BAN');
    });
  });

  describe('InMemoryModerationRepository', () => {
    test('creates and retrieves cases with guild isolation', async () => {
      const caseA = await inMemoryRepo.createCase({
        guildId: 'guild-1',
        targetId: 'user-1',
        targetTag: 'User1#0001',
        moderatorId: 'mod-1',
        moderatorTag: 'Mod#0001',
        actionType: 'WARN',
        reason: 'Inappropriate language',
      });

      expect(caseA.caseId).toMatch(/^CASE-/);

      // Successfully found in guild-1
      const foundA = await inMemoryRepo.getCase(caseA.caseId, 'guild-1');
      expect(foundA).not.toBeNull();
      expect(foundA?.targetId).toBe('user-1');

      // Guild isolation: Cannot be retrieved from guild-2
      const foundB = await inMemoryRepo.getCase(caseA.caseId, 'guild-2');
      expect(foundB).toBeNull();
    });

    test('lists cases for target sorted descending by creation date', async () => {
      await inMemoryRepo.createCase({
        guildId: 'guild-1',
        targetId: 'user-1',
        targetTag: 'User1#0001',
        moderatorId: 'mod-1',
        moderatorTag: 'Mod#0001',
        actionType: 'WARN',
        reason: 'First infraction',
        createdAt: new Date(Date.now() - 5000),
      });

      await inMemoryRepo.createCase({
        guildId: 'guild-1',
        targetId: 'user-1',
        targetTag: 'User1#0001',
        moderatorId: 'mod-1',
        moderatorTag: 'Mod#0001',
        actionType: 'STRIKE',
        reason: 'Second infraction',
        createdAt: new Date(),
      });

      const list = await inMemoryRepo.listCasesForTarget('guild-1', 'user-1');
      expect(list).toHaveLength(2);
      expect(list[0].actionType).toBe('STRIKE');
      expect(list[1].actionType).toBe('WARN');
    });

    test('updates case status with resolution notes', async () => {
      const created = await inMemoryRepo.createCase({
        guildId: 'guild-1',
        targetId: 'user-1',
        targetTag: 'User1#0001',
        moderatorId: 'mod-1',
        moderatorTag: 'Mod#0001',
        actionType: 'WARN',
        reason: 'Disputed issue',
      });

      const updated = await inMemoryRepo.updateCaseStatus(
        created.caseId,
        'guild-1',
        'RESOLVED',
        'User apologized in support ticket'
      );

      expect(updated?.status).toBe('RESOLVED');
      expect(updated?.resolutionNotes).toBe('User apologized in support ticket');
    });
  });

  describe('PostgresModerationRepository (Unit & Mock Testing)', () => {
    test('executes expected queries using centralized pool without runtime DDL', async () => {
      const mockQuery = jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO moderation_cases')) {
          return {
            rows: [
              {
                case_id: 'CASE-PG-1',
                guild_id: 'guild-pg',
                target_id: 'user-pg',
                target_tag: 'UserPG#0001',
                moderator_id: 'mod-pg',
                moderator_tag: 'ModPG#0001',
                action_type: 'WARN',
                reason: 'PG Reason',
                status: 'ACTIONED',
                created_at: new Date().toISOString(),
              },
            ],
          };
        }
        return { rows: [] };
      });

      const mockPool: any = { query: mockQuery };
      const pgRepo = new PostgresModerationRepository(mockPool);

      const created = await pgRepo.createCase({
        caseId: 'CASE-PG-1',
        guildId: 'guild-pg',
        targetId: 'user-pg',
        targetTag: 'UserPG#0001',
        moderatorId: 'mod-pg',
        moderatorTag: 'ModPG#0001',
        actionType: 'WARN',
        reason: 'PG Reason',
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO moderation_cases'),
        expect.any(Array)
      );
      // Confirms runtime ensureSchema DDL is NOT invoked on query execution
      expect(mockQuery).not.toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS moderation_cases')
      );
      expect(created.caseId).toBe('CASE-PG-1');
      expect(created.targetId).toBe('user-pg');
    });
  });

  describe('ModerationService Workflows', () => {
    test('issueWarning creates case with actionType WARN and validates input', async () => {
      const result = await service.issueWarning({
        guildId: 'guild-1',
        targetId: 'user-1',
        targetTag: 'User#0001',
        moderatorId: 'mod-1',
        moderatorTag: 'Mod#0001',
        reason: 'Minor rule violation',
        evidence: 'https://discord.com/channels/1/2/3',
      });

      expect(result.caseRecord.actionType).toBe('WARN');
      expect(result.caseRecord.reason).toBe('Minor rule violation');
      expect(result.caseRecord.evidence).toBe('https://discord.com/channels/1/2/3');

      // Validates empty reason
      await expect(
        service.issueWarning({
          guildId: 'guild-1',
          targetId: 'user-1',
          targetTag: 'User#0001',
          moderatorId: 'mod-1',
          moderatorTag: 'Mod#0001',
          reason: '   ',
        })
      ).rejects.toThrow('Warning reason cannot be empty.');
    });

    test('issueStrike increments active strike count and returns policy recommendation', async () => {
      // Strike 1
      const res1 = await service.issueStrike({
        guildId: 'guild-1',
        targetId: 'user-1',
        targetTag: 'User#0001',
        moderatorId: 'mod-1',
        moderatorTag: 'Mod#0001',
        reason: 'First strikeable offense',
      });

      expect(res1.activeStrikeCount).toBe(1);
      expect(res1.recommendation.recommendedAction).toBe('WARN');

      // Strike 2
      const res2 = await service.issueStrike({
        guildId: 'guild-1',
        targetId: 'user-1',
        targetTag: 'User#0001',
        moderatorId: 'mod-1',
        moderatorTag: 'Mod#0001',
        reason: 'Second strikeable offense',
      });

      expect(res2.activeStrikeCount).toBe(2);
      expect(res2.recommendation.recommendedAction).toBe('TIMEOUT');
      expect(res2.recommendation.timeoutDurationMinutes).toBe(10);

      // Strike 3
      const res3 = await service.issueStrike({
        guildId: 'guild-1',
        targetId: 'user-1',
        targetTag: 'User#0001',
        moderatorId: 'mod-1',
        moderatorTag: 'Mod#0001',
        reason: 'Third strikeable offense',
      });

      expect(res3.activeStrikeCount).toBe(3);
      expect(res3.recommendation.recommendedAction).toBe('BAN');
    });

    test('serializes concurrent strike requests on same user to prevent race conditions', async () => {
      // Dispatch 3 concurrent strikes on the same user
      const promises = [
        service.issueStrike({
          guildId: 'guild-race',
          targetId: 'user-race',
          targetTag: 'Racer#0001',
          moderatorId: 'mod-1',
          moderatorTag: 'Mod#0001',
          reason: 'Concurrent strike 1',
        }),
        service.issueStrike({
          guildId: 'guild-race',
          targetId: 'user-race',
          targetTag: 'Racer#0001',
          moderatorId: 'mod-1',
          moderatorTag: 'Mod#0001',
          reason: 'Concurrent strike 2',
        }),
        service.issueStrike({
          guildId: 'guild-race',
          targetId: 'user-race',
          targetTag: 'Racer#0001',
          moderatorId: 'mod-1',
          moderatorTag: 'Mod#0001',
          reason: 'Concurrent strike 3',
        }),
      ];

      const results = await Promise.all(promises);

      const finalCount = await inMemoryRepo.getActiveStrikeCount('guild-race', 'user-race');
      expect(finalCount).toBe(3);

      const strikeCounts = results.map((r) => r.activeStrikeCount).sort((a, b) => a - b);
      expect(strikeCounts).toEqual([1, 2, 3]);
    });

    test('recordSanctionCase records executed sanctions', async () => {
      const sanctionCase = await service.recordSanctionCase({
        guildId: 'guild-1',
        targetId: 'user-1',
        targetTag: 'User#0001',
        moderatorId: 'mod-1',
        moderatorTag: 'Mod#0001',
        actionType: 'TIMEOUT',
        reason: 'Manual timeout executed',
        sanctionApplied: 'Timed out for 10 minutes',
      });

      expect(sanctionCase.actionType).toBe('TIMEOUT');
      expect(sanctionCase.sanctionApplied).toBe('Timed out for 10 minutes');
    });

    test('getModerationHistory aggregates active strikes and all target cases', async () => {
      await service.issueWarning({
        guildId: 'guild-1',
        targetId: 'user-history',
        targetTag: 'Hist#0001',
        moderatorId: 'mod-1',
        moderatorTag: 'Mod#0001',
        reason: 'Warning 1',
      });

      await service.issueStrike({
        guildId: 'guild-1',
        targetId: 'user-history',
        targetTag: 'Hist#0001',
        moderatorId: 'mod-1',
        moderatorTag: 'Mod#0001',
        reason: 'Strike 1',
      });

      const history = await service.getModerationHistory('guild-1', 'user-history');
      expect(history.targetId).toBe('user-history');
      expect(history.activeStrikes).toBe(1);
      expect(history.totalCases).toBe(2);
      expect(history.cases).toHaveLength(2);
    });
  });

  describe('AI Advisory Service (Advisory-Only)', () => {
    test('generates advisory recommendation with isAdvisoryOnly set to true', () => {
      const advisory = generateModerationAdvisory({
        incidentText: 'Check out this free nitro link: discord.gift/fake123',
        currentStrikeCount: 0,
      });

      expect(advisory.violationCategory).toBe('MALICIOUS_LINK_OR_SCAM');
      expect(advisory.recommendedSeverity).toBe('HIGH');
      expect(advisory.recommendedAction).toBe('TIMEOUT');
      expect(advisory.isAdvisoryOnly).toBe(true);
    });

    test('escalates recommendation to BAN when active strike count is already 2+', () => {
      const advisory = generateModerationAdvisory({
        incidentText: 'Join my new server buy now',
        currentStrikeCount: 2,
      });

      expect(advisory.violationCategory).toBe('UNAUTHORIZED_PROMOTION');
      expect(advisory.recommendedAction).toBe('BAN');
      expect(advisory.isAdvisoryOnly).toBe(true);
    });
  });
});
