// src/types/premium.d.ts

export type PremiumTier = 'VIP' | 'PRO' | 'MAX' | 'NONE';

export type EntitlementStatus =
  | 'ACTIVE'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'GRACE_PERIOD'
  | 'UNKNOWN';

export interface PremiumEntitlement {
  targetId: string;
  tier: PremiumTier;
  status: EntitlementStatus;
  isVip?: boolean;
  expiresAt?: Date | null;
  source: string; // e.g. 'KOSMO_BACKEND' | 'DATABASE_CACHE' | 'STAFF_SYNC' | 'MOCK'
  updatedAt: Date;
}

export type SyncStatus =
  | 'SUCCESS'
  | 'NO_CHANGE'
  | 'BLOCKED_ROLE_HIERARCHY'
  | 'SYNC_FAILED'
  | 'DEPENDENCY_BLOCKED'
  | 'UNAUTHORIZED';

export interface RoleMutationRecord {
  action: 'ADD' | 'REMOVE';
  roleId: string;
  roleName: string;
}

export interface PremiumSyncResult {
  targetId: string;
  targetTag?: string;
  status: SyncStatus;
  currentTier: PremiumTier;
  entitledTier: PremiumTier;
  hasVip: boolean;
  entitledVip: boolean;
  mutations: RoleMutationRecord[];
  verified: boolean;
  auditLogged: boolean;
  error?: string;
}

export interface IPremiumEntitlementProvider {
  getEntitlement(targetId: string): Promise<PremiumEntitlement>;
  setEntitlement?(entitlement: PremiumEntitlement): Promise<void>;
  isExternalAuthoritative(): boolean;
}
