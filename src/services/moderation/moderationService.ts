// src/services/moderation/moderationService.ts

import {
  ModerationCase,
  StrikeRecord,
  PolicyRecommendation,
  ModerationHistory,
  CaseActionType,
  CaseStatus,
  CaseSeverity,
  IModerationRepository,
} from '../../types/moderation';
import { getModerationRepository } from './moderationRepository';

import { cache, redisKeys, REDIS_TTL } from '../cache';

/**
 * Acquires a distributed Redis mutual exclusion lock for a target member during strike issuance.
 * Prevents concurrent duplicate strikes across multiple bot instances or shards.
 * Uses unique ownership tokens and atomic Lua script release.
 */
async function acquireLock(key: string, ttlSeconds: number = REDIS_TTL.MODERATION_LOCK): Promise<() => Promise<void>> {
  const lockKey = redisKeys.moderationLock(key);
  const maxAttempts = 10;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await cache.acquireLock(lockKey, ttlSeconds);
    if (res.acquired && res.token) {
      const token = res.token;
      return async () => {
        await cache.releaseLock(lockKey, token);
      };
    }
    if (res.error) {
      throw new Error(`Moderation action lock failed: ${res.error}`);
    }
    // Wait briefly before retrying
    await new Promise((r) => setTimeout(r, 100));
  }

  throw new Error(`Could not acquire moderation lock for target member (operation in progress).`);
}

/**
 * Evaluates the 3-strike escalation policy baseline:
 * - 1st offense -> Warning recommendation
 * - 2nd offense -> 10-minute Timeout recommendation
 * - 3rd offense -> Permanent Ban recommendation
 *
 * CRITICAL POLICY INVARIANT:
 * This calculation is a policy RECOMMENDATION only, NOT an automatic execution engine.
 * The system MUST NOT automatically timeout/ban a user. Human staff must explicitly decide.
 */
export function calculatePolicyRecommendation(strikeCount: number): PolicyRecommendation {
  if (strikeCount <= 1) {
    return {
      strikeCount,
      recommendedAction: 'WARN',
      explanation: '1st Offense baseline: Content deletion and formal warning/DM notice.',
      commandHint: 'No further action required if warning was already issued.',
    };
  }

  if (strikeCount === 2) {
    return {
      strikeCount,
      recommendedAction: 'TIMEOUT',
      timeoutDurationMinutes: 10,
      explanation: '2nd Offense baseline: 10-minute temporary timeout recommended.',
      commandHint: 'To execute recommendation: /mod timeout user:<target> duration:10 reason:<reason>',
    };
  }

  return {
    strikeCount,
    recommendedAction: 'BAN',
    explanation: '3rd Offense baseline: Permanent server ban recommended (multiple repeat offenses).',
    commandHint: 'To execute recommendation: /mod ban user:<target> reason:<reason>',
  };
}

export class ModerationService {
  private get repo(): IModerationRepository {
    return getModerationRepository();
  }

  /**
   * Issues a formal warning to a member.
   * Records a moderation case without incrementing active strikes.
   */
  async issueWarning(params: {
    guildId: string;
    targetId: string;
    targetTag: string;
    moderatorId: string;
    moderatorTag: string;
    reason: string;
    evidence?: string;
  }): Promise<{ caseRecord: ModerationCase }> {
    const { guildId, targetId, targetTag, moderatorId, moderatorTag, reason, evidence } = params;

    if (!reason || reason.trim().length === 0) {
      throw new Error('Warning reason cannot be empty.');
    }
    if (reason.length > 512) {
      throw new Error('Warning reason cannot exceed 512 characters.');
    }

    const caseRecord = await this.repo.createCase({
      guildId,
      targetId,
      targetTag,
      moderatorId,
      moderatorTag,
      actionType: 'WARN',
      reason: reason.trim(),
      evidence: evidence?.trim() || undefined,
      severity: 'LOW',
      sanctionApplied: 'Formal Warning',
      status: 'ACTIONED',
    });

    return { caseRecord };
  }

