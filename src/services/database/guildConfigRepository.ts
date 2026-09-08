// src/services/database/guildConfigRepository.ts

import { Pool } from 'pg';
import { getPool } from './pool';

export interface GuildConfig {
  guildId: string;
  modLogsChannelId?: string;
  supportTicketsCategoryId?: string;
  priorityTicketsCategoryId?: string;
  highKarmaRoleId?: string;
  desiredStateJson?: Record<string, any>;
  rolesConfigJson?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertGuildConfigInput {
  guildId: string;
  modLogsChannelId?: string;
  supportTicketsCategoryId?: string;
  priorityTicketsCategoryId?: string;
  highKarmaRoleId?: string;
  desiredStateJson?: Record<string, any>;
  rolesConfigJson?: Record<string, any>;
}

export interface IGuildConfigRepository {
  getConfig(guildId: string): Promise<GuildConfig | null>;
  upsertConfig(input: UpsertGuildConfigInput): Promise<GuildConfig>;
  deleteConfig?(guildId: string): Promise<boolean>;
  clear?(): Promise<void>;
}

/**
 * In-memory implementation for hermetic test execution.
 */
export class InMemoryGuildConfigRepository implements IGuildConfigRepository {
  private configs = new Map<string, GuildConfig>();

  async getConfig(guildId: string): Promise<GuildConfig | null> {
    const found = this.configs.get(guildId);
    return found ? { ...found } : null;
  }

  async upsertConfig(input: UpsertGuildConfigInput): Promise<GuildConfig> {
    const existing = this.configs.get(input.guildId);
    const now = new Date();

    const config: GuildConfig = {
      guildId: input.guildId,
      modLogsChannelId: input.modLogsChannelId !== undefined ? input.modLogsChannelId : existing?.modLogsChannelId,
      supportTicketsCategoryId: input.supportTicketsCategoryId !== undefined ? input.supportTicketsCategoryId : existing?.supportTicketsCategoryId,
      priorityTicketsCategoryId: input.priorityTicketsCategoryId !== undefined ? input.priorityTicketsCategoryId : existing?.priorityTicketsCategoryId,
      highKarmaRoleId: input.highKarmaRoleId !== undefined ? input.highKarmaRoleId : existing?.highKarmaRoleId,
      desiredStateJson: input.desiredStateJson !== undefined ? input.desiredStateJson : existing?.desiredStateJson,
      rolesConfigJson: input.rolesConfigJson !== undefined ? input.rolesConfigJson : existing?.rolesConfigJson,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    this.configs.set(input.guildId, config);
    return { ...config };
  }

  async deleteConfig(guildId: string): Promise<boolean> {
    return this.configs.delete(guildId);
  }

  async clear(): Promise<void> {
    this.configs.clear();
  }
}

/**
 * PostgreSQL implementation of IGuildConfigRepository.
 */
interface GuildConfigRow {
  guild_id: string;
  mod_logs_channel_id?: string | null;
  support_tickets_category_id?: string | null;
  priority_tickets_category_id?: string | null;
  high_karma_role_id?: string | null;
  desired_state_json?: string | Record<string, unknown> | null;
  roles_config_json?: string | Record<string, unknown> | null;
  created_at: string | Date;
  updated_at: string | Date;
}

export class PostgresGuildConfigRepository implements IGuildConfigRepository {
  private pool: Pool;

  constructor(poolOrConnectionString?: Pool | string) {
    if (poolOrConnectionString && typeof poolOrConnectionString === 'object') {
      this.pool = poolOrConnectionString;
    } else {
      this.pool = getPool();
    }
  }

  private mapRow(row: GuildConfigRow): GuildConfig {
    return {
      guildId: row.guild_id,
      modLogsChannelId: row.mod_logs_channel_id || undefined,
      supportTicketsCategoryId: row.support_tickets_category_id || undefined,
      priorityTicketsCategoryId: row.priority_tickets_category_id || undefined,
      highKarmaRoleId: row.high_karma_role_id || undefined,
      desiredStateJson: (typeof row.desired_state_json === 'string' ? JSON.parse(row.desired_state_json) : row.desired_state_json || undefined) as Record<string, any> | undefined,
      rolesConfigJson: (typeof row.roles_config_json === 'string' ? JSON.parse(row.roles_config_json) : row.roles_config_json || undefined) as Record<string, any> | undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  async getConfig(guildId: string): Promise<GuildConfig | null> {
    const query = 'SELECT * FROM guild_configs WHERE guild_id = $1;';
    const res = await this.pool.query(query, [guildId]);
    if (res.rows.length === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  async upsertConfig(input: UpsertGuildConfigInput): Promise<GuildConfig> {
    const query = `
      INSERT INTO guild_configs (
        guild_id, mod_logs_channel_id, support_tickets_category_id,
        priority_tickets_category_id, high_karma_role_id,
        desired_state_json, roles_config_json, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      ON CONFLICT (guild_id) DO UPDATE SET
        mod_logs_channel_id = COALESCE(EXCLUDED.mod_logs_channel_id, guild_configs.mod_logs_channel_id),
        support_tickets_category_id = COALESCE(EXCLUDED.support_tickets_category_id, guild_configs.support_tickets_category_id),
        priority_tickets_category_id = COALESCE(EXCLUDED.priority_tickets_category_id, guild_configs.priority_tickets_category_id),
        high_karma_role_id = COALESCE(EXCLUDED.high_karma_role_id, guild_configs.high_karma_role_id),
        desired_state_json = COALESCE(EXCLUDED.desired_state_json, guild_configs.desired_state_json),
        roles_config_json = COALESCE(EXCLUDED.roles_config_json, guild_configs.roles_config_json),
        updated_at = NOW()
      RETURNING *;
    `;
    const values = [
      input.guildId,
      input.modLogsChannelId || null,
      input.supportTicketsCategoryId || null,
      input.priorityTicketsCategoryId || null,
      input.highKarmaRoleId || null,
      input.desiredStateJson ? JSON.stringify(input.desiredStateJson) : null,
      input.rolesConfigJson ? JSON.stringify(input.rolesConfigJson) : null,
    ];

    const res = await this.pool.query(query, values);
    return this.mapRow(res.rows[0]);
  }

  async deleteConfig(guildId: string): Promise<boolean> {
    const res = await this.pool.query('DELETE FROM guild_configs WHERE guild_id = $1;', [guildId]);
    return (res.rowCount ?? 0) > 0;
  }

  async clear(): Promise<void> {
    await this.pool.query('TRUNCATE TABLE guild_configs CASCADE;');
  }
}

let activeGuildConfigRepo: IGuildConfigRepository | null = null;

export function getGuildConfigRepository(): IGuildConfigRepository {
  if (activeGuildConfigRepo) return activeGuildConfigRepo;

  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0) {
    try {
      activeGuildConfigRepo = new PostgresGuildConfigRepository();
      return activeGuildConfigRepo;
    } catch (err) {
      console.warn('Failed to initialize PostgresGuildConfigRepository, using in-memory fallback:', err);
    }
  }

  activeGuildConfigRepo = new InMemoryGuildConfigRepository();
  return activeGuildConfigRepo;
}

export function setGuildConfigRepository(repo: IGuildConfigRepository | null): void {
  activeGuildConfigRepo = repo;
}
