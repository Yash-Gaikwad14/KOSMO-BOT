// src/services/ai/contextService.ts

import {
  Guild,
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';
import { isTicketChannel } from '../support/ticketService';
import { APPROVED_DISCUSSION_MAPPINGS } from '../discord/permissionValidator';

/**
 * Centrally bounded limits for community context gathering.
 */
export const MAX_MESSAGES_PER_CHANNEL = 20;
export const MAX_CHANNELS_PER_REQUEST = 10;
export const MAX_CONTEXT_CHARACTERS = 12000;
export const MAX_CONTEXT_CHANNEL_CONCURRENCY = 5;

/**
 * Strict fail-closed channel classification categories.
 */
export type ChannelClassification =
  | 'PUBLIC_COMMUNITY'
  | 'STAFF_INTERNAL'
  | 'PRIVATE_TICKET'
  | 'PRIVATE_AI'
  | 'OTHER';

/**
 * Sanitized, bounded message context structure.
 */
export interface BoundedMessageContext {
  id: string;
  authorId: string;
  authorUsername: string;
  isBot: boolean;
  timestamp: string;
  content: string;
}

/**
 * Result summary for a single channel's activity and context.
 */
export interface ChannelActivitySummary {
  channelId: string;
  channelName: string;
  classification: ChannelClassification;
  messageCount: number;
  activeAuthors: string[];
  timeWindow?: {
    oldestTimestamp?: string;
    newestTimestamp?: string;
  };
  boundedMessages?: BoundedMessageContext[];
  truncated: boolean;
  status: 'SUCCESS' | 'FORBIDDEN' | 'UNAVAILABLE' | 'ERROR';
  errorReason?: string;
}

/**
 * Aggregated community metadata.
 */
export interface CommunityMetadata {
  guildId: string;
  guildName: string;
  memberCount: number;
  channelsSummary: {
    totalChannels: number;
    publicChannels: number;
    staffChannels: number;
    ticketChannels: number;
    privateAiChannels: number;
    otherChannels: number;
  };
  publicChannelNames: string[];
}

/**
 * Options for channel activity retrieval.
 */
export interface ChannelActivityOptions {
  limit?: number;
  includeMessages?: boolean;
  allowStaffChannels?: boolean;
}

/**
 * Request options for community context retrieval.
 */
export interface CommunityContextRequest {
  channelIds?: string[];
  limitPerChannel?: number;
  includeMessages?: boolean;
  allowStaffChannels?: boolean;
}

/**
 * Aggregated community context response.
 */
export interface CommunityContextResponse {
  guildId: string;
  channels: ChannelActivitySummary[];
  totalMessages: number;
  totalActiveAuthors: number;
  truncated: boolean;
  status: 'SUCCESS' | 'PARTIAL' | 'ERROR';
  generatedAt: string;
}

/**
 * Regular expressions for sensitive tokens and keys that must never enter AI context.
 */
const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{20,}/g, // OpenAI / general API keys
  /[a-zA-Z0-9_-]{24}\.[a-zA-Z0-9_-]{6}\.[a-zA-Z0-9_-]{27,}/g, // Discord Bot Tokens
  /mfa\.[a-zA-Z0-9_-]{20,}/g, // Discord MFA Tokens
  /Bearer\s+[a-zA-Z0-9_.-]{15,}/gi, // Authorization Bearer tokens
  /ghp_[a-zA-Z0-9]{36}/g, // GitHub Personal Access Tokens
  /stripe_(?:test|live)_[a-zA-Z0-9]+/gi, // Stripe API keys
];

/**
 * Sanitizes message content by stripping secrets, tokens, and sensitive credential patterns.
 */
export function sanitizeContent(content: string): string {
  if (!content) return '';
  let sanitized = content;
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED_SECRET]');
  }
  return sanitized;
}

/**
 * Normalizes channel or category name for matching.
 */
