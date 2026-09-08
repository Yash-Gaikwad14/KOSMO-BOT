// src/services/database/index.ts
/**
 * Unified KOSMO-BOT Database Foundation Service.
 *
 * Provides centralized PostgreSQL connection pool lifecycle,
 * versioned migration execution, and repositories for KOSMO-BOT-owned durable state:
 * - Audit Events (audit_events)
 * - Guild Configuration (guild_configs)
 * - Daily Claims History (daily_claims)
 *
 * NOTE: UnbelievaBoat remains authoritative for Sparks balances.
 * Arcane remains authoritative for Karma.
 * Kosmo billing remains authoritative for customer subscriptions.
 * No competing local balance ledgers exist in KOSMO-BOT.
 */

export * from './pool';
export * from './migrator';
export * from './auditRepository';
export * from './guildConfigRepository';
export * from './dailyClaimRepository';

import { checkDatabaseHealth, closeDatabasePool, getPool } from './pool';
import { runMigrations } from './migrator';
import { getAuditRepository } from './auditRepository';
import { getGuildConfigRepository } from './guildConfigRepository';
import { getDailyClaimRepository } from './dailyClaimRepository';

export interface DatabaseService {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  health(): Promise<{ healthy: boolean; latencyMs?: number; error?: string }>;
  migrate(): Promise<void>;
  audit: ReturnType<typeof getAuditRepository>;
  guildConfig: ReturnType<typeof getGuildConfigRepository>;
  dailyClaims: ReturnType<typeof getDailyClaimRepository>;
}

class UnifiedDatabaseService implements DatabaseService {
  async connect(): Promise<void> {
    const health = await checkDatabaseHealth();
    if (!health.healthy) {
      throw new Error(`Failed to establish database connection: ${health.error}`);
    }
    console.log(`✅ PostgreSQL connection verified (${health.latencyMs}ms latency)`);
  }

  async disconnect(): Promise<void> {
    await closeDatabasePool();
  }

  async health(): Promise<{ healthy: boolean; latencyMs?: number; error?: string }> {
    return checkDatabaseHealth();
  }

  async migrate(): Promise<void> {
    await runMigrations();
  }

  get audit() {
    return getAuditRepository();
  }

  get guildConfig() {
    return getGuildConfigRepository();
  }

  get dailyClaims() {
    return getDailyClaimRepository();
  }
}

export const db: DatabaseService = new UnifiedDatabaseService();
