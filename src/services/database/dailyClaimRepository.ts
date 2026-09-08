// src/services/database/dailyClaimRepository.ts

import { Pool } from 'pg';
import { getPool } from './pool';

export interface DailyClaim {
  id?: number;
  userId: string;
  guildId: string;
  sparksAwarded: number;
  isHighKarma: boolean;
  claimedAt: Date;
}

export interface CreateDailyClaimInput {
  userId: string;
  guildId: string;
  sparksAwarded: number;
  isHighKarma: boolean;
  claimedAt?: Date;
}

export interface IDailyClaimRepository {
  recordClaim(input: CreateDailyClaimInput): Promise<DailyClaim>;
  getLastClaim(userId: string): Promise<DailyClaim | null>;
  getClaimCount(userId: string): Promise<number>;
  listRecentClaims(userId: string, limit?: number): Promise<DailyClaim[]>;
  clear?(): Promise<void>;
}

/**
 * In-memory implementation of IDailyClaimRepository for test hermeticity.
 */
export class InMemoryDailyClaimRepository implements IDailyClaimRepository {
  private claims: DailyClaim[] = [];

  async recordClaim(input: CreateDailyClaimInput): Promise<DailyClaim> {
    const claim: DailyClaim = {
      id: this.claims.length + 1,
      userId: input.userId,
      guildId: input.guildId,
      sparksAwarded: input.sparksAwarded,
      isHighKarma: input.isHighKarma,
      claimedAt: input.claimedAt || new Date(),
    };
    this.claims.push(claim);
    return { ...claim };
  }

  async getLastClaim(userId: string): Promise<DailyClaim | null> {
    const userClaims = this.claims
      .filter((c) => c.userId === userId)
      .sort((a, b) => b.claimedAt.getTime() - a.claimedAt.getTime());

    return userClaims[0] ? { ...userClaims[0] } : null;
  }

  async getClaimCount(userId: string): Promise<number> {
    return this.claims.filter((c) => c.userId === userId).length;
  }

  async listRecentClaims(userId: string, limit: number = 25): Promise<DailyClaim[]> {
    return this.claims
      .filter((c) => c.userId === userId)
      .sort((a, b) => b.claimedAt.getTime() - a.claimedAt.getTime())
      .slice(0, limit)
      .map((c) => ({ ...c }));
  }

  async clear(): Promise<void> {
    this.claims = [];
  }
}

/**
 * PostgreSQL implementation of IDailyClaimRepository.
 */
interface DailyClaimRow {
  id?: string | number;
  user_id: string;
  guild_id: string;
  sparks_awarded: string | number;
  is_high_karma: boolean | number | string;
  claimed_at: string | Date;
}

export class PostgresDailyClaimRepository implements IDailyClaimRepository {
  private pool: Pool;

  constructor(poolOrConnectionString?: Pool | string) {
    if (poolOrConnectionString && typeof poolOrConnectionString === 'object') {
      this.pool = poolOrConnectionString;
    } else {
      this.pool = getPool();
    }
  }

  private mapRow(row: DailyClaimRow): DailyClaim {
    return {
      id: row.id ? parseInt(String(row.id), 10) : undefined,
      userId: row.user_id,
      guildId: row.guild_id,
      sparksAwarded: parseInt(String(row.sparks_awarded), 10),
      isHighKarma: Boolean(row.is_high_karma),
      claimedAt: new Date(row.claimed_at),
    };
  }

  async recordClaim(input: CreateDailyClaimInput): Promise<DailyClaim> {
    const query = `
      INSERT INTO daily_claims (
        user_id, guild_id, sparks_awarded, is_high_karma, claimed_at
      ) VALUES ($1, $2, $3, $4, COALESCE($5, NOW()))
      RETURNING *;
    `;
    const values = [
      input.userId,
      input.guildId,
      input.sparksAwarded,
      input.isHighKarma,
      input.claimedAt || null,
    ];

    const res = await this.pool.query(query, values);
    return this.mapRow(res.rows[0]);
  }

  async getLastClaim(userId: string): Promise<DailyClaim | null> {
    const query = `
      SELECT * FROM daily_claims
      WHERE user_id = $1
      ORDER BY claimed_at DESC
      LIMIT 1;
    `;
    const res = await this.pool.query(query, [userId]);
    if (res.rows.length === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  async getClaimCount(userId: string): Promise<number> {
    const query = 'SELECT COUNT(*)::int AS count FROM daily_claims WHERE user_id = $1;';
    const res = await this.pool.query(query, [userId]);
    return res.rows[0]?.count || 0;
  }

  async listRecentClaims(userId: string, limit: number = 25): Promise<DailyClaim[]> {
    const query = `
      SELECT * FROM daily_claims
      WHERE user_id = $1
      ORDER BY claimed_at DESC
      LIMIT $2;
    `;
    const res = await this.pool.query(query, [userId, limit]);
    return res.rows.map((r) => this.mapRow(r));
  }

  async clear(): Promise<void> {
    await this.pool.query('TRUNCATE TABLE daily_claims CASCADE;');
  }
}

let activeDailyClaimRepo: IDailyClaimRepository | null = null;

export function getDailyClaimRepository(): IDailyClaimRepository {
  if (activeDailyClaimRepo) return activeDailyClaimRepo;

  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0) {
    try {
      activeDailyClaimRepo = new PostgresDailyClaimRepository();
      return activeDailyClaimRepo;
    } catch (err) {
      console.warn('Failed to initialize PostgresDailyClaimRepository, using in-memory fallback:', err);
    }
  }

  activeDailyClaimRepo = new InMemoryDailyClaimRepository();
  return activeDailyClaimRepo;
}

export function setDailyClaimRepository(repo: IDailyClaimRepository | null): void {
  activeDailyClaimRepo = repo;
}
