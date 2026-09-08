// src/services/moderation/moderationRepository.ts

import { Pool } from 'pg';
import crypto from 'crypto';
import {
  ModerationCase,
  StrikeRecord,
  CreateCaseInput,
  CreateStrikeInput,
  CaseActionType,
  CaseSeverity,
  CaseStatus,
  IModerationRepository,
} from '../../types/moderation';

/**
 * Generates a clean, readable Case ID with collision-resistant entropy.
 * Format: CASE-YYYYMMDD-XXXX (e.g. CASE-20260905-A7B2)
 */
export function generateCaseId(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `CASE-${dateStr}-${rand}`;
}

/**
 * Generates a Strike ID.
 * Format: STRIKE-YYYYMMDD-XXXX
 */
export function generateStrikeId(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `STRIKE-${dateStr}-${rand}`;
}

/**
 * In-Memory Moderation Repository.
 * Used for unit testing, isolated test suites, and environments without an active PostgreSQL instance.
 * Thread-safe and guild-isolated.
 */
export class InMemoryModerationRepository implements IModerationRepository {
  private cases = new Map<string, ModerationCase>();
  private strikes = new Map<string, StrikeRecord>();

  async createCase(data: CreateCaseInput): Promise<ModerationCase> {
    const caseId = data.caseId || generateCaseId();
    const newCase: ModerationCase = {
      ...data,
      caseId,
      status: data.status || 'ACTIONED',
      createdAt: data.createdAt || new Date(),
    };
    this.cases.set(`${data.guildId}:${caseId}`, newCase);
    return { ...newCase };
  }

  async getCase(caseId: string, guildId: string): Promise<ModerationCase | null> {
    const found = this.cases.get(`${guildId}:${caseId}`);
    return found ? { ...found } : null;
  }

  async listCasesForTarget(guildId: string, targetId: string): Promise<ModerationCase[]> {
    const results: ModerationCase[] = [];
    for (const c of this.cases.values()) {
      if (c.guildId === guildId && c.targetId === targetId) {
        results.push({ ...c });
      }
    }
    // Sort descending by creation date, with caseId as tiebreaker
    return results.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.caseId.localeCompare(a.caseId)
    );
  }

  async listRecentCases(guildId: string, limit: number = 25): Promise<ModerationCase[]> {
    const results: ModerationCase[] = [];
    for (const c of this.cases.values()) {
      if (c.guildId === guildId) {
        results.push({ ...c });
      }
    }
    return results
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.caseId.localeCompare(a.caseId))
      .slice(0, limit);
  }

  async updateCaseStatus(
    caseId: string,
    guildId: string,
    status: CaseStatus,
    resolutionNotes?: string
  ): Promise<ModerationCase | null> {
    const key = `${guildId}:${caseId}`;
    const existing = this.cases.get(key);
    if (!existing) return null;

    const updated: ModerationCase = {
      ...existing,
      status,
      resolutionNotes: resolutionNotes ?? existing.resolutionNotes,
    };
    this.cases.set(key, updated);
    return { ...updated };
  }

  async recordStrike(data: CreateStrikeInput): Promise<StrikeRecord> {
    const strikeId = data.strikeId || generateStrikeId();
    const newStrike: StrikeRecord = {
      ...data,
      strikeId,
      isActive: data.isActive !== undefined ? data.isActive : true,
      createdAt: new Date(),
    };
    this.strikes.set(`${data.guildId}:${strikeId}`, newStrike);
    return { ...newStrike };
  }

  async getActiveStrikeCount(guildId: string, targetId: string): Promise<number> {
    let count = 0;
    for (const s of this.strikes.values()) {
      if (s.guildId === guildId && s.targetId === targetId && s.isActive) {
        count++;
      }
    }
    return count;
  }

  async getActiveStrikes(guildId: string, targetId: string): Promise<StrikeRecord[]> {
    const results: StrikeRecord[] = [];
    for (const s of this.strikes.values()) {
      if (s.guildId === guildId && s.targetId === targetId && s.isActive) {
        results.push({ ...s });
      }
    }
    return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async clear(): Promise<void> {
    this.cases.clear();
    this.strikes.clear();
  }
}

import { getPool } from '../database/pool';

/**
 * Persistent PostgreSQL Moderation Repository.
 * Survives process restarts by storing cases and strikes in PostgreSQL.
 * Uses centralized database connection pool and versioned migrations.
 */
export class PostgresModerationRepository implements IModerationRepository {
  private pool: Pool;

  constructor(poolOrConnectionString?: Pool | string) {
    if (poolOrConnectionString && typeof poolOrConnectionString === 'object') {
      this.pool = poolOrConnectionString;
    } else {
      this.pool = getPool();
    }
  }

  /**
   * Maintained for backwards compatibility.
   * Schema is deterministically initialized via versioned migrations.
   */
  public async ensureSchema(): Promise<void> {
    return;
  }

  private mapCaseRow(row: {
    case_id: string;
    guild_id: string;
    target_id: string;
    target_tag: string;
    moderator_id: string;
    moderator_tag: string;
    action_type: CaseActionType;
    reason: string;
    evidence?: string | null;
    severity?: CaseSeverity | null;
    sanction_applied?: string | null;
    status: CaseStatus;
    created_at: string | Date;
    resolution_notes?: string | null;
  }): ModerationCase {
    return {
      caseId: row.case_id,
      guildId: row.guild_id,
      targetId: row.target_id,
      targetTag: row.target_tag,
      moderatorId: row.moderator_id,
      moderatorTag: row.moderator_tag,
      actionType: row.action_type,
      reason: row.reason,
      evidence: row.evidence ?? undefined,
      severity: row.severity ?? undefined,
      sanctionApplied: row.sanction_applied ?? undefined,
      status: row.status,
      createdAt: new Date(row.created_at),
      resolutionNotes: row.resolution_notes ?? undefined,
    };
  }

