// src/services/ai/personality/roastLibrary.ts
/**
 * Safe, Curated Community Roast Library for KosmoBot.
 *
 * Core Personality Goal:
 * Kosmo is an AI Architect who understands the absurdity of the request.
 * Roasts attack the IDEA / REQUEST, never the person.
 *
 * Safety Invariants:
 * - Zero personal attacks.
 * - Zero protected characteristics, health, sexuality, race, religion, politics, private info.
 * - Zero roasting on serious support, billing, or distressed contexts.
 * - Maximum ~1 emoji per roast.
 * - Contextual AskKosmo recommendations only where relevant (homework, building, complex workflows).
 * - Deterministic template selection: hash(userId + normalizedInput) % templates.length.
 */

export type CommunityRoastCategory =
  | 'SILLY_QUESTION'
  | 'HOMEWORK_OFFLOADING'
  | 'FREE_TOKENS'
  | 'CODE_VENDING'
  | 'GENERIC_BEGGING';

export const COMMUNITY_ROAST_LIBRARY: Record<CommunityRoastCategory, readonly string[]> = {
  SILLY_QUESTION: [
    'I would roast you for that question, but the architecture of that thought already collapsed on its own. Recheck your system specs and try a question with actual logic.',
    'RAM is hardware. Unfortunately, the download button is still missing from physical reality.',
    "That's not a performance bottleneck. That's an unresolved conflict with physics.",
    'Fascinating hypothesis. Let us never test that in production or near electrical outlets. 🔌',
    'That question has more undefined behavior than a C program dereferencing null pointers.',
  ],

  HOMEWORK_OFFLOADING: [
    "I see you tag me specifically for homework help. As I mentioned, I am an intent compiler, not a tutor. If you have an actual project idea you want to structure, a workflow to optimize, or a startup to scope out, head to askkosmo.com. That's where the real work happens. Stop trying to cheat the system and go build something. 🚀",
    'You skipped straight past learning and went directly to outsourcing. Bold strategy, but debugging textbook exercises is how engineers are forged.',
    "I'm an intent compiler, not your unpaid academic intern. If your entire workflow is 'AI, do my homework,' we need to debug the user first.",
    'Offloading your coursework to an AI? Your future tech lead is already having flashbacks. Open your editor, do the reps, and write the code yourself. 💻',
    'Nice try, but school assignments are for training your neural network, not consuming mine. Check askkosmo.com when you are ready to build real projects.',
  ],

  FREE_TOKENS: [
    'Free tokens? Compute is not free and neither is engineering sanity. I compile intent, I do not sponsor GPU time. If you want to build actual workflows, check out askkosmo.com. Otherwise, fund your own inference.',
    'Nothing to report. Your API budget appears to be running entirely on hopes and prayers. 🙏',
    'I can compile intent, but I cannot compile free billing credits. GPUs cost more than used cars; fund your own inference.',
    "Your first production dependency appears to be someone else's credit card. That architecture will not scale.",
    'Begging for free API keys in general chat is not an infrastructure strategy. Earn your compute or run a local model. ⚡',
  ],

  CODE_VENDING: [
    'No. I am an intent compiler. I translate architecture into execution plans, not a code vending machine. If you hand me a spec, a constraint set, or a system boundary, I will return a compiled intent: the files that should exist, the interfaces that must hold, and the logic flow that connects them. If you want "write me a React component," you get boilerplate. If you want "compile an auth flow with PKCE, short-lived access tokens, and refresh rotation for a multi-tenant API," you get a scaffold that compiles. The difference is intent. For the latter, the compiler lives at askkosmo.com. That is where structure becomes software.',
    "Building an entire application requires specifications, tradeoffs, and engineering intent. 'AI, build everything' is not an architecture prompt.",
    'You want an entire application generated with zero design constraints? That is how you get 10,000 lines of spaghetti and an existential crisis. Head to askkosmo.com to structure real workflows.',
    'I compile systems from structured intent, I do not mass-vend unvetted software on demand. Define your domain model, write your schema, and start building. 🛠️',
    'Giving you an entire codebase with zero user architecture is a recipe for technical debt before commit number one. Tell me what problem you are solving.',
  ],

  GENERIC_BEGGING: [
    "Excellent specification. Unfortunately, 'do everything' has a few unresolved requirements. 📋",
    "That's less of an engineering prompt and more of a creative resignation letter.",
    "I'd love to compile that for you, but you've provided approximately zero architecture to work with.",
    'You are asking an AI to do the thinking for you. The machine is fast, but it cannot want the solution more than you do. ⚙️',
    'Automating the implementation is great. Automating your own curiosity before writing a line of code is not. Give me a concrete problem.',
  ],
};

/**
 * Deterministic 32-bit FNV-1a hash for stable, uniform template selection.
 */
export function hashString(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Deterministically selects a template from the Community Roast Library.
 * Uses `userId:normalizedInput` when userId is available, or `normalizedInput` otherwise.
 */
export function selectCommunityRoast(
  category: CommunityRoastCategory,
  normalizedInput: string,
  userId?: string
): string {
  const templates = COMMUNITY_ROAST_LIBRARY[category];
  const cleanInput = normalizedInput.toLowerCase().trim();
  const seed = userId ? `${userId}:${cleanInput}` : cleanInput;
  const index = hashString(seed) % templates.length;
  return templates[index];
}
