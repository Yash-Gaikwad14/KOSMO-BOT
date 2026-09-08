// src/services/payments/entitlementProvider.ts

import { Pool } from 'pg';
import {
  IPremiumEntitlementProvider,
  PremiumEntitlement,
  PremiumTier,
  EntitlementStatus,
} from '../../types/premium';

/**
 * In-Memory Mock Entitlement Provider
 * Used for testing and local development.
 */
export class MockPremiumEntitlementProvider implements IPremiumEntitlementProvider {
  private entitlements = new Map<string, PremiumEntitlement>();
  public shouldFail: boolean = false;
  public failureError: Error = new Error('External entitlement provider network failure');

  async getEntitlement(targetId: string): Promise<PremiumEntitlement> {
    if (this.shouldFail) {
      throw this.failureError;
    }

    const existing = this.entitlements.get(targetId);
    if (existing) {
      return { ...existing };
    }

    return {
      targetId,
      tier: 'NONE',
      status: 'ACTIVE',
      isVip: false,
      expiresAt: null,
      source: 'MOCK_DEFAULT',
      updatedAt: new Date(),
    };
  }

  async setEntitlement(entitlement: PremiumEntitlement): Promise<void> {
    this.entitlements.set(entitlement.targetId, {
      ...entitlement,
      updatedAt: new Date(),
    });
  }

  isExternalAuthoritative(): boolean {
    return false;
  }

  clear(): void {
    this.entitlements.clear();
    this.shouldFail = false;
  }
}

import { getPool } from '../database/pool';

/**
 * PostgreSQL Entitlement Provider
 *
 * ARCHITECTURAL NOTICE:
 * KOSMO-BOT's PostgreSQL database is NOT the authoritative payment processor or customer billing source.
 * It serves as:
 * - A synchronized entitlement cache
 * - A staff-managed entitlement store where explicitly required
 * - A development and staging provider
 * - An adapter boundary for the future production web application backend
 */
export class PostgresPremiumEntitlementProvider implements IPremiumEntitlementProvider {
  private pool: Pool;

  constructor(poolOrConnectionString?: Pool | string) {
    if (poolOrConnectionString && typeof poolOrConnectionString === 'object') {
      this.pool = poolOrConnectionString;
    } else {
      this.pool = getPool();
    }
  }

  public async ensureSchema(): Promise<void> {
    return;
  }

  async getEntitlement(targetId: string): Promise<PremiumEntitlement> {
    const res = await this.pool.query(
      'SELECT * FROM premium_entitlements WHERE target_id = $1;',
      [targetId]
    );

    if (res.rows.length === 0) {
      return {
        targetId,
        tier: 'NONE',
        status: 'ACTIVE',
        isVip: false,
        expiresAt: null,
        source: 'DATABASE_CACHE_DEFAULT',
        updatedAt: new Date(),
      };
    }

    const row = res.rows[0];
    return {
      targetId: row.target_id,
      tier: row.tier as PremiumTier,
      status: row.status as EntitlementStatus,
      isVip: Boolean(row.is_vip),
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      source: row.source || 'DATABASE_CACHE',
      updatedAt: new Date(row.updated_at),
    };
  }

  async setEntitlement(entitlement: PremiumEntitlement): Promise<void> {
    const query = `
      INSERT INTO premium_entitlements (target_id, tier, status, is_vip, expires_at, source, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (target_id) DO UPDATE SET
        tier = EXCLUDED.tier,
        status = EXCLUDED.status,
        is_vip = EXCLUDED.is_vip,
        expires_at = EXCLUDED.expires_at,
        source = EXCLUDED.source,
        updated_at = NOW();
    `;
    await this.pool.query(query, [
      entitlement.targetId,
      entitlement.tier,
      entitlement.status,
      Boolean(entitlement.isVip),
      entitlement.expiresAt || null,
      entitlement.source || 'DATABASE_CACHE',
    ]);
  }

  isExternalAuthoritative(): boolean {
    return false;
  }
}

/**
 * External API Entitlement Provider (Future Kosmo Web App / Billing Backend Adapter)
 */
export class ExternalApiEntitlementProvider implements IPremiumEntitlementProvider {
  private apiUrl: string;
  private apiKey: string;

  constructor(apiUrl?: string, apiKey?: string) {
    this.apiUrl = apiUrl || process.env.KOSMO_ENTITLEMENT_API_URL || '';
    this.apiKey = apiKey || process.env.KOSMO_BILLING_API_KEY || '';
  }

  async getEntitlement(targetId: string): Promise<PremiumEntitlement> {
    if (!this.apiUrl || !this.apiKey) {
      throw new Error(
        'External entitlement backend is not configured. Production synchronization is DEPENDENCY-BLOCKED.'
      );
    }

    const response = await fetch(`${this.apiUrl}/entitlements/${targetId}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`External entitlement API returned HTTP ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      tier?: PremiumTier;
      status?: EntitlementStatus;
      isVip?: boolean;
      expiresAt?: string | number | Date | null;
      updatedAt?: string | number | Date;
    };
    return {
      targetId,
      tier: data.tier || 'NONE',
      status: data.status || 'UNKNOWN',
      isVip: Boolean(data.isVip),
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      source: 'KOSMO_BACKEND',
      updatedAt: new Date(data.updatedAt || Date.now()),
    };
  }

  isExternalAuthoritative(): boolean {
    return true;
  }
}

let activeProvider: IPremiumEntitlementProvider | null = null;

export function getPremiumEntitlementProvider(): IPremiumEntitlementProvider {
  if (activeProvider) {
    return activeProvider;
  }

  if (process.env.KOSMO_ENTITLEMENT_API_URL && process.env.KOSMO_BILLING_API_KEY) {
    activeProvider = new ExternalApiEntitlementProvider();
    return activeProvider;
  }

  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0) {
    try {
      activeProvider = new PostgresPremiumEntitlementProvider();
      return activeProvider;
    } catch (err) {
      console.warn('Failed to initialize PostgresPremiumEntitlementProvider, falling back to mock:', err);
    }
  }

  activeProvider = new MockPremiumEntitlementProvider();
  return activeProvider;
}

export function setPremiumEntitlementProvider(provider: IPremiumEntitlementProvider | null): void {
  activeProvider = provider;
}
