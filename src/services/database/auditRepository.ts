// src/services/database/auditRepository.ts

import { Pool } from 'pg';
import crypto from 'crypto';
import { getPool } from './pool';

export interface AuditEvent {
  id?: number;
  eventId: string;
  guildId: string;
  actionType: string;
  actorId: string;
  targetId?: string;
  status: 'SUCCESS' | 'FAILED' | 'REJECTED';
  metadata: Record<string, any>;
  createdAt: Date;
}

export interface CreateAuditEventInput {
  eventId?: string;
  guildId: string;
  actionType: string;
  actorId: string;
  targetId?: string;
  status: 'SUCCESS' | 'FAILED' | 'REJECTED';
  metadata?: Record<string, any>;
  createdAt?: Date;
}

export interface IAuditRepository {
  recordEvent(input: CreateAuditEventInput): Promise<AuditEvent>;
  listRecentEvents(guildId: string, limit?: number): Promise<AuditEvent[]>;
  listEventsByAction(guildId: string, actionType: string, limit?: number): Promise<AuditEvent[]>;
  clear?(): Promise<void>;
}

export function generateEventId(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `AUDIT-${dateStr}-${rand}`;
}

/**
 * In-memory implementation of IAuditRepository for testing and offline environments.
 */
export class InMemoryAuditRepository implements IAuditRepository {
  private events: AuditEvent[] = [];

  async recordEvent(input: CreateAuditEventInput): Promise<AuditEvent> {
    const eventId = input.eventId || generateEventId();
    const event: AuditEvent = {
      id: this.events.length + 1,
      eventId,
      guildId: input.guildId,
      actionType: input.actionType,
      actorId: input.actorId,
      targetId: input.targetId,
      status: input.status,
      metadata: input.metadata || {},
      createdAt: input.createdAt || new Date(),
    };
    this.events.push(event);
    return { ...event };
  }

  async listRecentEvents(guildId: string, limit: number = 25): Promise<AuditEvent[]> {
    return this.events
      .filter((e) => e.guildId === guildId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((e) => ({ ...e }));
  }

  async listEventsByAction(guildId: string, actionType: string, limit: number = 25): Promise<AuditEvent[]> {
    return this.events
      .filter((e) => e.guildId === guildId && e.actionType === actionType)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((e) => ({ ...e }));
  }

  async clear(): Promise<void> {
    this.events = [];
  }
}

/**
 * PostgreSQL implementation of IAuditRepository.
 */
interface AuditEventRow {
  id?: string | number;
  event_id: string;
  guild_id: string;
  action_type: string;
  actor_id: string;
  target_id?: string | null;
  status: 'SUCCESS' | 'FAILED' | 'REJECTED';
  metadata: string | Record<string, unknown>;
  created_at: string | Date;
}

export class PostgresAuditRepository implements IAuditRepository {
  private pool: Pool;

  constructor(poolOrConnectionString?: Pool | string) {
    if (poolOrConnectionString && typeof poolOrConnectionString === 'object') {
      this.pool = poolOrConnectionString;
    } else {
      this.pool = getPool();
    }
  }

  private mapRow(row: AuditEventRow): AuditEvent {
    return {
      id: row.id ? parseInt(String(row.id), 10) : undefined,
      eventId: row.event_id,
      guildId: row.guild_id,
      actionType: row.action_type,
      actorId: row.actor_id,
      targetId: row.target_id || undefined,
      status: row.status,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {},
      createdAt: new Date(row.created_at),
    };
  }

  async recordEvent(input: CreateAuditEventInput): Promise<AuditEvent> {
    const eventId = input.eventId || generateEventId();
    const query = `
      INSERT INTO audit_events (
        event_id, guild_id, action_type, actor_id, target_id, status, metadata, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW()))
      RETURNING *;
    `;
    const values = [
      eventId,
      input.guildId,
      input.actionType,
      input.actorId,
      input.targetId || null,
      input.status,
      JSON.stringify(input.metadata || {}),
      input.createdAt || null,
    ];

    const res = await this.pool.query(query, values);
    return this.mapRow(res.rows[0]);
  }

  async listRecentEvents(guildId: string, limit: number = 25): Promise<AuditEvent[]> {
    const query = `
      SELECT * FROM audit_events
      WHERE guild_id = $1
      ORDER BY created_at DESC
      LIMIT $2;
    `;
    const res = await this.pool.query(query, [guildId, limit]);
    return res.rows.map((r) => this.mapRow(r));
  }

  async listEventsByAction(guildId: string, actionType: string, limit: number = 25): Promise<AuditEvent[]> {
    const query = `
      SELECT * FROM audit_events
      WHERE guild_id = $1 AND action_type = $2
      ORDER BY created_at DESC
      LIMIT $3;
    `;
    const res = await this.pool.query(query, [guildId, actionType, limit]);
    return res.rows.map((r) => this.mapRow(r));
  }

  async clear(): Promise<void> {
    await this.pool.query('TRUNCATE TABLE audit_events CASCADE;');
  }
}

let activeAuditRepo: IAuditRepository | null = null;

export function getAuditRepository(): IAuditRepository {
  if (activeAuditRepo) return activeAuditRepo;

  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0) {
    try {
      activeAuditRepo = new PostgresAuditRepository();
      return activeAuditRepo;
    } catch (err) {
      console.warn('Failed to initialize PostgresAuditRepository, using in-memory fallback:', err);
    }
  }

  activeAuditRepo = new InMemoryAuditRepository();
  return activeAuditRepo;
}

export function setAuditRepository(repo: IAuditRepository | null): void {
  activeAuditRepo = repo;
}
