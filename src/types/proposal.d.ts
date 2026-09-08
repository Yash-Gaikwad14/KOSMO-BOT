// src/types/proposal.d.ts

import { DiscordAction, RiskLevel, ValidationResult } from '../services/discord/types';
import { AuthLevel } from '../services/discord/policy';

export type ProposalStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'EXECUTING'
  | 'VERIFIED'
  | 'PARTIALLY_FAILED'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'REJECTED';

export interface ProposalCreator {
  userId: string;
  username: string;
  authLevel: AuthLevel;
}

export interface ProposalSourceIntelligence {
  summaryScope: 'COMMUNITY' | 'CHANNEL';
  targetChannelId?: string;
  messageCountAnalyzed: number;
  diagnosticsTimestamp: string;
}

export interface CommunityActionProposal {
  planId: string;
  guildId: string;
  creator: ProposalCreator;
  expiration: Date;
  sourceIntelligence: ProposalSourceIntelligence;
  rationale: string;
  actions: DiscordAction[];
  actionRisk: RiskLevel;
  validationStatus: ValidationResult;
  createdAt: Date;
  status: ProposalStatus;
  confirmedBy?: string;
  executionResults?: string[];
  failedActionIndex?: number;
  errorMessage?: string;
}

export type ProposalAuditAction =
  | 'COMMUNITY_PROPOSAL_CREATED'
  | 'COMMUNITY_PROPOSAL_REJECTED'
  | 'COMMUNITY_PROPOSAL_CONFIRMED'
  | 'COMMUNITY_PROPOSAL_CANCELLED'
  | 'COMMUNITY_PROPOSAL_EXPIRED'
  | 'COMMUNITY_EXECUTION_STARTED'
  | 'COMMUNITY_EXECUTION_COMPLETED'
  | 'COMMUNITY_EXECUTION_FAILED'
  | 'COMMUNITY_VERIFICATION_FAILED';

export interface ProposalAuditRecord {
  action: ProposalAuditAction;
  planId: string;
  guildId: string;
  actorId: string;
  riskLevel?: RiskLevel;
  actionCount?: number;
  failedActionIndex?: number;
  durationMs?: number;
  timestamp: Date;
  details?: string;
}