  private mapStrikeRow(row: {
    strike_id: string;
    case_id: string;
    guild_id: string;
    target_id: string;
    moderator_id: string;
    severity: CaseSeverity;
    is_active: boolean | number | string;
    created_at: string | Date;
  }): StrikeRecord {
    return {
      strikeId: row.strike_id,
      caseId: row.case_id,
      guildId: row.guild_id,
      targetId: row.target_id,
      moderatorId: row.moderator_id,
      severity: row.severity,
      isActive: Boolean(row.is_active),
      createdAt: new Date(row.created_at),
    };
  }

  async createCase(data: CreateCaseInput): Promise<ModerationCase> {
    const caseId = data.caseId || generateCaseId();
    const status = data.status || 'ACTIONED';

    const text = `
      INSERT INTO moderation_cases
        (case_id, guild_id, target_id, target_tag, moderator_id, moderator_tag,
         action_type, reason, evidence, severity, sanction_applied, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13, NOW()))
      RETURNING *;
    `;
    const values = [
      caseId,
      data.guildId,
      data.targetId,
      data.targetTag,
      data.moderatorId,
      data.moderatorTag,
      data.actionType,
      data.reason,
      data.evidence ?? null,
      data.severity ?? 'MEDIUM',
      data.sanctionApplied ?? null,
      status,
      data.createdAt ?? null,
    ];

    const res = await this.pool.query(text, values);
    return this.mapCaseRow(res.rows[0]);
  }

  async getCase(caseId: string, guildId: string): Promise<ModerationCase | null> {
    const text = `SELECT * FROM moderation_cases WHERE case_id = $1 AND guild_id = $2;`;
    const res = await this.pool.query(text, [caseId, guildId]);
    if (res.rows.length === 0) return null;
    return this.mapCaseRow(res.rows[0]);
  }

  async listCasesForTarget(guildId: string, targetId: string): Promise<ModerationCase[]> {
    const text = `
      SELECT * FROM moderation_cases
      WHERE guild_id = $1 AND target_id = $2
      ORDER BY created_at DESC;
    `;
    const res = await this.pool.query(text, [guildId, targetId]);
    return res.rows.map(this.mapCaseRow);
  }

  async listRecentCases(guildId: string, limit: number = 25): Promise<ModerationCase[]> {
    const text = `
      SELECT * FROM moderation_cases
      WHERE guild_id = $1
      ORDER BY created_at DESC
      LIMIT $2;
    `;
    const res = await this.pool.query(text, [guildId, limit]);
    return res.rows.map(this.mapCaseRow);
  }

  async updateCaseStatus(
    caseId: string,
    guildId: string,
    status: CaseStatus,
    resolutionNotes?: string
  ): Promise<ModerationCase | null> {
    const text = `
      UPDATE moderation_cases
      SET status = $1, resolution_notes = COALESCE($2, resolution_notes)
      WHERE case_id = $3 AND guild_id = $4
      RETURNING *;
    `;
    const res = await this.pool.query(text, [status, resolutionNotes ?? null, caseId, guildId]);
    if (res.rows.length === 0) return null;
    return this.mapCaseRow(res.rows[0]);
  }

  async recordStrike(data: CreateStrikeInput): Promise<StrikeRecord> {
    const strikeId = data.strikeId || generateStrikeId();
    const isActive = data.isActive !== undefined ? data.isActive : true;

    const text = `
      INSERT INTO moderation_strikes
        (strike_id, case_id, guild_id, target_id, moderator_id, severity, is_active, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING *;
    `;
    const values = [
      strikeId,
      data.caseId,
      data.guildId,
      data.targetId,
      data.moderatorId,
      data.severity || 'MEDIUM',
      isActive,
    ];

    const res = await this.pool.query(text, values);
    return this.mapStrikeRow(res.rows[0]);
  }

  async getActiveStrikeCount(guildId: string, targetId: string): Promise<number> {
    const text = `
      SELECT COUNT(*)::int AS count
      FROM moderation_strikes
      WHERE guild_id = $1 AND target_id = $2 AND is_active = TRUE;
    `;
    const res = await this.pool.query(text, [guildId, targetId]);
    return res.rows[0]?.count ?? 0;
  }

  async getActiveStrikes(guildId: string, targetId: string): Promise<StrikeRecord[]> {
    const text = `
      SELECT * FROM moderation_strikes
      WHERE guild_id = $1 AND target_id = $2 AND is_active = TRUE
      ORDER BY created_at DESC;
    `;
    const res = await this.pool.query(text, [guildId, targetId]);
    return res.rows.map(this.mapStrikeRow);
  }

  async clear(): Promise<void> {
    await this.pool.query('TRUNCATE TABLE moderation_strikes, moderation_cases CASCADE;');
  }
}

let activeRepository: IModerationRepository | null = null;

/**
 * Returns the active moderation repository.
 * If DATABASE_URL is configured, initializes and returns PostgresModerationRepository.
 * Otherwise, falls back to InMemoryModerationRepository.
 */
export function getModerationRepository(): IModerationRepository {
  if (activeRepository) {
    return activeRepository;
  }

  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0) {
    try {
      activeRepository = new PostgresModerationRepository();
      return activeRepository;
    } catch (err) {
      console.warn('Failed to initialize PostgresModerationRepository, falling back to in-memory:', err);
    }
  }

  activeRepository = new InMemoryModerationRepository();
  return activeRepository;
}

/**
 * Explicitly sets or overrides the moderation repository (ideal for testing or dependency injection).
 */
export function setModerationRepository(repo: IModerationRepository | null): void {
  activeRepository = repo;
}
