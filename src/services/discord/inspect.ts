// src/services/discord/inspect.ts

import * as fs from 'fs';
import * as path from 'path';
import { authorize, Category, AuthContext } from './policy';
import type { DesiredState, DesiredChannel, PermissionTemplate } from '../../types/desiredState';
import type { ChannelInfo } from '../../types/audit';

// ── Types ────────────────────────────────────────────────────────────────────

/** Semantic intent classification for NL requests. */
export type NLIntent = 'READ_ONLY_INSPECT' | 'MUTATION';

/** Status of an individual property in an inspection result. */
export type InspectionStatus =
  | 'CORRECT'
  | 'MISSING'
  | 'INCORRECT'
  | 'UNKNOWN'
  | 'UNAVAILABLE'
  | 'PROTECTED'
  | 'NOT_FOUND';

/** Inspection result for a single channel. */
export interface ChannelInspectionResult {
  /** The requested channel name (as typed by user, without #). */
  channelName: string;
  /** Overall status of the channel inspection. */
  status: InspectionStatus;
  /** Whether the channel exists in the guild. */
  exists: boolean;
  /** Actual channel type (e.g. GUILD_TEXT) if found. */
  actualType?: string;
  /** Expected channel type from desired state. */
  expectedType?: string;
  /** Actual parent category name, if resolvable. */
  actualParent?: string | null;
  /** Expected parent category from desired state. */
  expectedParent?: string | null;
  /** Expected permission template name from desired state. */
  expectedPermissionTemplate?: string;
  /** Whether the channel's type matches expected. */
  typeMatch?: InspectionStatus;
  /** Whether the channel's parent matches expected. */
  parentMatch?: InspectionStatus;
  /** Whether the permission template is defined for this channel. */
  permissionTemplateDefined?: InspectionStatus;
  /** Human-readable detail messages. */
  details: string[];
}

/** Full inspection report for a multi-channel inspection request. */
export interface InspectionReport {
  /** Inspection timestamp. */
  timestamp: Date;
  /** Target channels that were inspected. */
  results: ChannelInspectionResult[];
  /** Whether desired-state configuration was available. */
  hasDesiredState: boolean;
  /** Any top-level errors (e.g. no valid targets). */
  errors: string[];
}

// ── Read-only keyword lists ──────────────────────────────────────────────────

/**
 * Keywords indicating a purely read-only intent.
 * These must appear without any mutation keywords to classify as READ_ONLY_INSPECT.
 */
const READ_ONLY_KEYWORDS = [
  'check',
  'inspect',
  'verify',
  'audit',
  'review',
  'validate',
  'compare',
  'is correct',
  'are correct',
  'is configured correctly',
  'are configured correctly',
  'is set up',
  'are set up',
  'is right',
  'are right',
  'looks correct',
  'look correct',
  'show me',
  'status of',
  'what is the state',
  'what are the settings',
];

/**
 * Keywords and regex patterns indicating mutation intent.
 * If ANY of these appear in the instruction (outside of passive state queries),
 * the request is classified as MUTATION, regardless of read-only keywords.
 */
