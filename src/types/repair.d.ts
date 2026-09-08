// src/types/repair.d.ts

import type { AuditReport } from './audit.d';
import type { DesiredState } from './desiredState.d';
import type { DiscordAction, ValidationResult } from '../services/discord/types';

/** Input for the repair planning function */
export interface RepairInput {
  /** Current audit report of the guild */
  audit: AuditReport;
  /** Desired state configuration */
  desired: DesiredState;
  /** Discord role IDs that the requesting user possesses */
  userRoleIds: string[];
}

/** Possible statuses of the repair planning step */
export type RepairStatus =
  | 'READY'
  | 'DENIED'
  | 'PENDING_APPROVAL'
  | 'BLOCKED'
  | 'ERROR';

/** Result of the repair planning step */
export interface RepairResult {
  /** Overall status */
  status: RepairStatus;

  /** Actions that can be executed safely via runAction() */
  actions: DiscordAction[];

  /** Validation result if actions were validated (optional) */
  validation?: ValidationResult;

  /** Non‑fatal warnings (e.g., unsupported drift) */
  warnings?: string[];

  /** Fatal errors that prevented plan generation */
  errors?: string[];

  /** Summary of mismatches and drifts */
  summary?: {
    missingRoles: string[];
    missingChannels: string[];
    permissionDrift: string[];
    commandDrift: string[];
    protectedResources: string[];
  };
}

