// src/types/ticket.d.ts

export type TicketRouteDestination =
  | 'ACTIVE_TICKETS'
  | 'FEEDBACK_AND_SUPPORT'
  | 'PRIORITY_SUPPORT';

export type TicketAuditAction =
  | 'TICKET_INSPECT'
  | 'TICKET_VERIFY_PRIVACY'
  | 'TICKET_ROUTE'
  | 'TICKET_CLOSE_REQUEST';

export interface TicketPrivacyAuditReport {
  isPrivate: boolean;
  everyoneDeniesView: boolean;
  staffHasAccess: boolean;
  creatorHasAccess: boolean;
  creatorId?: string;
  issues: string[];
  warnings: string[];
}

export interface TicketMetadata {
  channelId: string;
  channelName: string;
  categoryId: string | null;
  categoryName: string | null;
  createdAt: Date | null;
  creatorId: string | null;
  isPrivate: boolean;
  privacyReport: TicketPrivacyAuditReport;
}

export interface TicketRouteResult {
  success: boolean;
  previousCategoryId: string | null;
  newCategoryId: string;
  newCategoryName: string;
  message: string;
}

export interface TicketAuditEntry {
  guildId: string;
  channelId: string;
  channelName: string;
  actorId: string;
  actorTag: string;
  action: TicketAuditAction;
  details?: string;
  destinationCategory?: string;
  status: 'SUCCESS' | 'FAILED' | 'INFO';
  timestamp: Date;
}
