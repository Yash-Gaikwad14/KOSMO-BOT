// src/services/engagement/introductionRepository.ts
/**
 * Introduction Channel Icebreaker Durable State Repository.
 *
 * Enforces atomic, multi-instance durable welcome claims:
 * - PostgreSQL is the authoritative state store using a unique primary key (guild_id, user_id)
 *   and atomic `INSERT ... ON CONFLICT DO NOTHING`.
 * - Redis provides an optional distributed fast-path concurrency lock.
 * - Never returns true for a user who has already been welcomed.
 * - In-memory implementation provided for offline/test environments.
 */

import { Pool } from 'pg';
import { getPool } from '../database/pool';
import { cache } from '../cache';

export interface IIntroductionRepository {
  claimWelcome(guildId: string, userId: string): Promise<boolean>;
  hasBeenWelcomed(guildId: string, userId: string): Promise<boolean>;
  clear?(): Promise<void>;
}

export function getIntroductionWelcomeMessage(userId: string): string {
  return `Welcome to the Kosmoverse, <@${userId}>. Enough with the formalities. What are you building, learning, or currently trying to compile?`;
}

/**
 * In-memory repository for hermetic unit and integration testing.
 */
export class InMemoryIntroductionRepository implements IIntroductionRepository {
  private welcomed = new Set<string>();

  private makeKey(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
  }

  async claimWelcome(guildId: string, userId: string): Promise<boolean> {
    const key = this.makeKey(guildId, userId);
    if (this.welcomed.has(key)) {
      return false;
    }
    this.welcomed.add(key);
    return true;
  }

  async hasBeenWelcomed(guildId: string, userId: string): Promise<boolean> {
    return this.welcomed.has(this.makeKey(guildId, userId));
  }

  async clear(): Promise<void> {
    this.welcomed.clear();
  }
}

/**
 * PostgreSQL authoritative repository for multi-instance production deployment.
 */
export class PostgresIntroductionRepository implements IIntroductionRepository {
  private pool: Pool;
  private tableEnsured = false;

  constructor(poolOrConnectionString?: Pool | string) {
    if (poolOrConnectionString && typeof poolOrConnectionString === 'object') {
      this.pool = poolOrConnectionString;
    } else {
      this.pool = getPool();
    }
  }

  /**
   * Idempotently creates the authoritative welcome tracking table if missing.
   */
  public async ensureTable(): Promise<void> {
    if (this.tableEnsured) return;

    const query = `
      CREATE TABLE IF NOT EXISTS introduction_welcomes (
        guild_id VARCHAR(32) NOT NULL,
        user_id VARCHAR(32) NOT NULL,
        welcomed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_intro_welcomes_guild 
        ON introduction_welcomes(guild_id, welcomed_at DESC);
    `;

    try {
      await this.pool.query(query);
      this.tableEnsured = true;
    } catch (err) {
      // Allow fallback if already exists or permission issues
      console.error('Failed to verify introduction_welcomes table:', err);
    }
  }

  /**
   * Atomically claims a welcome for the given user in a guild.
   * Returns true ONLY if this claim inserted a new record.
   */
  async claimWelcome(guildId: string, userId: string): Promise<boolean> {
    if (!guildId || !userId) return false;

    // 1. Redis distributed concurrency fast-path lock (10 seconds)
    const lockKey = `lock:intro:${guildId}:${userId}`;
    let lockToken: string | undefined;

    try {
      const lockRes = await cache.acquireLock(lockKey, 10);
      if (!lockRes.acquired && !lockRes.error) {
        // Concurrent worker is already claiming this welcome
        return false;
      }
      if (lockRes.acquired) {
        lockToken = lockRes.token;
      }
    } catch (_err) {
      // Redis is optional fast-path; if Redis is down, proceed directly to PostgreSQL authority
    }

    try {
      await this.ensureTable();

      const insertQuery = `
        INSERT INTO introduction_welcomes (guild_id, user_id, welcomed_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (guild_id, user_id) DO NOTHING;
      `;

      const result = await this.pool.query(insertQuery, [guildId, userId]);
      return (result.rowCount || 0) > 0;
    } finally {
      if (lockToken) {
        try {
          await cache.releaseLock(lockKey, lockToken);
        } catch {
          // Best effort lock release
        }
      }
    }
  }

  async hasBeenWelcomed(guildId: string, userId: string): Promise<boolean> {
    if (!guildId || !userId) return false;
    await this.ensureTable();

    const query = `
      SELECT 1 FROM introduction_welcomes
      WHERE guild_id = $1 AND user_id = $2
      LIMIT 1;
    `;
    const res = await this.pool.query(query, [guildId, userId]);
    return (res.rowCount || 0) > 0;
  }

  async clear(): Promise<void> {
    await this.ensureTable();
    await this.pool.query('DELETE FROM introduction_welcomes;');
  }
}

let activeIntroductionRepo: IIntroductionRepository | null = null;

export function getIntroductionRepository(): IIntroductionRepository {
  if (activeIntroductionRepo) {
    return activeIntroductionRepo;
  }

  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0) {
    try {
      activeIntroductionRepo = new PostgresIntroductionRepository();
      return activeIntroductionRepo;
    } catch (err) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`CRITICAL: Production PostgreSQL introduction repository failed: ${err}`);
      }
    }
  }

  activeIntroductionRepo = new InMemoryIntroductionRepository();
  return activeIntroductionRepo;
}

export function setIntroductionRepository(repo: IIntroductionRepository | null): void {
  activeIntroductionRepo = repo;
}
