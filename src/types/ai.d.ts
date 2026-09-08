// src/types/ai.d.ts

import { Guild } from 'discord.js';
import { AuthLevel } from '../services/discord/policy';

export type SummaryScope = 'CHANNEL' | 'COMMUNITY';

export interface SummaryRequest {
  guild: Guild;
  scope: SummaryScope;
  channelId?: string;
  requester: {
    id: string;
    username: string;
    authLevel: AuthLevel;
  };
}

export interface SummaryKeyTopic {
  topic: string;
  description: string;
}

export interface ChannelHighlight {
  channelName: string;
  points: string[];
}

export interface SummaryDataProvenance {
  scope: SummaryScope;
  channelsSummarized: string[];
  totalMessagesAnalyzed: number;
  totalUniqueAuthors: number;
  timeWindow?: {
    oldestTimestamp?: string;
    newestTimestamp?: string;
  };
  truncated: boolean;
  excludedChannels: string[];
  partialErrors: string[];
}

export interface StructuredCommunitySummary {
  headline: string;
  overview: string;
  keyTopics: SummaryKeyTopic[];
  highlightsByChannel: ChannelHighlight[];
  toneObservation: string;
  provenance: SummaryDataProvenance;
}

export type SummaryResultStatus =
  | 'SUCCESS'
  | 'PARTIAL'
  | 'NO_DATA'
  | 'UNAVAILABLE'
  | 'FORBIDDEN'
  | 'ERROR'
  | 'UNAUTHORIZED';

export interface SummaryResponse {
  status: SummaryResultStatus;
  summary?: StructuredCommunitySummary;
  errorReason?: string;
  provenance?: SummaryDataProvenance;
  executionTimeMs: number;
  generatedAt: string;
}

export interface SummaryAuditEntry {
  action: 'COMMUNITY_SUMMARY_REQUESTED';
  actorId: string;
  actorTag: string;
  scope: SummaryScope;
  targetChannelId?: string;
  targetChannelName?: string;
  status: SummaryResultStatus;
  messagesAnalyzed: number;
  authorsCount: number;
  truncated: boolean;
  executionTimeMs: number;
  timestamp: Date;
  details?: string;
}