  /**
   * Issues a formal strike to a member.
   * Atomically records a strike and case, increments the active strike count,
   * and calculates the recommended policy escalation.
   * Concurrency-safe via target lock.
   */
  async issueStrike(params: {
    guildId: string;
    targetId: string;
    targetTag: string;
    moderatorId: string;
    moderatorTag: string;
    reason: string;
    evidence?: string;
    severity?: CaseSeverity;
  }): Promise<{
    caseRecord: ModerationCase;
    strikeRecord: StrikeRecord;
    activeStrikeCount: number;
    recommendation: PolicyRecommendation;
  }> {
    const { guildId, targetId, targetTag, moderatorId, moderatorTag, reason, evidence, severity = 'MEDIUM' } =
      params;

    if (!reason || reason.trim().length === 0) {
      throw new Error('Strike reason cannot be empty.');
    }
    if (reason.length > 512) {
      throw new Error('Strike reason cannot exceed 512 characters.');
    }

    const lockKey = `${guildId}:${targetId}`;
    const release = await acquireLock(lockKey);

    try {
      // 1. Create associated moderation case
      const caseRecord = await this.repo.createCase({
        guildId,
        targetId,
        targetTag,
        moderatorId,
        moderatorTag,
        actionType: 'STRIKE',
        reason: reason.trim(),
        evidence: evidence?.trim() || undefined,
        severity,
        sanctionApplied: 'Infraction Strike',
        status: 'ACTIONED',
      });

      // 2. Record active strike
      const strikeRecord = await this.repo.recordStrike({
        caseId: caseRecord.caseId,
        guildId,
        targetId,
        moderatorId,
        severity,
        isActive: true,
      });

      // 3. Calculate updated active strikes
      const activeStrikeCount = await this.repo.getActiveStrikeCount(guildId, targetId);

      // 4. Calculate policy escalation recommendation
      const recommendation = calculatePolicyRecommendation(activeStrikeCount);

      return {
        caseRecord,
        strikeRecord,
        activeStrikeCount,
        recommendation,
      };
    } finally {
      release();
    }
  }

  /**
   * Records a case for an executed sanction (TIMEOUT, KICK, BAN, PURGE).
   */
  async recordSanctionCase(params: {
    guildId: string;
    targetId: string;
    targetTag: string;
    moderatorId: string;
    moderatorTag: string;
    actionType: CaseActionType;
    reason: string;
    sanctionApplied?: string;
    evidence?: string;
    severity?: CaseSeverity;
  }): Promise<ModerationCase> {
    return this.repo.createCase({
      guildId: params.guildId,
      targetId: params.targetId,
      targetTag: params.targetTag,
      moderatorId: params.moderatorId,
      moderatorTag: params.moderatorTag,
      actionType: params.actionType,
      reason: params.reason,
      evidence: params.evidence,
      severity: params.severity || 'HIGH',
      sanctionApplied: params.sanctionApplied,
      status: 'ACTIONED',
    });
  }

  /**
   * Retrieves a target member's complete moderation history in a guild.
   */
  async getModerationHistory(guildId: string, targetId: string): Promise<ModerationHistory> {
    const cases = await this.repo.listCasesForTarget(guildId, targetId);
    const activeStrikes = await this.repo.getActiveStrikeCount(guildId, targetId);

    return {
      targetId,
      activeStrikes,
      totalCases: cases.length,
      cases,
    };
  }

  /**
   * Retrieves a case by Case ID with strict guild isolation.
   */
  async getCaseById(guildId: string, caseId: string): Promise<ModerationCase | null> {
    return this.repo.getCase(caseId, guildId);
  }

  /**
   * Updates a case's status (e.g. from ACTIONED to RESOLVED or DISMISSED).
   */
  async updateCaseStatus(
    guildId: string,
    caseId: string,
    status: CaseStatus,
    resolutionNotes?: string
  ): Promise<ModerationCase | null> {
    return this.repo.updateCaseStatus(caseId, guildId, status, resolutionNotes);
  }
}

export const moderationService = new ModerationService();
