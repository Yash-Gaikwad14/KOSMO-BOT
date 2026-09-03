// src/types/repair.d.ts

import { Guild } from 'discord.js';
import { DiscordAction } from '../services/discord/types';
import { DesiredState } from './desiredState';
import { AuditReport } from './audit';

export type DriftType =
  | 'MISSING_ROLE'
  | 'MISSING_CHANNEL'
  | 'PERMISSION_DRIFT'
  | 'ROLE_DRIFT'
  | 'CHANNEL_TYPE_MISMATCH'
  | 'FOUNDER_DRIFT'
  | 'UNMANAGED_RESOURCE';

export type DriftSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'PROTECTED';

export interface DriftItem {
  type: DriftType;
  targetName: string;
  description: string;
  severity?: DriftSeverity;
  details?: Record<string, any>;
}

export type RepairPlanStatus =
  | 'READY'
  | 'PENDING_APPROVAL'
  | 'BLOCKED'
  | 'DENIED'
  | 'NO_OP';

export interface RepairResult {
  status: RepairPlanStatus;
  actions: DiscordAction[];
  driftItems: DriftItem[];
  warnings: string[];
  errors: string[];
  blockedReasons?: string[];
  summary: string;
  generatedAt: Date;
}

export interface RepairOptions {
  guild: Guild;
  userRoleIds: string[];
  desiredState?: DesiredState;
  auditReport?: AuditReport;
}
