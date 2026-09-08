// src/services/moderation/aiAdvisory.ts

import { AIAdvisoryAssessment, CaseSeverity } from '../../types/moderation';

export interface IncidentContext {
  incidentText?: string;
  evidence?: string;
  currentStrikeCount: number;
  reportedCategory?: string;
}

/**
 * Evaluates incident context and provides a structured advisory assessment.
 *
 * CRITICAL SECURITY BOUNDARIES:
 * - AI IS ADVISORY ONLY.
 * - AI has ZERO autonomous mutation capability.
 * - AI output is untrusted and must never directly execute timeouts, kicks, bans, or strikes.
 * - A human staff member must review and explicitly authorize any resulting moderation action.
 */
export function generateModerationAdvisory(context: IncidentContext): AIAdvisoryAssessment {
  const text = `${context.incidentText || ''} ${context.evidence || ''}`.toLowerCase();
  const strikes = context.currentStrikeCount;

  let category = 'GENERAL_RULE_VIOLATION';
  let severity: CaseSeverity = 'MEDIUM';
  let suggestedReason = 'Violation of community guidelines.';
  let rationale = 'Standard community infraction review.';

  // Heuristic violation classification
  if (text.includes('token') || text.includes('discord.gift') || text.includes('nitro') || text.includes('free crypto')) {
    category = 'MALICIOUS_LINK_OR_SCAM';
    severity = 'HIGH';
    suggestedReason = 'Suspicious or malicious link distribution.';
    rationale = 'High-risk security violation threatening member safety.';
  } else if (text.includes('buy now') || text.includes('join my server') || text.includes('discord.gg/')) {
    category = 'UNAUTHORIZED_PROMOTION';
    severity = 'MEDIUM';
    suggestedReason = 'Unsolicited self-promotion / unauthorized invite link.';
    rationale = 'Self-promotion outside of designated showcase areas.';
  } else if (text.includes('spam') || text.includes('raid') || text.includes('flood')) {
    category = 'SPAM_OR_FLOODING';
    severity = 'MEDIUM';
    suggestedReason = 'Excessive message flooding or repetitive spam.';
    rationale = 'Disruption of active community channels.';
  } else if (text.includes('hate') || text.includes('harass') || text.includes('threat')) {
    category = 'HARASSMENT_OR_INCIVILITY';
    severity = 'HIGH';
    suggestedReason = 'Harassment or uncivil behavior toward community members.';
    rationale = 'Direct breach of community safety standards.';
  } else {
    severity = strikes > 0 ? 'MEDIUM' : 'LOW';
    suggestedReason = context.reportedCategory || 'General guideline violation.';
    rationale = 'General infraction assessed against user history.';
  }

  // Recommended action mapped strictly against the 3-strike escalation baseline
  let recommendedAction: 'WARN' | 'STRIKE' | 'TIMEOUT' | 'BAN' = 'WARN';
  if (severity === 'HIGH' || strikes >= 2) {
    recommendedAction = strikes >= 2 ? 'BAN' : 'TIMEOUT';
  } else if (strikes === 1) {
    recommendedAction = 'TIMEOUT';
  } else {
    recommendedAction = 'WARN';
  }

  return {
    violationCategory: category,
    recommendedSeverity: severity,
    recommendedAction,
    suggestedReason,
    rationale: `${rationale} (Active strike count: ${strikes})`,
    isAdvisoryOnly: true,
  };
}
