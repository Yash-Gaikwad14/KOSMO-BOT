// src/types/moderation.d.ts

export type CaseActionType = 'WARN' | 'STRIKE' | 'TIMEOUT' | 'KICK' | 'BAN' | 'PURGE';

export type CaseStatus = 'ACTIONED' | 'RESOLVED' | 'DISMISSED';

export type CaseSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ModerationCase {
  caseId: string;
  guildId: string;
  targetId: string;
  targetTag: string;
  moderatorId: string;
  moderatorTag: string;
  actionType: CaseActionType;
  reason: string;
  evidence?: string;
  severity?: CaseSeverity;
  sanctionApplied?: string;
  status: CaseStatus;
  createdAt: Date;
  resolutionNotes?: string;
}

export interface StrikeRecord {
  strikeId: string;
  caseId: string;
  guildId: string;
  targetId: string;
  moderatorId: string;
  severity: CaseSeverity;
  isActive: boolean;
  createdAt: Date;
}

export interface PolicyRecommendation {
  strikeCount: number;
  recommendedAction: 'WARN' | 'TIMEOUT' | 'BAN';
  timeoutDurationMinutes?: number;
  explanation: string;
  commandHint: string;
}

export interface ModerationHistory {
  targetId: string;
  activeStrikes: number;
  totalCases: number;
  cases: ModerationCase[];
}

export type CreateCaseInput = Omit<ModerationCase, 'caseId' | 'createdAt' | 'status'> & {
  status?: CaseStatus;
  caseId?: string;
  createdAt?: Date;
};

export type CreateStrikeInput = Omit<StrikeRecord, 'strikeId' | 'createdAt' | 'isActive'> & {
  isActive?: boolean;
  strikeId?: string;
};

export interface IModerationRepository {
  createCase(data: CreateCaseInput): Promise<ModerationCase>;
  getCase(caseId: string, guildId: string): Promise<ModerationCase | null>;
  listCasesForTarget(guildId: string, targetId: string): Promise<ModerationCase[]>;
  listRecentCases(guildId: string, limit?: number): Promise<ModerationCase[]>;
  updateCaseStatus(
    caseId: string,
    guildId: string,
    status: CaseStatus,
    resolutionNotes?: string
  ): Promise<ModerationCase | null>;
  recordStrike(data: CreateStrikeInput): Promise<StrikeRecord>;
  getActiveStrikeCount(guildId: string, targetId: string): Promise<number>;
  getActiveStrikes(guildId: string, targetId: string): Promise<StrikeRecord[]>;
  clear?(): Promise<void>;
}

export interface AIAdvisoryAssessment {
  violationCategory: string;
  recommendedSeverity: CaseSeverity;
  recommendedAction: 'WARN' | 'STRIKE' | 'TIMEOUT' | 'BAN';
  suggestedReason: string;
  rationale: string;
  isAdvisoryOnly: boolean;
}
