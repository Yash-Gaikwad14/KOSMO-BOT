-- 001_initial_schema.sql
-- Initial KOSMO-BOT PostgreSQL Database Schema
-- Version: 001
-- Scope: guild_configs, moderation_cases, moderation_strikes, audit_events, daily_claims, premium_entitlements

-- =============================================================================
-- 1. GUILD CONFIGURATIONS
-- Per-guild settings, channel mappings, and operational configuration.
-- =============================================================================
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

-- =============================================================================
-- 2. MODERATION CASES & STRIKES
-- Disciplinary history, warning records, and active policy strikes.
-- =============================================================================
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

-- =============================================================================
-- 3. AUDIT EVENTS (DURABLE LEDGER)
-- Immutable event ledger for all administrative, moderation, support, and AI actions.
-- =============================================================================
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

-- =============================================================================
-- 4. DAILY CLAIM HISTORY (FRAUD & COOLDOWN RECOVERY)
-- Durable history of daily Sparks claims to survive Redis restarts or outages.
-- =============================================================================
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

-- =============================================================================
-- 5. PREMIUM ENTITLEMENTS (SYNCHRONIZED ADAPTER CACHE)
-- Synchronized cache of subscription tiers for fast role reconciliation.
-- =============================================================================
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
