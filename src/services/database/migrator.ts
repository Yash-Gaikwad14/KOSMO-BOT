// src/services/database/migrator.ts

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { getPool } from './pool';

export interface MigrationResult {
  version: string;
  name: string;
  applied: boolean;
  error?: string;
}

/**
 * Migration definition with embedded SQL as a robust fallback
 * in case migration files are relocated during compilation.
 */
interface MigrationDefinition {
  version: string;
  name: string;
  filename: string;
  embeddedSql: string;
}

export const KNOWN_MIGRATIONS: MigrationDefinition[] = [
  {
    version: '001',
    name: '001_initial_schema',
    filename: '001_initial_schema.sql',
    embeddedSql: `
CREATE TABLE IF NOT EXISTS guild_configs (
    guild_id VARCHAR(32) PRIMARY KEY,
    mod_logs_channel_id VARCHAR(32),
    support_tickets_category_id VARCHAR(32),
    priority_tickets_category_id VARCHAR(32),
    high_karma_role_id VARCHAR(32),
    desired_state_json JSONB,
    roles_config_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS moderation_cases (
    case_id VARCHAR(32) PRIMARY KEY,
    guild_id VARCHAR(32) NOT NULL,
    target_id VARCHAR(32) NOT NULL,
    target_tag VARCHAR(128) NOT NULL,
    moderator_id VARCHAR(32) NOT NULL,
    moderator_tag VARCHAR(128) NOT NULL,
    action_type VARCHAR(32) NOT NULL,
    reason TEXT NOT NULL,
    evidence TEXT,
    severity VARCHAR(32) NOT NULL DEFAULT 'MEDIUM',
    sanction_applied VARCHAR(128),
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIONED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolution_notes TEXT
);

CREATE TABLE IF NOT EXISTS moderation_strikes (
    strike_id VARCHAR(32) PRIMARY KEY,
    case_id VARCHAR(32) NOT NULL REFERENCES moderation_cases(case_id) ON DELETE CASCADE,
    guild_id VARCHAR(32) NOT NULL,
    target_id VARCHAR(32) NOT NULL,
    moderator_id VARCHAR(32) NOT NULL,
    severity VARCHAR(32) NOT NULL DEFAULT 'MEDIUM',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mod_cases_guild_target_created 
    ON moderation_cases(guild_id, target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mod_cases_guild_created 
    ON moderation_cases(guild_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mod_strikes_active 
    ON moderation_strikes(guild_id, target_id, is_active) 
    WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS audit_events (
    id BIGSERIAL PRIMARY KEY,
    event_id VARCHAR(64) UNIQUE NOT NULL,
    guild_id VARCHAR(32) NOT NULL,
    action_type VARCHAR(64) NOT NULL,
    actor_id VARCHAR(32) NOT NULL,
    target_id VARCHAR(32),
    status VARCHAR(32) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_guild_created 
    ON audit_events(guild_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_action 
    ON audit_events(action_type, created_at DESC);

CREATE TABLE IF NOT EXISTS daily_claims (
    id BIGSERIAL PRIMARY KEY,
    user_id VARCHAR(32) NOT NULL,
    guild_id VARCHAR(32) NOT NULL,
    sparks_awarded INTEGER NOT NULL,
    is_high_karma BOOLEAN NOT NULL DEFAULT FALSE,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_claims_user_recent 
    ON daily_claims(user_id, claimed_at DESC);

CREATE INDEX IF NOT EXISTS idx_daily_claims_guild_user 
    ON daily_claims(guild_id, user_id, claimed_at DESC);

CREATE TABLE IF NOT EXISTS premium_entitlements (
    target_id VARCHAR(32) PRIMARY KEY,
    tier VARCHAR(16) NOT NULL,
    status VARCHAR(32) NOT NULL,
    is_vip BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ,
    source VARCHAR(64) NOT NULL DEFAULT 'DATABASE_CACHE',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_premium_entitlements_tier_status 
    ON premium_entitlements(tier, status);
    `,
  },
];

/**
 * Resolves the SQL content for a migration, reading from file if available
 * or falling back to the embedded definition.
 */
function resolveMigrationSql(migration: MigrationDefinition): string {
  const candidatePaths = [
    path.resolve(__dirname, '../../migrations', migration.filename),
    path.resolve(__dirname, '../../../src/migrations', migration.filename),
    path.resolve(process.cwd(), 'src/migrations', migration.filename),
    path.resolve(process.cwd(), 'dist/migrations', migration.filename),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        return fs.readFileSync(p, 'utf-8');
      } catch {
        // Fall back to embedded
      }
    }
  }

  return migration.embeddedSql;
}

/**
 * Ensures the migration tracking table `schema_migrations` exists.
 */
export async function ensureMigrationTable(pool: Pool): Promise<void> {
  const query = `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(64) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await pool.query(query);
}

/**
 * Retrieves the set of already applied migration versions.
 */
export async function getAppliedMigrations(pool: Pool): Promise<Set<string>> {
  await ensureMigrationTable(pool);
  const res = await pool.query<{ version: string }>('SELECT version FROM schema_migrations;');
  return new Set(res.rows.map((r) => r.version));
}

/**
 * Runs all pending versioned SQL migrations in order within transactional boundaries.
 * Returns the list of applied migration results.
 */
export async function runMigrations(customPool?: Pool): Promise<MigrationResult[]> {
  const pool = customPool || getPool();
  await ensureMigrationTable(pool);

  const appliedVersions = await getAppliedMigrations(pool);
  const results: MigrationResult[] = [];

  for (const migration of KNOWN_MIGRATIONS) {
    if (appliedVersions.has(migration.version)) {
      results.push({
        version: migration.version,
        name: migration.name,
        applied: false,
      });
      continue;
    }

    const sql = resolveMigrationSql(migration);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version, applied_at) VALUES ($1, NOW()) ON CONFLICT (version) DO NOTHING;',
        [migration.version]
      );
      await client.query('COMMIT');

      console.log(`✅ Applied migration ${migration.name} (${migration.version})`);
      results.push({
        version: migration.version,
        name: migration.name,
        applied: true,
      });
    } catch (err: any) {
      await client.query('ROLLBACK');
      console.error(`❌ Migration failed ${migration.name} (${migration.version}):`, err);
      results.push({
        version: migration.version,
        name: migration.name,
        applied: false,
        error: err?.message || 'Migration failed',
      });
      throw new Error(`Database migration failed on ${migration.name}: ${err?.message}`);
    } finally {
      client.release();
    }
  }

  return results;
}
