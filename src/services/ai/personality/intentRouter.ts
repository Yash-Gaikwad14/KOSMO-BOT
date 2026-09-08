// src/services/ai/personality/intentRouter.ts
/**
 * Intent-Based Router for KosmoBot Conversational Interactions.
 *
 * KosmoBot is an Intent Compiler, not a generic chatbot or homework tutor.
 * When mentioned, KosmoBot understands the user's intent and decides how to respond:
 *
 * - Homework/offloading -> sharp but playful roast + redirect toward building/askkosmo.com.
 * - Silly questions -> playful roast where appropriate.
 * - Free API-token begging -> playful roast + appropriate redirect.
 * - Genuine technical questions -> intelligent, useful answer (no customer-service fluff).
 * - Genuine project/workflow/startup queries -> helpful advice + contextual AskKosmo recommendation.
 * - Serious support, billing, account issues -> serious response, strictly zero roasting.
 * - Moderation or Discord action requests -> routes to existing authorization/safety/planning pipeline.
 */

import { selectCommunityRoast } from './roastLibrary';

export type UserIntent =
  | 'DISCORD_ACTION'
  | 'SERIOUS_SUPPORT'
  | 'HOMEWORK_OFFLOADING'
  | 'FREE_TOKENS'
  | 'SILLY_QUESTION'
  | 'CODE_VENDING'
  | 'GENERIC_BEGGING'
  | 'GENUINE_PROJECT'
  | 'GENUINE_TECHNICAL';

export interface IntentDecision {
  intent: UserIntent;
  responseStyle: 'ACTION_PIPELINE' | 'SERIOUS' | 'ROAST_AND_REDIRECT' | 'ROAST' | 'INTELLIGENT_ANSWER' | 'PROJECT_GUIDANCE';
  staticResponse?: string;
  systemPromptModifier?: string;
}

const ACTION_PATTERNS = [
  /\b(create|make|add|setup|set\s+up)\s+(a\s+)?(channel|role|category)\b/i,
  /\b(assign|give|remove|take)\s+(the\s+)?role\b/i,
  /\b(delete|remove)\s+(the\s+)?(channel|role|category)\b/i,
  /\b(role-?gate|permission\s+template|overwrite\s+permissions?)\b/i,
  /\b(ban|kick|timeout|mute|warn|strike)\s+<@!?\d+>/i,
  /\b(audit\s+(server|channels|roles|guild))\b/i,
  /\b(inspect\s+channel)\b/i,
];

