// src/services/ai/personality/roastPolicy.ts
/**
 * Safe, Curated Roast Policy for KosmoBot.
 *
 * Strictly adheres to safety constraints:
 * - Never roasts protected characteristics, health, medical info, or personal vulnerabilities.
 * - Never roasts in billing, payment, subscription, or genuine support contexts.
 * - Immediately halts if the user asks to stop.
 * - Uses a static set of safe, witty engineering-focused templates for v1.
 */

import { PersonalityConfig, getPersonalityConfig } from '../../../config/personality';

export type RoastCategory = 'EXPLICIT_REQUEST' | 'HOMEWORK' | 'FREE_TOKENS' | 'SILLY_QUESTION' | 'GENERAL';

export interface RoastDecision {
  shouldRoast: boolean;
  category?: RoastCategory;
  reason?: string;
  template?: string;
}

export const SAFE_ROAST_TEMPLATES: Record<RoastCategory, string[]> = {
  EXPLICIT_REQUEST: [
    "You came to Discord looking for validation and ended up asking a bot to hurt your feelings. That is a bold workflow.",
    "I would roast you, but reading your commit history is probably doing that for you every single day.",
    "Asking an AI to roast you is peak idle compute behavior. Go push some code.",
  ],
  HOMEWORK: [
    "Nice try, but I am an engineering infrastructure entity, not your homework shortcut. Open your editor and do the reps.",
    "Offloading your school assignment to an AI? Your future tech lead is already weeping. Build it yourself.",
    "I do not solve textbook exercises on demand. Debugging the problem yourself builds character.",
  ],
  FREE_TOKENS: [
    "Free tokens? Compute is not free and neither is engineering sanity. Check the documentation or earn your keep.",
    "If free tokens grew on trees, GPUs would not cost more than a used car. Fund your own inference.",
    "Begging for free API keys in general chat is not an architectural strategy.",
  ],
  SILLY_QUESTION: [
    "I would roast you for that question, but the architecture of that thought already collapsed on its own.",
    "That question has more undefined behavior than a C program with uninitialized pointers.",
    "Fascinating hypothesis. Let us never test it in production.",
  ],
  GENERAL: [
    "Bold strategy. Let us see if the implementation catches up with the ambition before the next sprint.",
    "Confidence is high, test coverage is clearly zero.",
    "That is certainly one way to configure a system, assuming your goal is maximum downtime.",
  ],
};

const STOP_ROASTING_PATTERNS = [
  /\bstop\s+roast/i,
  /\bstop\s+teasing/i,
  /\bno\s+more\s+roast/i,
  /\bdon'?t\s+roast/i,
  /\bplease\s+stop\b/i,
];

const SENSITIVE_PROHIBITED_PATTERNS = [
  /\b(race|racist|ethnicity|religion|jew|muslim|christian|hindu|atheist)\b/i,
  /\b(gay|lesbian|trans|lgbt|queer|gender|sexual)\b/i,
  /\b(depress|suicid|mental\s+health|therapy|bipolar|adhd|autism|cancer|illness|hospital|medical|doctor)\b/i,
  /\b(billing|refund|invoice|credit\s+card|stripe|chargeback|subscription\s+cancel|paid\s+for)\b/i,
  /\b(ticket|support\s+agent|emergency|breach|exploit|incident|outage)\b/i,
];

const EXPLICIT_ROAST_PATTERNS = [
  /\broast\s+me\b/i,
  /\bgive\s+me\s+a\s+roast\b/i,
  /\broast\s+this\b/i,
  /\bcan\s+you\s+roast\b/i,
  /\bhit\s+me\s+with\s+a\s+roast\b/i,
];

const HOMEWORK_PATTERNS = [
  /\b(do|solve|write|finish)\s+(my\s+)?(homework|assignment|exam|quiz|school\s+project|essay)\b/i,
  /\bhomework\s+help\b/i,
];

const FREE_TOKEN_PATTERNS = [
  /\b(free\s+tokens?|free\s+api\s*keys?|free\s+credits?|give\s+me\s+tokens?|free\s+tier\s+bypass)\b/i,
  /\bgive\s+me\s+free\s+(credits?|tokens?|keys?)\b/i,
];

const SILLY_QUESTION_PATTERNS = [
  /\bdownload(ing)?\s+(more\s+)?ram\b/i,
  /\bis\s+javascript\s+a\s+database\b/i,
  /\brun\s+(kosmo|linux|doom)\s+on\s+a\s+toaster\b/i,
  /\bdelete\s+system32\b/i,
  /\brm\s+-rf\s+\/\b/i,
];

/**
 * Checks whether roasting is strictly prohibited for the given message content.
 */
export function isRoastProhibited(message: string): boolean {
  if (!message || message.trim().length === 0) return true;

  // Check if the user asks to stop
  for (const pattern of STOP_ROASTING_PATTERNS) {
    if (pattern.test(message)) return true;
  }

  // Check for protected/sensitive attributes or support/billing contexts
  for (const pattern of SENSITIVE_PROHIBITED_PATTERNS) {
    if (pattern.test(message)) return true;
  }

  return false;
}

/**
 * Evaluates whether KosmoBot should playfully roast the user and provides a safe template.
 */
export function shouldRoast(message: string, cfg?: PersonalityConfig): RoastDecision {
  const config = cfg || getPersonalityConfig();

  if (!config.enabled || !config.roastEnabled) {
    return { shouldRoast: false, reason: 'Roasting is disabled by configuration.' };
  }

  if (isRoastProhibited(message)) {
    return { shouldRoast: false, reason: 'Message matches prohibited safety/support boundary.' };
  }

  // 1. Explicit request to be roasted
  if (EXPLICIT_ROAST_PATTERNS.some((p) => p.test(message))) {
    const templates = SAFE_ROAST_TEMPLATES.EXPLICIT_REQUEST;
    return {
      shouldRoast: true,
      category: 'EXPLICIT_REQUEST',
      template: templates[0],
    };
  }

  // 2. Homework / assignment dumping
  if (HOMEWORK_PATTERNS.some((p) => p.test(message))) {
    const templates = SAFE_ROAST_TEMPLATES.HOMEWORK;
    return {
      shouldRoast: true,
      category: 'HOMEWORK',
      template: templates[0],
    };
  }

  // 3. Begging for free tokens / API keys
  if (FREE_TOKEN_PATTERNS.some((p) => p.test(message))) {
    const templates = SAFE_ROAST_TEMPLATES.FREE_TOKENS;
    return {
      shouldRoast: true,
      category: 'FREE_TOKENS',
      template: templates[0],
    };
  }

  // 4. Obviously silly questions
  if (SILLY_QUESTION_PATTERNS.some((p) => p.test(message))) {
    const templates = SAFE_ROAST_TEMPLATES.SILLY_QUESTION;
    return {
      shouldRoast: true,
      category: 'SILLY_QUESTION',
      template: templates[0],
    };
  }

  return { shouldRoast: false };
}