const MUTATION_PATTERNS: (string | RegExp)[] = [
  /\bfix(?:es|ed|ing)?\b/,
  /\brepair(?:s|ed|ing)?\b/,
  /\bdelete(?:s|d|ing)?\b/,
  /\bdel\b/,
  /\bcreate(?:s|d|ing)?\b/,
  /\bremove(?:s|d|ing)?\b/,
  /\bchange(?:s|d|ing)?\b/,
  /\bupdate(?:s|d|ing)?\b/,
  /\bmodif(?:y|ies|ied|ying)\b/,
  /\bset\s*up\b/,
  /\bset\s+permissions?\b/,
  /\bset\s+it\b/,
  /\bapply\b/,
  /\bmove(?:s|d|ing)?\b/,
  /\brename(?:s|d|ing)?\b/,
  /\badd(?:s|ed|ing)?\b/,
  /\bgrant(?:s|ed|ing)?\b/,
  /\bassign(?:s|ed|ing)?\b/,
  /\brevoke(?:s|d|ing)?\b/,
  /\bconfigure(?:s|d|ing)?\b/,
  /\breconfigure(?:s|d|ing)?\b/,
  /\breset(?:s|ting)?\b/,
  /\bdestroy(?:s|ed|ing)?\b/,
  /\bnuke(?:s|d|ing)?\b/,
  /\bwipe(?:s|d|ing)?\b/,
  /\bpurge(?:s|d|ing)?\b/,
  /\bkick(?:s|ed|ing)?\b/,
  /\bban(?:s|ned|ning)?\b/,
  /\btimeout(?:s|ed|ing)?\b/,
  /\bmute(?:s|d|ing)?\b/,
  /\bmake\s+it\b/,
  /\bif\s+(?:it'?s\s+)?wrong\s+fix\b/,
  /\b(?:and|then)\s+(?:fix|repair|delete|remove)\b/,
];

// ── Protected channel patterns ───────────────────────────────────────────────

/** Known staff channel names that are off-limits for general inspection. */
const KNOWN_STAFF_CHANNELS = new Set([
  'team-chat',
  'staff-chat',
  'admin-chat',
  'mod-chat',
  'moderator-chat',
  'staff-logs',
  'mod-logs',
  'admin-logs',
  'internal',
  'staff-internal',
]);

// ── Intent Classification ────────────────────────────────────────────────────

/**
 * Classifies a natural language instruction as either READ_ONLY_INSPECT or MUTATION.
 *
 * Classification rules:
 * 1. If any mutation keyword appears → MUTATION (safe default)
 * 2. If at least one read-only keyword appears and NO mutation keywords → READ_ONLY_INSPECT
 * 3. Otherwise → MUTATION (safe default — enters existing confirmation flow)
 *
 * @param instruction Raw natural language instruction from user.
 * @returns The classified intent.
 */
export function classifyIntent(instruction: string): NLIntent {
  if (!instruction || instruction.trim().length === 0) {
    return 'MUTATION'; // safe default
  }

  const lower = instruction.toLowerCase().trim();

  // Normalize out passive/state inquiry phrases where words like "set up" or "configured"
  // are used to inquire about current state, e.g.:
  // "is set up", "are set up", "is #general set up", "is configured correctly"
  const textForMutationCheck = lower
    .replace(/\b(?:is|are|was|were)\s+(?:[a-z0-9_#-]+\s+)*set\s*up\b/g, ' ')
    .replace(/\b(?:is|are|was|were)\s+(?:[a-z0-9_#-]+\s+)*configured\b/g, ' ');

  // Check for mutation keywords first — any match overrides read-only
  for (const pattern of MUTATION_PATTERNS) {
    if (typeof pattern === 'string') {
      if (textForMutationCheck.includes(pattern)) {
        return 'MUTATION';
      }
    } else if (pattern.test(textForMutationCheck)) {
      return 'MUTATION';
    }
  }

  // Check for read-only keywords
  for (const keyword of READ_ONLY_KEYWORDS) {
    if (lower.includes(keyword)) {
      return 'READ_ONLY_INSPECT';
    }
  }

  // No recognized intent → safe default
  return 'MUTATION';
}

// ── Channel Target Extraction ────────────────────────────────────────────────

/**
 * Extracts channel name targets from a natural language instruction.
 *
 * Supports:
 * - #channel-name mentions (strips the #)
 * - Bare channel names after read-only verbs
 * - Multiple targets separated by commas, "and", or spaces
 *
 * @param instruction Raw natural language instruction.
 * @returns Array of deduplicated channel name strings (without # prefix).
 */
export function extractChannelTargets(instruction: string): string[] {
  if (!instruction || instruction.trim().length === 0) {
    return [];
  }

  const targets: Set<string> = new Set();

  // 1. Extract #channel-name mentions
  const hashMentions = instruction.match(/#[a-z0-9_-]+/gi);
  if (hashMentions) {
    for (const mention of hashMentions) {
      const cleaned = mention.slice(1).trim().toLowerCase();
      if (cleaned.length > 0) {
        targets.add(cleaned);
      }
    }
  }

  // 2. Extract bare channel names from quoted references
  const quotedRefs = instruction.match(/["']([a-z0-9_-]+)["']/gi);
  if (quotedRefs) {
    for (const ref of quotedRefs) {
      const cleaned = ref.replace(/["']/g, '').trim().toLowerCase();
      if (cleaned.length > 0) {
        targets.add(cleaned);
      }
    }
  }

  return Array.from(targets);
}

// ── Protected Channel Detection ──────────────────────────────────────────────

/**
 * Determines if a channel name refers to a protected/private channel
 * that should not be inspected through the general NL inspection path.
 *
 * Protected channels:
 * - Ticket channels: ticket-*
 * - AI channels: ai-*, kosmo-ai-*, private-ai-*
 * - Staff/internal channels: team-chat, staff-chat, etc.
 *
 * @param channelName The channel name (without # prefix) to check.
 * @returns true if the channel is protected and should not be inspected.
 */
export function isProtectedChannel(channelName: string): boolean {
  if (!channelName) return false;

  const lower = channelName.toLowerCase().trim();

  // Ticket channels
  if (lower.startsWith('ticket-')) {
    return true;
  }

  // AI channels
  if (lower.startsWith('ai-') || lower.startsWith('kosmo-ai-') || lower.startsWith('private-ai-')) {
    return true;
  }

  // Known staff channels
  if (KNOWN_STAFF_CHANNELS.has(lower)) {
    return true;
  }

  return false;
}

// ── Desired State Loading ────────────────────────────────────────────────────

/**
 * Loads the desired state configuration from the filesystem.
 * Returns null if not found or unparseable.
 */
export function loadDesiredState(): DesiredState | null {
  const candidatePaths = [
    path.resolve(__dirname, '../../config/desiredState.json'),
    path.resolve(__dirname, '../../../src/config/desiredState.json'),
    path.resolve(process.cwd(), 'src/config/desiredState.json'),
  ];

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      try {
        const raw = fs.readFileSync(candidate, { encoding: 'utf-8' });
        return JSON.parse(raw) as DesiredState;
      } catch {
        continue;
      }
    }
  }

  return null;
}

// ── Channel Inspection ───────────────────────────────────────────────────────

/**
 * Minimal channel interface for channel inspection.
 */
export interface InspectableChannel {
  name?: string | null;
  type?: unknown;
  parent?: { name?: string | null } | null;
}

/**
 * Minimal guild interface for channel inspection.
 * Allows the service to accept both real Guild objects and test mocks.
 */
export interface InspectableGuild {
  channels: {
    cache: {
      find: (fn: (ch: InspectableChannel) => boolean) => InspectableChannel | undefined;
      get?: (id: string) => InspectableChannel | undefined;
    };
  };
}

/**
 * Inspects a list of channels against the guild state and desired-state configuration.
 *
 * This is a strictly read-only operation. It never creates, deletes, modifies,
 * or mutates any Discord resource.
 *
 * @param guild The Discord guild (or mock) to inspect.
 * @param channelNames Array of channel names to inspect.
 * @param desiredState Optional desired-state configuration for comparison.
 * @returns An InspectionReport with per-channel results.
 */
export function inspectChannels(
  guild: InspectableGuild,
  channelNames: string[],
  desiredState?: DesiredState | null
): InspectionReport {
  const report: InspectionReport = {
    timestamp: new Date(),
    results: [],
    hasDesiredState: !!desiredState,
    errors: [],
  };

  if (!channelNames || channelNames.length === 0) {
    report.errors.push('No channel targets specified for inspection.');
    return report;
  }

  // Build desired state lookup maps
  const desiredChannelMap = new Map<string, DesiredChannel>();
  const desiredTemplateMap = new Map<string, PermissionTemplate>();

  if (desiredState) {
    for (const dc of desiredState.channels || []) {
      desiredChannelMap.set(dc.name.toLowerCase(), dc);
    }
    for (const pt of desiredState.permissionTemplates || []) {
      desiredTemplateMap.set(pt.name, pt);
    }
  }

  for (const channelName of channelNames) {
    const cleanName = channelName.toLowerCase().trim();

    // 1. Protected channel check
    if (isProtectedChannel(cleanName)) {
      report.results.push({
        channelName: cleanName,
        status: 'PROTECTED',
        exists: false, // We refuse to disclose
        details: [`🔒 Channel "${cleanName}" is a protected channel (ticket/AI/staff) and cannot be inspected through this interface.`],
      });
      continue;
    }

    // 2. Find channel in guild
    const guildChannel = guild.channels.cache.find(
      (ch: InspectableChannel) => (ch.name || '').toLowerCase() === cleanName
    );

    if (!guildChannel) {
      // Check if desired state defines it
      const desiredDef = desiredChannelMap.get(cleanName);
      const result: ChannelInspectionResult = {
        channelName: cleanName,
        status: 'NOT_FOUND',
        exists: false,
        details: [`Channel "${cleanName}" was not found in the guild.`],
      };
      if (desiredDef) {
        result.details.push(`Desired state defines this channel as type "${desiredDef.type}" under parent "${desiredDef.parent || '(top-level)'}".`);
        result.status = 'MISSING';
      }
      report.results.push(result);
      continue;
    }

    // 3. Channel exists — compare against desired state
    const result: ChannelInspectionResult = {
      channelName: cleanName,
      status: 'CORRECT',
      exists: true,
      actualType: String(guildChannel.type ?? ''),
      details: [],
    };

    // Resolve parent category name
    if (guildChannel.parent) {
      result.actualParent = guildChannel.parent.name || null;
    } else {
      result.actualParent = null;
    }

    const desiredDef = desiredChannelMap.get(cleanName);

    if (!desiredDef) {
      // Channel exists but no desired state definition
      result.details.push(`✅ Channel exists in guild.`);
      result.details.push(`❓ No authoritative desired-state rule exists for this channel.`);
      result.typeMatch = 'UNKNOWN';
      result.parentMatch = 'UNKNOWN';
      result.permissionTemplateDefined = 'UNKNOWN';
      result.status = 'UNKNOWN';
      report.results.push(result);
      continue;
    }

    // Type comparison
    result.expectedType = desiredDef.type;
    const actualTypeStr = normalizeChannelType(result.actualType);
    if (actualTypeStr === desiredDef.type) {
      result.typeMatch = 'CORRECT';
      result.details.push(`✅ Channel type: ${desiredDef.type}`);
    } else {
      result.typeMatch = 'INCORRECT';
      result.details.push(`⚠️ Channel type mismatch: expected "${desiredDef.type}", actual "${actualTypeStr}"`);
      result.status = 'INCORRECT';
    }

    // Parent category comparison
    result.expectedParent = desiredDef.parent || null;
    if (desiredDef.parent) {
      if (result.actualParent && result.actualParent.toLowerCase() === desiredDef.parent.toLowerCase()) {
        result.parentMatch = 'CORRECT';
        result.details.push(`✅ Parent category: "${desiredDef.parent}"`);
      } else if (result.actualParent) {
        result.parentMatch = 'INCORRECT';
        result.details.push(`⚠️ Parent mismatch: expected "${desiredDef.parent}", actual "${result.actualParent}"`);
        result.status = 'INCORRECT';
      } else {
        result.parentMatch = 'INCORRECT';
        result.details.push(`⚠️ Parent mismatch: expected "${desiredDef.parent}", actual: (top-level / none)`);
        result.status = 'INCORRECT';
      }
    } else {
      // Desired state says top-level
      if (!result.actualParent) {
        result.parentMatch = 'CORRECT';
        result.details.push(`✅ Top-level channel (no parent category)`);
      } else {
        result.parentMatch = 'INCORRECT';
        result.details.push(`⚠️ Expected top-level, but has parent "${result.actualParent}"`);
        result.status = 'INCORRECT';
      }
    }

    // Permission template
    if (desiredDef.permissionTemplate) {
      result.expectedPermissionTemplate = desiredDef.permissionTemplate;
      const template = desiredTemplateMap.get(desiredDef.permissionTemplate);
      if (template) {
        result.permissionTemplateDefined = 'CORRECT';
        result.details.push(`✅ Permission template defined: "${desiredDef.permissionTemplate}"`);
      } else {
        result.permissionTemplateDefined = 'UNKNOWN';
        result.details.push(`❓ Permission template "${desiredDef.permissionTemplate}" referenced but not found in desired state.`);
      }
    } else {
      result.permissionTemplateDefined = 'UNKNOWN';
      result.details.push(`❓ No permission template defined in desired state for this channel.`);
    }

    report.results.push(result);
  }

  return report;
}

// ── Report Formatting ────────────────────────────────────────────────────────

/**
 * Formats an InspectionReport into a human-readable string for Discord embed.
 *
 * @param report The inspection report to format.
 * @returns Formatted string with status indicators.
 */
export function formatInspectionReport(report: InspectionReport): string {
  const lines: string[] = [];
  lines.push('**🔍 Read-Only Channel Inspection Report**\n');

  if (report.errors.length > 0) {
    for (const error of report.errors) {
      lines.push(`❌ ${error}`);
    }
    return lines.join('\n');
  }

  if (!report.hasDesiredState) {
    lines.push('⚠️ No desired-state configuration found. Reporting channel existence only.\n');
  }

  for (const result of report.results) {
    const statusIcon = getStatusIcon(result.status);
    lines.push(`${statusIcon} **#${result.channelName}**`);

    for (const detail of result.details) {
      lines.push(`  ${detail}`);
    }

    lines.push(''); // blank line between channels
  }

  lines.push('*No changes were made. This was a read-only inspection.*');
  return lines.join('\n');
}

// ── Authorization ────────────────────────────────────────────────────────────

/**
 * Authorizes a user for read-only inspection using the existing AUDIT policy category.
 *
 * @param userRoleIds Array of Discord role IDs the user possesses.
 * @param context Auth context with userId and guildOwnerId.
 * @returns true if authorized, false otherwise.
 */
export function authorizeInspection(
  userRoleIds: string[],
  context?: AuthContext
): boolean {
  const decision = authorize(userRoleIds, Category.AUDIT, context);
  return decision === 'ALLOW';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getStatusIcon(status: InspectionStatus): string {
  switch (status) {
    case 'CORRECT':
      return '✅';
    case 'MISSING':
      return '❌';
    case 'INCORRECT':
      return '⚠️';
    case 'UNKNOWN':
      return '❓';
    case 'UNAVAILABLE':
      return '🚫';
    case 'PROTECTED':
      return '🔒';
    case 'NOT_FOUND':
      return '❌';
    default:
      return '❓';
  }
}

/**
 * Normalizes a Discord channel type value to the desired-state type string.
 * Discord.js uses numeric enums (0 = GUILD_TEXT, 2 = GUILD_VOICE, 4 = GUILD_CATEGORY)
 * while desiredState.json uses string types.
 */
function normalizeChannelType(typeValue: string | undefined): string {
  if (!typeValue) return 'UNKNOWN';

  // If already in desired-state format
  if (['GUILD_TEXT', 'GUILD_VOICE', 'GUILD_CATEGORY'].includes(typeValue)) {
    return typeValue;
  }

  // Discord.js numeric enum mapping
  switch (typeValue) {
    case '0':
      return 'GUILD_TEXT';
    case '2':
      return 'GUILD_VOICE';
    case '4':
      return 'GUILD_CATEGORY';
    case '5':
      return 'GUILD_TEXT'; // Announcement channels are text-like
    case '13':
      return 'GUILD_TEXT'; // Stage channels
    default:
      return typeValue;
  }
}
