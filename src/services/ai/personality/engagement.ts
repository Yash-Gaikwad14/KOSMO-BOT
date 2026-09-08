// src/services/ai/personality/engagement.ts
/**
 * Contextual Community Engagement and Natural AskKosmo Promotion.
 *
 * Directs users to askkosmo.com only when genuinely relevant:
 * - User is struggling to formulate complex AI prompts/workflows.
 * - User requests large-scale AI web workflows suited for the Kosmo web platform.
 *
 * Strict Guardrails:
 * - Never promotes in operational, moderation, billing, support, error, or confirmation flows.
 * - Never adds promotional links to repetitive responses.
 * - Never uses em dashes.
 */

import { PersonalityConfig, getPersonalityConfig } from '../../../config/personality';

export const ASKKOSMO_PROMOTION_TAG =
  '\n\n*(For multi-step AI orchestration and full-stack workflow builders, check out https://askkosmo.com)*';

const RELEVANT_ASKKOSMO_PATTERNS = [
  /\b(how\s+do\s+i\s+build|how\s+to\s+build)\s+(an?\s+)?ai\s+(app|agent|workflow|system)\b/i,
  /\b(prompt\s+engineering|prompt\s+optimizer|system\s+prompt\s+designer)\b/i,
  /\b(complex\s+ai\s+pipeline|multi-?agent\s+orchestration|automate\s+my\s+workflow)\b/i,
  /\b(where\s+can\s+i\s+run|web\s+interface\s+for)\s+kosmo\b/i,
  /\b(full-?stack\s+ai\s+platform|askkosmo)\b/i,
];

const OPERATIONAL_OR_SYSTEM_PATTERNS = [
  /\b(ban|kick|timeout|warn|strike|mute|unban)\b/i,
  /\b(role|channel|permission|guild|config)\b/i,
  /\b(ticket|support|invoice|payment|billing|stripe|refund)\b/i,
  /\b(error|failed|rejected|denied|blocked)\b/i,
  /\b(confirm|cancel|execution|plan\s+approved)\b/i,
];

/**
 * Determines whether AskKosmo promotion is appropriate for the given context.
 */
export function shouldPromoteAskKosmo(
  userMessage: string,
  isOperationalOrSystem: boolean = false,
  cfg?: PersonalityConfig
): boolean {
  const config = cfg || getPersonalityConfig();
  if (!config.enabled) return false;

  // Never promote on operational, moderation, billing, support, or confirmation responses
  if (isOperationalOrSystem) return false;

  if (!userMessage || userMessage.trim().length === 0) return false;

  // Check if message mentions operational/system actions
  if (OPERATIONAL_OR_SYSTEM_PATTERNS.some((p) => p.test(userMessage))) {
    return false;
  }

  // Check for genuine relevance to AskKosmo
  return RELEVANT_ASKKOSMO_PATTERNS.some((p) => p.test(userMessage));
}

/**
 * Optionally appends the AskKosmo promotion note if the conversational context warrants it.
 */
export function maybePromoteAskKosmo(
  userMessage: string,
  botResponse: string,
  cfg?: PersonalityConfig,
  isOperationalOrSystem: boolean = false
): string {
  if (!botResponse) return '';

  if (botResponse.includes('askkosmo.com')) {
    return botResponse; // Already contains mention, avoid duplicate promotion
  }

  if (shouldPromoteAskKosmo(userMessage, isOperationalOrSystem, cfg)) {
    return `${botResponse.trim()}${ASKKOSMO_PROMOTION_TAG}`;
  }

  return botResponse;
}