const SUPPORT_PATTERNS = [
  // Payments, charges, and transactions
  /\b(payment|transaction|checkout|charge)\s*(failed|fail|failing|error|declined|declining|issue|problem|stuck|help)\b/i,
  /\b(my\s+payment\s+failed|payment\s+didn'?t\s+go\s+through|payment\s+not\s+working)\b/i,
  /\b(was\s+charged|charged\s+me|double\s+charged|overcharged|unauthorized\s+charge)\b/i,
  /\b(charged\s+but|paid\s+but)\b/i,
  /\b(need\s+help|help\s+with)\s+.*(payment|billing|subscription|account|charge|invoice)\b/i,

  // Billing, refunds, invoices, stripe, and subscriptions
  /\b(refund|chargeback|disputed\s+charge|paid\s+for\s+(pro|premium|subscription))\b/i,
  /\bbilling\s*(issue|problem|error|trouble|dispute|question|help|support)\b/i,
  /\bsubscription\s*(issue|problem|error|trouble|cancel|status|active|tier|help|renew)\b/i,
  /\b(credit\s*card|stripe)\s*(failed|declined|error|charge|issue|trouble)\b/i,
  /\b(pro|premium)\s*(isn'?t|not)\s*(active|working|applied|showing|received)\b/i,

  // Technical outages, security incidents, critical bugs
  /\b(outage|production\s+down|critical\s+bug|security\s+incident|breach|compromised)\b/i,

  // Formal support tickets and human agent requests
  /\b(support\s+ticket|open\s+a\s+ticket|contact\s+support|agent\s+help|human\s+support|talk\s+to\s+support)\b/i,

  // Personal vulnerability / crisis / mental health
  /\b(depress|suicid|mental\s+health|crisis|therapy)\b/i,
];

const HOMEWORK_PATTERNS = [
  /\b(write|do|solve|finish|help\s+with)\s+(all(\s+of)?\s+)?(my\s+)?(homework|assignment|coursework|exam|quiz|school\s+essay|take-?home|college\s+report)\b/i,
  /\b(do|write)\s+(all\s+)?my\s+(homework|assignment|essay|lab\s*report)\b/i,
  /\bhomework\s+help\b/i,
  /\b(solve|finish)\s+my\s+(entire\s+)?(homework|assignment|coursework)\b/i,
  /\bwrite\s+my\s+(essay|assignment|college\s+report)\b/i,
];

const FREE_TOKEN_PATTERNS = [
  /\b(free\s+api\s*tokens?|free\s+api\s*keys?|free\s+credits?|free\s+tokens?|free\s+tier\s+bypass)\b/i,
  /\bgive\s+me\s+(an?\s+)?(free\s+)?(api\s*tokens?|openai\s*(api\s*)?keys?|gemini\s*(api\s*)?keys?|claude\s*(api\s*)?keys?|tokens?|credits?)\b/i,
  /\b(give\s+me|want|need)\s+(an?\s+)?(openai|gemini|claude|gpt-?4|anthropic)\s*(api\s*)?keys?\b/i,
  /\bfree\s+(claude|openai|gemini|gpt-?4|anthropic)\s*(api|tokens?|keys?)\b/i,
  /\bcan\s+i\s+have\s+free\s+(tokens?|api\s*keys?|credits?)\b/i,
];

const SILLY_PATTERNS = [
  /\bdownload(ing)?\s+(more\s+)?ram\b/i,
  /\bis\s+javascript\s+a\s+database\b/i,
  /\brun\s+(kosmo|linux|doom)\s+on\s+a\s+toaster\b/i,
  /\bdelete\s+system32\b/i,
  /\brm\s+-rf\s+\/\b/i,
  /\b(make\s+(my\s+)?(pc|laptop|computer)\s+faster\s+by\s+deleting\s+system32)\b/i,
  /\b(fix|debug)\s+(my\s+)?(broken\s+)?code\s+without\s+(showing|seeing|giving|providing)\s+(it|the\s+code)\b/i,
  /\bcan\s+ai\s+fix\s+(my\s+)?(broken\s+)?code\s+if\s+i\s+don'?t\s+show\b/i,
];

const CODE_VENDING_PATTERNS = [
  /\b(write|generate|build|code|make|create)\s+(all(\s+of)?|the\s+entire|my\s+entire|the\s+whole|my\s+whole)\s+(my\s+)?(code|app|application|project|website|backend|frontend|system|software)(\s+for\s+me)?\b/i,
  /\b(can\s+you\s+)?(write|do|code)\s+all\s+(my\s+)?code(\s+for\s+me)?\b/i,
  /\b(build|make|create)\s+(me\s+)?(a\s+|an\s+)?(entire|whole|complete)\s+(app|application|project|website|saas)(\s+from\s+scratch)?\s*(for\s+me)?\b/i,
  /\b(can\s+you\s+)?write\s+my\s+(entire|whole)\s+(app|code|project|website)\b/i,
];

const GENERIC_BEGGING_PATTERNS = [
  /\b(do|build|solve)\s+everything\s+for\s+me\b/i,
  /\bjust\s+(give|tell)\s+me\s+the\s+(entire\s+)?answer\b/i,
  /\b(i\s+don'?t\s+want\s+to\s+think|think\s+for\s+me)\b/i,
  /\bmake\s+it\s+(all\s+)?perfect(\s+for\s+me)?\b/i,
  /\bjust\s+do\s+all\s+the\s+work(\s+for\s+me)?\b/i,
  /\bdo\s+my\s+thinking\b/i,
];

const PROJECT_PATTERNS = [
  /\b(project\s+idea|structure\s+a\s+workflow|optimize\s+a\s+workflow|scope\s+out\s+a\s+startup|startup\s+idea)\b/i,
  /\b(build|architect)\s+(an?\s+)?(ai\s+workflow|ai\s+pipeline|multi-?agent|ai\s+app)\b/i,
  /\b(how\s+to\s+use|tell\s+me\s+about)\s+askkosmo\b/i,
  /\b(complex\s+ai\s+orchestration|intent\s+compiler)\b/i,
];

/**
 * Classifies the semantic intent of the user message and determines the appropriate response style.
 * Uses deterministic template selection from the Community Roast Library.
 */
export function classifyUserIntent(message: string, userId?: string): IntentDecision {
  const text = message.trim();

  // 1. Check for Discord Action or Moderation Mutation requests
  if (ACTION_PATTERNS.some((p) => p.test(text))) {
    return {
      intent: 'DISCORD_ACTION',
      responseStyle: 'ACTION_PIPELINE',
    };
  }

  // 2. Check for Serious Support, Billing, or Crisis requests (strictly zero roast)
  if (SUPPORT_PATTERNS.some((p) => p.test(text))) {
    return {
      intent: 'SERIOUS_SUPPORT',
      responseStyle: 'SERIOUS',
      staticResponse:
        'For billing, subscription inquiries, or formal support incidents, please open a support ticket in the designated support channel or contact the team. I do not handle financial transactions or private account data directly.',
    };
  }

  // 3. Check for Homework / Coursework Offloading
  if (HOMEWORK_PATTERNS.some((p) => p.test(text))) {
    return {
      intent: 'HOMEWORK_OFFLOADING',
      responseStyle: 'ROAST_AND_REDIRECT',
      staticResponse: selectCommunityRoast('HOMEWORK_OFFLOADING', text, userId),
    };
  }

  // 4. Check for Free Token Begging
  if (FREE_TOKEN_PATTERNS.some((p) => p.test(text))) {
    return {
      intent: 'FREE_TOKENS',
      responseStyle: 'ROAST',
      staticResponse: selectCommunityRoast('FREE_TOKENS', text, userId),
    };
  }

  // 5. Check for Silly Questions
  if (SILLY_PATTERNS.some((p) => p.test(text))) {
    return {
      intent: 'SILLY_QUESTION',
      responseStyle: 'ROAST',
      staticResponse: selectCommunityRoast('SILLY_QUESTION', text, userId),
    };
  }

  // 6. Check for Code Vending / Massive Code Request
  if (CODE_VENDING_PATTERNS.some((p) => p.test(text))) {
    return {
      intent: 'CODE_VENDING',
      responseStyle: 'ROAST',
      staticResponse: selectCommunityRoast('CODE_VENDING', text, userId),
    };
  }

  // 7. Check for Generic Low-Effort Begging
  if (GENERIC_BEGGING_PATTERNS.some((p) => p.test(text))) {
    return {
      intent: 'GENERIC_BEGGING',
      responseStyle: 'ROAST',
      staticResponse: selectCommunityRoast('GENERIC_BEGGING', text, userId),
    };
  }

  // 8. Check for Genuine Project / Startup / Workflow Queries
  if (PROJECT_PATTERNS.some((p) => p.test(text))) {
    return {
      intent: 'GENUINE_PROJECT',
      responseStyle: 'PROJECT_GUIDANCE',
      systemPromptModifier:
        'The user is asking about an actual project, startup idea, or AI workflow. Provide insightful, direct, confident engineering advice. Mention askkosmo.com naturally as the platform where full-stack workflows and intent compilation happen.',
    };
  }

  // 9. Default: Genuine Technical Question
  return {
    intent: 'GENUINE_TECHNICAL',
    responseStyle: 'INTELLIGENT_ANSWER',
    systemPromptModifier:
      'Provide an intelligent, useful, direct, concise answer in the Kosmo voice. Critique flawed assumptions constructively. Do not use generic filler. Do not append website promotions unless directly relevant.',
  };
}