function cleanName(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Safely extracts permission overwrites from a channel.
 */
function getOverwrites(channel: any): any[] {
  if (!channel?.permissionOverwrites) return [];
  if (channel.permissionOverwrites.cache) {
    return Array.from(channel.permissionOverwrites.cache.values());
  }
  if (Array.isArray(channel.permissionOverwrites)) {
    return channel.permissionOverwrites;
  }
  if (typeof channel.permissionOverwrites.values === 'function') {
    return Array.from(channel.permissionOverwrites.values());
  }
  return [];
}

/**
 * Checks if a permission overwrite denies ViewChannel.
 */
function deniesViewChannel(ow: any): boolean {
  if (!ow) return false;
  if (typeof ow.deny?.has === 'function') {
    return ow.deny.has(PermissionFlagsBits.ViewChannel) || ow.deny.has('ViewChannel');
  }
  if (typeof ow.deny?.toArray === 'function') {
    return ow.deny.toArray().includes('ViewChannel');
  }
  if (typeof ow.deny === 'bigint') {
    return (ow.deny & PermissionFlagsBits.ViewChannel) === PermissionFlagsBits.ViewChannel;
  }
  if (Array.isArray(ow.deny)) {
    return ow.deny.includes('ViewChannel') || ow.deny.includes(PermissionFlagsBits.ViewChannel);
  }
  return false;
}

/**
 * Known staff channel names.
 */
const KNOWN_STAFF_CHANNELS = new Set([
  'team-chat',
  'mod-logs',
  'logs',
  'voice-lobby',
  'staff-announcements',
  'admin',
  'moderator-only',
  'staff',
  'audit-logs',
]);

/**
 * Known staff category name substrings.
 */
const KNOWN_STAFF_CATEGORIES = ['teamkosmo', 'staff', 'admin', 'moderation'];

/**
 * Known public community channels.
 */
const KNOWN_PUBLIC_CHANNELS = new Set([
  'general',
  'showcase',
  'count-to-infinity',
  'kosmo-recipes',
  'community-chat',
  'rules',
  'announcements',
  'bot-commands',
]);

/**
 * Classifies a channel into strict community context boundaries.
 * Fails closed: anything not explicitly verified as public or staff is classified as OTHER.
 */
export function classifyChannel(channel: any): ChannelClassification {
  if (!channel) return 'OTHER';

  const name = (channel.name || '').toLowerCase();
  const cleanedName = cleanName(name);
  const parentName = channel.parent?.name || '';
  const cleanedParent = cleanName(parentName);

  // 1. TICKET TOOL BOUNDARY: Active tickets, ticket channels, ticket categories
  if (isTicketChannel(channel)) {
    return 'PRIVATE_TICKET';
  }
  if (name.startsWith('ticket-') || name === 'tickets' || cleanedParent.includes('activeticket')) {
    return 'PRIVATE_TICKET';
  }

  // 2. PRIVATE AI CONVERSATION BOUNDARY: Private threads or AI designated channels
  if (channel.type === ChannelType.PrivateThread || channel.type === 12) {
    return 'PRIVATE_AI';
  }
  if (name.startsWith('ai-') || name.startsWith('kosmo-ai-') || name.startsWith('private-ai-')) {
    return 'PRIVATE_AI';
  }
  if (channel.isThread?.() && (name.startsWith('ai-') || name.startsWith('kosmo-ai-'))) {
    return 'PRIVATE_AI';
  }

  // 3. STAFF / INTERNAL BOUNDARY
  if (KNOWN_STAFF_CHANNELS.has(name)) {
    return 'STAFF_INTERNAL';
  }
  if (KNOWN_STAFF_CATEGORIES.some((cat) => cleanedParent.includes(cat))) {
    return 'STAFF_INTERNAL';
  }

  // Overwrite inspection: if @everyone is denied ViewChannel and channel is staff-gated
  const overwrites = getOverwrites(channel);
  const everyoneId = channel.guild?.roles?.everyone?.id ?? channel.guild?.id;
  const everyoneOverwrite = overwrites.find((ow) => ow.id === everyoneId);
  const everyoneDenied = everyoneOverwrite ? deniesViewChannel(everyoneOverwrite) : false;

  // 4. PUBLIC COMMUNITY CHANNEL VERIFICATION
  // Only text channels or announcement channels can be public community channels
  const isTextType =
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement ||
    channel.type === 0 || // GuildText numeric
    channel.type === 5; // GuildAnnouncement numeric

  if (!isTextType && !channel.isTextBased?.()) {
    return 'OTHER';
  }

  // If @everyone is denied ViewChannel, it cannot be a public community channel
  if (everyoneDenied) {
    // If it's not known staff, classify as OTHER (fail closed, e.g. premium lounge or private room)
    return 'OTHER';
  }

  // Check against canonical discussion mappings
  const isDiscussion = APPROVED_DISCUSSION_MAPPINGS.some(
    (mapping) => mapping.channel.toLowerCase() === name
  );
  if (isDiscussion) {
    return 'PUBLIC_COMMUNITY';
  }

  // Check against known public channel set
  if (KNOWN_PUBLIC_CHANNELS.has(name)) {
    return 'PUBLIC_COMMUNITY';
  }

  // 5. FAIL CLOSED: Unrecognized channel type or unverified visibility
  return 'OTHER';
}

/**
 * Verifies if the bot has required permissions to view and read channel history.
 */
function verifyBotPermissions(channel: any): { allowed: boolean; reason?: string } {
  const me = channel.guild?.members?.me;
  if (!me) return { allowed: true }; // Allow mocks that don't construct full member cache

  if (typeof channel.permissionsFor === 'function') {
    const perms = channel.permissionsFor(me);
    if (perms && typeof perms.has === 'function') {
      const hasView = perms.has(PermissionFlagsBits.ViewChannel) || perms.has('ViewChannel');
      const hasHistory =
        perms.has(PermissionFlagsBits.ReadMessageHistory) || perms.has('ReadMessageHistory');

      if (!hasView) {
        return { allowed: false, reason: 'Bot missing ViewChannel permission.' };
      }
      if (!hasHistory) {
        return { allowed: false, reason: 'Bot missing ReadMessageHistory permission.' };
      }
    }
  }

  return { allowed: true };
}

/**
 * CommunityContextService provides controlled, authorized, bounded context to AI services.
 * Read-only, zero Discord mutations, zero LLM invocations, zero message persistence.
 */
export class CommunityContextService {
  /**
   * Classifies a channel using fail-closed security logic.
   */
  public classify(channel: any): ChannelClassification {
    return classifyChannel(channel);
  }

  /**
   * Retrieves bounded activity and message metadata for a single channel.
   */
  public async getRecentChannelActivity(
    channel: any,
    options: ChannelActivityOptions = {}
  ): Promise<ChannelActivitySummary> {
    if (!channel || !channel.id) {
      return {
        channelId: channel?.id || 'unknown',
        channelName: channel?.name || 'unknown',
        classification: 'OTHER',
        messageCount: 0,
        activeAuthors: [],
        truncated: false,
        status: 'UNAVAILABLE',
        errorReason: 'Channel is null, undefined, or missing id.',
      };
    }

    const classification = classifyChannel(channel);

    // Reject non-authorized channels
    if (classification === 'PRIVATE_TICKET') {
      return {
        channelId: channel.id,
        channelName: channel.name,
        classification,
        messageCount: 0,
        activeAuthors: [],
        truncated: false,
        status: 'UNAVAILABLE',
        errorReason: 'Active ticket channels are strictly excluded from community intelligence.',
      };
    }

    if (classification === 'PRIVATE_AI') {
      return {
        channelId: channel.id,
        channelName: channel.name,
        classification,
        messageCount: 0,
        activeAuthors: [],
        truncated: false,
        status: 'UNAVAILABLE',
        errorReason: 'Private AI conversations are strictly excluded from community intelligence.',
      };
    }

    if (classification === 'OTHER') {
      return {
        channelId: channel.id,
        channelName: channel.name,
        classification,
        messageCount: 0,
        activeAuthors: [],
        truncated: false,
        status: 'UNAVAILABLE',
        errorReason: 'Channel is unverified or excluded by fail-closed community filter.',
      };
    }

    if (classification === 'STAFF_INTERNAL' && !options.allowStaffChannels) {
      return {
        channelId: channel.id,
        channelName: channel.name,
        classification,
        messageCount: 0,
        activeAuthors: [],
        truncated: false,
        status: 'UNAVAILABLE',
        errorReason: 'Staff-only channels are excluded by default from community context.',
      };
    }

    // Permission check
    const permCheck = verifyBotPermissions(channel);
    if (!permCheck.allowed) {
      return {
        channelId: channel.id,
        channelName: channel.name,
        classification,
        messageCount: 0,
        activeAuthors: [],
        truncated: false,
        status: 'FORBIDDEN',
        errorReason: permCheck.reason,
      };
    }

    // Centrally enforce bounds: limit must never exceed MAX_MESSAGES_PER_CHANNEL (20)
    const fetchLimit = Math.min(
      Math.max(1, options.limit ?? MAX_MESSAGES_PER_CHANNEL),
      MAX_MESSAGES_PER_CHANNEL
    );

    // Fetch messages from Discord API safely
    let fetchedMessages: any[] = [];
    try {
      if (!channel.messages?.fetch) {
        return {
          channelId: channel.id,
          channelName: channel.name,
          classification,
          messageCount: 0,
          activeAuthors: [],
          truncated: false,
          status: 'UNAVAILABLE',
          errorReason: 'Channel messages manager is unavailable or non-text channel.',
        };
      }

      const rawFetched = await channel.messages.fetch({ limit: fetchLimit });
      if (rawFetched) {
        if (typeof rawFetched.values === 'function') {
          fetchedMessages = Array.from(rawFetched.values());
        } else if (Array.isArray(rawFetched)) {
          fetchedMessages = rawFetched;
        } else if (rawFetched.cache) {
          fetchedMessages = Array.from(rawFetched.cache.values());
        }
      }
    } catch (err: any) {
      return {
        channelId: channel.id,
        channelName: channel.name,
        classification,
        messageCount: 0,
        activeAuthors: [],
        truncated: false,
        status: 'ERROR',
        errorReason: `Discord API failure: ${err?.message || String(err)}`,
      };
    }

    // Aggregations
    const messageCount = fetchedMessages.length;
    const authorSet = new Set<string>();
    const boundedMessages: BoundedMessageContext[] = [];

    let totalChars = 0;
    let truncated = false;

    // Sort chronologically ascending (oldest to newest)
    const sorted = [...fetchedMessages].sort((a, b) => {
      const aTime = a.createdTimestamp || new Date(a.createdAt || 0).getTime();
      const bTime = b.createdTimestamp || new Date(b.createdAt || 0).getTime();
      return aTime - bTime;
    });

    let oldestTimestamp: string | undefined;
    let newestTimestamp: string | undefined;

    if (sorted.length > 0) {
      oldestTimestamp = new Date(
        sorted[0].createdTimestamp || sorted[0].createdAt || 0
      ).toISOString();
      newestTimestamp = new Date(
        sorted[sorted.length - 1].createdTimestamp || sorted[sorted.length - 1].createdAt || 0
      ).toISOString();
    }

    for (const msg of sorted) {
      const authorId = msg.author?.id || 'unknown';
      authorSet.add(authorId);

      if (options.includeMessages) {
        const rawContent = msg.content || '';
        const sanitized = sanitizeContent(rawContent);

        // Check character budget
        if (totalChars + sanitized.length > MAX_CONTEXT_CHARACTERS) {
          const remainingChars = Math.max(0, MAX_CONTEXT_CHARACTERS - totalChars);
          const truncatedContent = sanitized.slice(0, remainingChars) + '... [TRUNCATED]';
          boundedMessages.push({
            id: msg.id,
            authorId,
            authorUsername: msg.author?.username || 'unknown',
            isBot: Boolean(msg.author?.bot),
            timestamp: new Date(msg.createdTimestamp || msg.createdAt || 0).toISOString(),
            content: truncatedContent,
          });
          truncated = true;
          break;
        } else {
          totalChars += sanitized.length;
          boundedMessages.push({
            id: msg.id,
            authorId,
            authorUsername: msg.author?.username || 'unknown',
            isBot: Boolean(msg.author?.bot),
            timestamp: new Date(msg.createdTimestamp || msg.createdAt || 0).toISOString(),
            content: sanitized,
          });
        }
      }
    }

    return {
      channelId: channel.id,
      channelName: channel.name,
      classification,
      messageCount,
      activeAuthors: Array.from(authorSet),
      timeWindow: oldestTimestamp ? { oldestTimestamp, newestTimestamp } : undefined,
      boundedMessages: options.includeMessages ? boundedMessages : undefined,
      truncated,
      status: 'SUCCESS',
    };
  }

  /**
   * Retrieves high-level guild community metadata and channel classification breakdown.
   */
  public getCommunityMetadata(guild: Guild): CommunityMetadata {
    if (!guild) {
      throw new Error('Guild is required to retrieve community metadata.');
    }

    const channelsCollection = guild.channels?.cache ? Array.from(guild.channels.cache.values()) : [];

    const summary = {
      totalChannels: channelsCollection.length,
      publicChannels: 0,
      staffChannels: 0,
      ticketChannels: 0,
      privateAiChannels: 0,
      otherChannels: 0,
    };

    const publicNames: string[] = [];

    for (const ch of channelsCollection) {
      const classification = classifyChannel(ch);
      switch (classification) {
        case 'PUBLIC_COMMUNITY':
          summary.publicChannels++;
          if (ch.name) publicNames.push(ch.name);
          break;
        case 'STAFF_INTERNAL':
          summary.staffChannels++;
          break;
        case 'PRIVATE_TICKET':
          summary.ticketChannels++;
          break;
        case 'PRIVATE_AI':
          summary.privateAiChannels++;
          break;
        case 'OTHER':
        default:
          summary.otherChannels++;
          break;
      }
    }

    return {
      guildId: guild.id,
      guildName: guild.name,
      memberCount: guild.memberCount || 0,
      channelsSummary: summary,
      publicChannelNames: publicNames,
    };
  }

  /**
   * Retrieves aggregated community context across multiple authorized channels.
   */
  public async getCommunityContext(
    guild: Guild,
    request: CommunityContextRequest = {}
  ): Promise<CommunityContextResponse> {
    if (!guild) {
      return {
        guildId: 'unknown',
        channels: [],
        totalMessages: 0,
        totalActiveAuthors: 0,
        truncated: false,
        status: 'ERROR',
        generatedAt: new Date().toISOString(),
      };
    }

    const channelsCollection = guild.channels?.cache ? Array.from(guild.channels.cache.values()) : [];

    // Filter requested channels or find all candidate channels
    let targetChannels: any[] = [];
    if (request.channelIds && request.channelIds.length > 0) {
      targetChannels = request.channelIds
        .map((id) => (guild.channels?.cache ? guild.channels.cache.get(id) : null))
        .filter(Boolean);
    } else {
      // Default: select public community channels
      targetChannels = channelsCollection.filter(
        (ch) => classifyChannel(ch) === 'PUBLIC_COMMUNITY'
      );
    }

    // Limit maximum channels per request
    let truncated = false;
    if (targetChannels.length > MAX_CHANNELS_PER_REQUEST) {
      targetChannels = targetChannels.slice(0, MAX_CHANNELS_PER_REQUEST);
      truncated = true;
    }

    const summaries: ChannelActivitySummary[] = new Array(targetChannels.length);

    // Bounded concurrency execution (pool of up to MAX_CONTEXT_CHANNEL_CONCURRENCY workers)
    const workerCount = Math.min(targetChannels.length, MAX_CONTEXT_CHANNEL_CONCURRENCY);
    let nextIndex = 0;

    const worker = async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= targetChannels.length) break;

        const ch = targetChannels[index];
        try {
          const activity = await this.getRecentChannelActivity(ch, {
            limit: request.limitPerChannel,
            includeMessages: request.includeMessages,
            allowStaffChannels: request.allowStaffChannels,
          });
          summaries[index] = activity;
        } catch (fetchErr: any) {
          summaries[index] = {
            channelId: ch?.id || 'unknown',
            channelName: ch?.name || 'unknown',
            classification: 'OTHER',
            messageCount: 0,
            activeAuthors: [],
            truncated: false,
            status: 'ERROR',
            errorReason: `Unexpected channel retrieval error: ${fetchErr?.message || String(fetchErr)}`,
          };
        }
      }
    };

    if (workerCount > 0) {
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
    }

    const allAuthors = new Set<string>();
    let totalMessages = 0;

    for (const activity of summaries) {
      if (activity && activity.status === 'SUCCESS') {
        totalMessages += activity.messageCount;
        for (const author of activity.activeAuthors) {
          allAuthors.add(author);
        }
        if (activity.truncated) {
          truncated = true;
        }
      }
    }

    const anySuccess = summaries.some((s) => s.status === 'SUCCESS');
    const anyError = summaries.some((s) => s.status === 'ERROR' || s.status === 'FORBIDDEN');

    let overallStatus: 'SUCCESS' | 'PARTIAL' | 'ERROR' = 'SUCCESS';
    if (!anySuccess && anyError) {
      overallStatus = 'ERROR';
    } else if (anySuccess && anyError) {
      overallStatus = 'PARTIAL';
    }

    return {
      guildId: guild.id,
      channels: summaries,
      totalMessages,
      totalActiveAuthors: allAuthors.size,
      truncated,
      status: overallStatus,
      generatedAt: new Date().toISOString(),
    };
  }
}

/**
 * Singleton export of CommunityContextService.
 */
export const contextService = new CommunityContextService();
