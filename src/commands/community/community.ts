import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ChannelType,
  Guild,
  GuildBasedChannel,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
} from 'discord.js';
import { summarizerService } from '../../services/ai/summarizerService';
import { proposalService, CommunityProposalService } from '../../services/ai/proposalService';
import { extractUserRoleIds, getAuthLevel, AuthLevel, authorize, Category } from '../../services/discord/policy';

export type GuideTopic =
  | 'general'
  | 'announcements'
  | 'help'
  | 'feedback'
  | 'events'
  | 'introductions';

export const GUIDE_TOPICS: { name: string; value: GuideTopic }[] = [
  { name: 'general', value: 'general' },
  { name: 'announcements', value: 'announcements' },
  { name: 'help', value: 'help' },
  { name: 'feedback', value: 'feedback' },
  { name: 'events', value: 'events' },
  { name: 'introductions', value: 'introductions' },
];

export const TOPIC_KEYWORDS: Record<GuideTopic, string[]> = {
  general: ['general', 'chat', 'community'],
  announcements: ['announcement', 'announcements', 'news', 'updates', 'update'],
  help: ['help', 'support', 'question', 'questions', 'faq'],
  feedback: ['feedback', 'suggestions', 'suggestion', 'ideas', 'idea'],
  events: ['event', 'events', 'meetup', 'meetups'],
  introductions: ['introduction', 'introductions', 'introduce', 'welcome'],
};

export const data = new SlashCommandBuilder()
  .setName('community')
  .setDescription('Kosmo Community information and help commands')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('info')
      .setDescription('Display basic information about this community server')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('channels')
      .setDescription('List channels available in this community server')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('roles')
      .setDescription('List roles available in this community server')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('guide')
      .setDescription('Find the right place in this community')
      .addStringOption((option) =>
        option
          .setName('topic')
          .setDescription('Community topic to find guidance for')
          .setRequired(true)
          .addChoices(
            { name: 'general', value: 'general' },
            { name: 'announcements', value: 'announcements' },
            { name: 'help', value: 'help' },
            { name: 'feedback', value: 'feedback' },
            { name: 'events', value: 'events' },
            { name: 'introductions', value: 'introductions' }
          )
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('start')
      .setDescription('Get started in this community with essential landmarks and channels')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('summarize')
      .setDescription('Summarize recent community discussion activity (Staff only)')
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setDescription('Specific public community channel to summarize (defaults to discussion channels)')
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName('scope')
          .setDescription('Scope of summarization')
          .setRequired(false)
          .addChoices(
            { name: 'Current Channel', value: 'channel' },
            { name: 'All Public Discussion Channels', value: 'community' }
          )
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('propose')
      .setDescription('Generate an actionable community infrastructure proposal based on diagnostics (Staff only)')
      .addStringOption((option) =>
        option
          .setName('scope')
          .setDescription('Scope of diagnostics to analyze')
          .setRequired(true)
          .addChoices(
            { name: 'Entire Community', value: 'COMMUNITY' },
            { name: 'Specific Channel', value: 'CHANNEL' }
          )
      )
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setDescription('Specific channel to analyze (required if scope is CHANNEL)')
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName('focus')
          .setDescription('Optimization focus')
          .setRequired(false)
          .addChoices(
            { name: 'Engagement', value: 'engagement' },
            { name: 'Structure', value: 'structure' },
            { name: 'Navigation', value: 'navigation' },
            { name: 'Roles', value: 'roles' }
          )
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('plan-status')
      .setDescription('View pending community action proposals and expiration status (Staff only)')
  );

/**
 * Normalizes a channel or category name for deterministic matching.
 * Handles lowercasing, hyphens, underscores, extra spaces, and non-alphanumerics.
 */
export function normalizeName(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Helper to safely format a list of items with length truncation.
 * Ensures the formatted string does not exceed maxLength (default 1000 for embed field limits).
 */
export function formatItemList(items: string[], maxLength: number = 1000): string {
  if (!items || items.length === 0) {
    return 'None';
  }

  let formatted = '';
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const separator = i === 0 ? '' : ', ';
    const remainingCount = items.length - i;
    const overflowNote = ` (+${remainingCount} more)`;

    if (formatted.length + separator.length + item.length + overflowNote.length > maxLength) {
      formatted += (formatted.length > 0 ? ', ' : '') + `(+${remainingCount} more)`;
      return formatted;
    }

    formatted += separator + item;
  }

  return formatted;
}

/**
 * Deterministically finds the best matching navigable channel for a set of keywords.
 * Returns the matched channel and parent category name if found, or null if no confident destination exists.
 */
export function findBestChannelByKeywords(
  guild: Guild,
  keywords: string[],
  topicOrPreferredName?: string
): { channel: GuildBasedChannel; categoryName?: string } | null {
  const channels = guild.channels?.cache
    ? Array.from(guild.channels.cache.values())
    : [];

  const eligibleChannels = channels.filter(
    (c): c is GuildBasedChannel =>
      Boolean(c) &&
      (c.type === ChannelType.GuildText ||
        c.type === ChannelType.GuildAnnouncement ||
        c.type === ChannelType.GuildForum)
  );

  if (eligibleChannels.length === 0 || !keywords || keywords.length === 0) {
    return null;
  }

  const normalizedKeywords = keywords.map(normalizeName).filter(Boolean);
  const normPreferred = topicOrPreferredName ? normalizeName(topicOrPreferredName) : '';

  const scoredChannels: {
    channel: GuildBasedChannel;
    categoryName?: string;
    score: number;
    specificity: number;
  }[] = [];

  for (const channel of eligibleChannels) {
    const rawName = channel.name || '';
    const normName = normalizeName(rawName);
    if (!normName) continue;

    const cTokens = normName.split(' ').filter(Boolean);

    // Parent category
    let parentCategory: any = null;
    if (channel.parentId && guild.channels?.cache) {
      parentCategory = guild.channels.cache.get(channel.parentId);
    } else if ((channel as any).parent) {
      parentCategory = (channel as any).parent;
    }

    const catRawName = parentCategory?.name || '';
    const catNormName = normalizeName(catRawName);
    const catTokens = catNormName.split(' ').filter(Boolean);

    let score = 0;
    let specificity = 0;

    // Priority 1: Exact channel name match
    if (normPreferred && normName === normPreferred) {
      score = 1000;
      specificity = 100;
    } else if (normalizedKeywords.includes(normName)) {
      score = 900;
      specificity = 90;
    } else {
      // Priority 2: Strong keyword token match in channel name
      const matchedTokens = cTokens.filter((token) => normalizedKeywords.includes(token));
      if (matchedTokens.length > 0) {
        const ratio = matchedTokens.length / cTokens.length;
        score = 500 + Math.round(ratio * 100) + matchedTokens.length * 20;
        specificity = Math.round(ratio * 50) + (10 - Math.min(cTokens.length, 10));
      } else {
        // Fallback keyword substring in channel name (minimum 4 chars)
        const hasSubstring = normalizedKeywords.some(
          (kw) => kw.length >= 4 && normName.includes(kw)
        );
        if (hasSubstring) {
          score = 300;
          specificity = 30;
        }
      }
    }

    // Priority 3: Parent category name match
    const catMatches =
      (normPreferred && catNormName === normPreferred) ||
      normalizedKeywords.includes(catNormName) ||
      catTokens.some((token) => normalizedKeywords.includes(token));

    if (catMatches) {
      if (score > 0) {
        // Category reinforces existing channel match
        score += 25;
        specificity += 5;
      } else {
        // Category-only match: lower priority than channel-name match
        score = 100;
        specificity = 10 - Math.min(cTokens.length, 10);
      }
    }

    if (score > 0) {
      scoredChannels.push({
        channel,
        categoryName: catRawName || undefined,
        score,
        specificity,
      });
    }
  }

  if (scoredChannels.length === 0) {
    return null;
  }

  // Sort descending by score, then specificity
  scoredChannels.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return b.specificity - a.specificity;
  });

  const best = scoredChannels[0];

  // Check for ambiguous tie at the top
  if (scoredChannels.length > 1) {
    const runnerUp = scoredChannels[1];
    if (runnerUp.score === best.score && runnerUp.specificity === best.specificity) {
      // Multiple candidates with equal relevance that cannot be distinguished
      return null;
    }
  }

  return {
    channel: best.channel,
    categoryName: best.categoryName,
  };
}

/**
 * Deterministically finds the best matching navigable channel for a topic.
 * Returns the matched channel and parent category name if found, or null if no confident destination exists.
 */
export function findBestCommunityChannel(
  guild: Guild,
  topic: GuideTopic
): { channel: GuildBasedChannel; categoryName?: string } | null {
  const keywords = TOPIC_KEYWORDS[topic];
  if (!keywords) {
    return null;
  }
  return findBestChannelByKeywords(guild, keywords, topic);
}

export interface CommunityLandmarks {
  rules: GuildBasedChannel | null;
  roles: GuildBasedChannel | null;
  introductions: GuildBasedChannel | null;
  general: GuildBasedChannel | null;
  announcements: GuildBasedChannel | null;
  support: GuildBasedChannel | null;
}

/**
 * Deterministically discovers the 6 foundational community landmark channels for onboarding.
 * Prefers official Discord properties (rulesChannel, publicUpdatesChannel) when available and navigable,
 * falling back to keyword-based discovery.
 */
export function findCommunityLandmarks(guild: Guild): CommunityLandmarks {
  function isNavigableText(chan: any): boolean {
    if (!chan) return false;
    return (
      chan.type === ChannelType.GuildText ||
      chan.type === ChannelType.GuildAnnouncement ||
      chan.type === ChannelType.GuildForum
    );
  }

  // 1. Rules
  let rulesChannel: GuildBasedChannel | null = null;
  if (guild.rulesChannel && isNavigableText(guild.rulesChannel)) {
    rulesChannel = guild.rulesChannel;
  } else if (guild.rulesChannelId && guild.channels?.cache) {
    const candidate = guild.channels.cache.get(guild.rulesChannelId);
    if (candidate && isNavigableText(candidate)) {
      rulesChannel = candidate;
    }
  }
  if (!rulesChannel) {
    const match = findBestChannelByKeywords(
      guild,
      ['rules', 'start-here', 'start here', 'guidelines', 'welcome', 'rule'],
      'rules'
    );
    if (match) rulesChannel = match.channel;
  }

  // 2. Announcements
  let announcementsChannel: GuildBasedChannel | null = null;
  if (guild.publicUpdatesChannel && isNavigableText(guild.publicUpdatesChannel)) {
    announcementsChannel = guild.publicUpdatesChannel;
  } else if (guild.publicUpdatesChannelId && guild.channels?.cache) {
    const candidate = guild.channels.cache.get(guild.publicUpdatesChannelId);
    if (candidate && isNavigableText(candidate)) {
      announcementsChannel = candidate;
    }
  }
  if (!announcementsChannel) {
    const match = findBestChannelByKeywords(
      guild,
      ['announcements', 'announcement', 'news', 'updates', 'update'],
      'announcements'
    );
    if (match) announcementsChannel = match.channel;
  }

  // 3. Role Selection
  const rolesMatch = findBestChannelByKeywords(
    guild,
    ['get-roles', 'get roles', 'roles', 'role-select', 'role select', 'assign-roles', 'assign roles'],
    'get-roles'
  );
  const rolesChannel = rolesMatch ? rolesMatch.channel : null;

  // 4. General Discussion
  const generalMatch = findBestChannelByKeywords(
    guild,
    ['general-chat', 'general chat', 'general', 'chat', 'community'],
    'general'
  );
  const generalChannel = generalMatch ? generalMatch.channel : null;

  // 5. Support / Help
  const supportMatch = findBestChannelByKeywords(
    guild,
    ['contact-support', 'contact support', 'help-desk', 'help desk', 'support', 'help', 'faq'],
    'help'
  );
  const supportChannel = supportMatch ? supportMatch.channel : null;

  // 6. Introductions
  const introsMatch = findBestChannelByKeywords(
    guild,
    ['introductions', 'introduction', 'introduce', 'welcome', 'say hello'],
    'introductions'
  );
  const introsChannel = introsMatch ? introsMatch.channel : null;

  return {
    rules: rulesChannel,
    roles: rolesChannel,
    introductions: introsChannel,
    general: generalChannel,
    announcements: announcementsChannel,
    support: supportChannel,
  };
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  // 1. Must be executed in a guild
  const guild = interaction.guild;
  if (!guild) {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: 'Command must be used in a guild.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'Command must be used in a guild.', ephemeral: true });
    }
    return;
  }

  try {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'info': {
        const ownerDisplay = guild.ownerId ? `<@${guild.ownerId}>` : 'Unknown';
        const memberCount =
          typeof guild.memberCount === 'number'
            ? guild.memberCount.toLocaleString()
            : 'Unknown';
        const roleCount = guild.roles?.cache
          ? guild.roles.cache.size.toLocaleString()
          : '0';
        const channelCount = guild.channels?.cache
          ? guild.channels.cache.size.toLocaleString()
          : '0';

        const embed = new EmbedBuilder()
          .setTitle(`Community Information — ${guild.name}`)
          .setColor(0x3498db)
          .addFields(
            { name: 'Server Name', value: guild.name, inline: true },
            { name: 'Server ID', value: guild.id, inline: true },
            { name: 'Server Owner', value: ownerDisplay, inline: true },
            { name: 'Members', value: memberCount, inline: true },
            { name: 'Roles', value: roleCount, inline: true },
            { name: 'Channels', value: channelCount, inline: true }
          )
          .setTimestamp();

        if (typeof guild.iconURL === 'function') {
          const icon = guild.iconURL();
          if (icon) embed.setThumbnail(icon);
        }

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ embeds: [embed] });
        } else {
          await interaction.reply({ embeds: [embed] });
        }
        break;
      }

      case 'channels': {
        const channels = guild.channels?.cache
          ? Array.from(guild.channels.cache.values())
          : [];

        const categories: string[] = [];
        const textChannels: string[] = [];
        const voiceChannels: string[] = [];
        const otherChannels: string[] = [];

        for (const channel of channels) {
          if (!channel) continue;

          // Category channels
          if (channel.type === ChannelType.GuildCategory) {
            categories.push(channel.name || 'Unnamed Category');
          }
          // Text & Announcement channels
          else if (
            channel.type === ChannelType.GuildText ||
            channel.type === ChannelType.GuildAnnouncement
          ) {
            textChannels.push(`<#${channel.id}>`);
          }
          // Voice & Stage channels
          else if (
            channel.type === ChannelType.GuildVoice ||
            channel.type === ChannelType.GuildStageVoice
          ) {
            voiceChannels.push(`<#${channel.id}>`);
          }
          // Other supported channels (Forums, Threads, etc.)
          else {
            otherChannels.push(channel.name ? `<#${channel.id}>` : channel.id);
          }
        }

        const embed = new EmbedBuilder()
          .setTitle(`Community Channels — ${guild.name}`)
          .setColor(0x3498db)
          .setDescription(`Total channels: **${channels.length}**`)
          .addFields(
            {
              name: `📁 Categories (${categories.length})`,
              value: formatItemList(categories),
              inline: false,
            },
            {
              name: `💬 Text Channels (${textChannels.length})`,
              value: formatItemList(textChannels),
              inline: false,
            },
            {
              name: `🔊 Voice Channels (${voiceChannels.length})`,
              value: formatItemList(voiceChannels),
              inline: false,
            }
          )
          .setTimestamp();

        if (otherChannels.length > 0) {
          embed.addFields({
            name: `📌 Other Channels (${otherChannels.length})`,
            value: formatItemList(otherChannels),
            inline: false,
          });
        }

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ embeds: [embed] });
        } else {
          await interaction.reply({ embeds: [embed] });
        }
        break;
      }

      case 'roles': {
        const allRoles = guild.roles?.cache
          ? Array.from(guild.roles.cache.values())
          : [];

        // Exclude @everyone as a normal community role and sort descending by position
        const communityRoles = allRoles
          .filter((r) => r && r.id !== guild.id && r.name !== '@everyone')
          .sort((a, b) => (b.position ?? 0) - (a.position ?? 0));

        const roleNames = communityRoles.map((r) => r.name);
        const formattedRoles =
          communityRoles.length > 0
            ? formatItemList(roleNames)
            : 'No community roles found';

        const embed = new EmbedBuilder()
          .setTitle(`Community Roles — ${guild.name}`)
          .setColor(0x3498db)
          .setDescription(`Total community roles: **${communityRoles.length}**`)
          .addFields({
            name: `Roles (${communityRoles.length})`,
            value: formattedRoles,
            inline: false,
          })
          .setTimestamp();

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ embeds: [embed] });
        } else {
          await interaction.reply({ embeds: [embed] });
        }
        break;
      }

      case 'guide': {
        const topic = interaction.options.getString('topic', true) as GuideTopic;
        const match = findBestCommunityChannel(guild, topic);

        if (!match) {
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({
              content: 'No matching community channel was found for this topic.',
              ephemeral: true,
            });
          } else {
            await interaction.reply({
              content: 'No matching community channel was found for this topic.',
              ephemeral: true,
            });
          }
          break;
        }

        const topicDisplay = topic.charAt(0).toUpperCase() + topic.slice(1);
        const fields = [
          { name: 'Topic', value: topicDisplay, inline: true },
          { name: 'Recommended Channel', value: `<#${match.channel.id}>`, inline: true },
        ];

        if (match.categoryName) {
          fields.push({ name: 'Category', value: match.categoryName, inline: true });
        }

        fields.push({
          name: 'Reason',
          value: 'Based on the channel names, this appears to be the best match.',
          inline: false,
        });

        const embed = new EmbedBuilder()
          .setTitle(`Community Guide — ${guild.name}`)
          .setColor(0x3498db)
          .addFields(fields)
          .setTimestamp();

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ embeds: [embed] });
        } else {
          await interaction.reply({ embeds: [embed] });
        }
        break;
      }

      case 'start': {
        const landmarks = findCommunityLandmarks(guild);

        const embed = new EmbedBuilder()
          .setTitle(`Getting Started — ${guild.name}`)
          .setColor(0x3498db)
          .setDescription(
            `Welcome to **${guild.name}**! Here is a quick roadmap of essential community channels to help you get started:`
          )
          .addFields(
            {
              name: '1. Review the Rules',
              value: landmarks.rules ? `<#${landmarks.rules.id}>` : 'Not configured',
              inline: true,
            },
            {
              name: '2. Pick Your Roles',
              value: landmarks.roles ? `<#${landmarks.roles.id}>` : 'Not configured',
              inline: true,
            },
            {
              name: '3. Say Hello',
              value: landmarks.introductions ? `<#${landmarks.introductions.id}>` : 'Not configured',
              inline: true,
            },
            {
              name: '4. Join the Discussion',
              value: landmarks.general ? `<#${landmarks.general.id}>` : 'Not configured',
              inline: true,
            },
            {
              name: '5. Stay Informed',
              value: landmarks.announcements ? `<#${landmarks.announcements.id}>` : 'Not configured',
              inline: true,
            },
            {
              name: '6. Get Support',
              value: landmarks.support ? `<#${landmarks.support.id}>` : 'Not configured',
              inline: true,
            }
          )
          .setFooter({
            text: 'KOSMO Community Assistance • Deterministic & Read-Only',
          })
          .setTimestamp();

        if (typeof guild.iconURL === 'function') {
          const icon = guild.iconURL();
          if (icon) embed.setThumbnail(icon);
        }

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ embeds: [embed] });
        } else {
          await interaction.reply({ embeds: [embed] });
        }
        break;
      }

      case 'summarize': {
        // 1. Authorization: Only Staff (Owner, Founder, Team Kosmo, Admin, Moderator)
        const callerRoles = extractUserRoleIds(interaction.member);
        const authLevel = getAuthLevel(callerRoles, {
          userId: interaction.user.id,
          guildOwnerId: guild.ownerId,
        });

        const isStaff =
          authLevel === AuthLevel.OWNER ||
          authLevel === AuthLevel.FOUNDER ||
          authLevel === AuthLevel.TEAM_KOSMO ||
          authLevel === AuthLevel.ADMIN ||
          authLevel === AuthLevel.MODERATOR;

        if (!isStaff) {
          const unauthorizedEmbed = new EmbedBuilder()
            .setTitle('❌ Unauthorized')
            .setColor(0xed4245)
            .setDescription('You do not have permission to use the community summarization command.')
            .setFooter({ text: 'Access restricted to Kosmo Staff and Moderators.' })
            .setTimestamp();

          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ embeds: [unauthorizedEmbed], ephemeral: true });
          } else {
            await interaction.reply({ embeds: [unauthorizedEmbed], ephemeral: true });
          }
          return;
        }

        // Ephemeral defer
        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferReply({ ephemeral: true });
        }

        const targetChannel = interaction.options.getChannel('channel');
        const scopeChoice = interaction.options.getString('scope');

        const scope = targetChannel || scopeChoice === 'channel' ? 'CHANNEL' : 'COMMUNITY';
        const channelId = targetChannel?.id || (scope === 'CHANNEL' ? interaction.channelId : undefined);

        const result = await summarizerService.summarize({
          guild,
          scope,
          channelId,
          requester: {
            id: interaction.user.id,
            username: interaction.user.tag || interaction.user.username,
            authLevel,
          },
        });

        if (result.status === 'ERROR' || result.status === 'UNAVAILABLE' || result.status === 'FORBIDDEN') {
          const errorEmbed = new EmbedBuilder()
            .setTitle('❌ Community Summary Unavailable')
            .setColor(0xed4245)
            .setDescription(result.errorReason || 'An error occurred while generating the community summary.')
            .setFooter({ text: 'Advisory Intelligence • Read-Only' })
            .setTimestamp();

          await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
          return;
        }

        if (result.status === 'NO_DATA') {
          const noDataEmbed = new EmbedBuilder()
            .setTitle('ℹ️ No Recent Activity Found')
            .setColor(0x3498db)
            .setDescription(
              result.errorReason ||
                'No recent message activity was found in the specified public community channels.'
            )
            .setFooter({ text: 'Advisory Intelligence • Read-Only' })
            .setTimestamp();

          await interaction.followUp({ embeds: [noDataEmbed], ephemeral: true });
          return;
        }

        // Render structured summary
        const summary = result.summary!;
        const color = result.status === 'SUCCESS' ? 0x5865f2 : 0xf1c40f;

        const summaryEmbed = new EmbedBuilder()
          .setTitle('📋 Community Intelligence — Summary')
          .setColor(color)
          .setDescription(`### ${summary.headline}\n\n${summary.overview}`)
          .setTimestamp();

        if (summary.keyTopics.length > 0) {
          const topicsText = summary.keyTopics
            .map((t) => `• **${t.topic}**: ${t.description}`)
            .join('\n');
          summaryEmbed.addFields({
            name: '📌 Key Discussion Topics',
            value: topicsText.length > 1024 ? topicsText.slice(0, 1020) + '...' : topicsText,
            inline: false,
          });
        }

        if (summary.highlightsByChannel.length > 0) {
          for (const ch of summary.highlightsByChannel.slice(0, 5)) {
            const pointsText = ch.points.map((p) => `• ${p}`).join('\n') || 'Activity recorded.';
            summaryEmbed.addFields({
              name: `#${ch.channelName}`,
              value: pointsText.length > 1024 ? pointsText.slice(0, 1020) + '...' : pointsText,
              inline: false,
            });
          }
        }

        if (summary.toneObservation) {
          summaryEmbed.addFields({
            name: '💬 Discussion Style',
            value: summary.toneObservation,
            inline: false,
          });
        }

        const provenance = summary.provenance;
        const channelList =
          provenance.channelsSummarized.map((c) => `#${c}`).join(', ') || 'None';
        const truncatedNote = provenance.truncated
          ? '⚠️ Context truncated at 12,000 character limit'
          : 'Complete';

        summaryEmbed.addFields({
          name: '🔍 Scope & Provenance',
          value:
            `**Channels Analyzed**: ${channelList}\n` +
            `**Volume**: ${provenance.totalMessagesAnalyzed} messages from ${provenance.totalUniqueAuthors} unique members\n` +
            `**Context Status**: ${truncatedNote}\n` +
            `**Execution Time**: ${result.executionTimeMs}ms`,
          inline: false,
        });

        if (provenance.excludedChannels.length > 0) {
          summaryEmbed.addFields({
            name: '🛡️ Excluded Channels',
            value: provenance.excludedChannels.map((c) => `#${c}`).join(', '),
            inline: true,
          });
        }

        if (provenance.partialErrors.length > 0) {
          summaryEmbed.addFields({
            name: '⚠️ Channel Warnings',
            value: provenance.partialErrors.join('\n').slice(0, 1024),
            inline: false,
          });
        }

        summaryEmbed.setFooter({
          text: 'Advisory Intelligence • Powered by Kosmo AI • Read-Only',
        });

        await interaction.followUp({ embeds: [summaryEmbed], ephemeral: true });
        break;
      }

      case 'propose': {
        if (!interaction.guild) {
          await interaction.reply({
            content: '❌ Community proposals can only be generated within a server.',
            ephemeral: true,
          });
          return;
        }

        const userRoleIds = extractUserRoleIds(interaction.member);
        const authLevel = getAuthLevel(userRoleIds, {
          userId: interaction.user.id,
          guildOwnerId: interaction.guild.ownerId,
        });

        if (authLevel === AuthLevel.NONE) {
          await interaction.reply({
            content: '❌ You do not have permission to propose community actions. Requires staff authorization (Moderator+).',
            ephemeral: true,
          });
          return;
        }

        const scope = interaction.options.getString('scope', true) as 'COMMUNITY' | 'CHANNEL';
        const targetChannel = interaction.options.getChannel('channel');
        const focus = (interaction.options.getString('focus') as any) || undefined;

        if (scope === 'CHANNEL' && !targetChannel) {
          await interaction.reply({
            content: '❌ A target channel must be specified when scope is "Specific Channel".',
            ephemeral: true,
          });
          return;
        }

        await interaction.deferReply({ ephemeral: true });

        const result = await proposalService.generateProposal({
          guild: interaction.guild,
          scope,
          channelId: targetChannel?.id,
          focus,
          creator: {
            userId: interaction.user.id,
            username: interaction.user.tag || interaction.user.username,
            authLevel,
          },
        });

        if (!result.success || !result.proposal) {
          const errorEmbed = new EmbedBuilder()
            .setTitle('❌ Proposal Creation Rejected')
            .setColor(0xed4245)
            .setDescription(result.message || 'Unable to generate community action proposal.')
            .setFooter({ text: 'Community Advisory • Fail Closed' })
            .setTimestamp();

          await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
          return;
        }

        const proposal = result.proposal;
        const isHighRisk = proposal.actionRisk === 'HIGH';

        const embed = new EmbedBuilder()
          .setTitle('📋 Community Action Proposal (Phase 9.8)')
          .setColor(isHighRisk ? 0xed4245 : 0x5865f2)
          .setDescription(`### Rationale\n${proposal.rationale}\n\n*This proposal was generated by AI from community diagnostics. No mutations have been performed.*`)
          .addFields(
            { name: 'Proposal ID', value: `\`${proposal.planId}\``, inline: true },
            { name: 'Risk Level', value: `\`${proposal.actionRisk}\``, inline: true },
            { name: 'Status', value: `\`${proposal.status}\``, inline: true },
            {
              name: `Proposed Actions (${proposal.actions.length})`,
              value: proposal.actions
                .map((a, idx) => `${idx + 1}. **${a.type}**: \`${JSON.stringify(a.payload)}\``)
                .join('\n')
                .slice(0, 1024),
              inline: false,
            },
            {
              name: 'Expiration',
              value: `<t:${Math.floor(proposal.expiration.getTime() / 1000)}:R>`,
              inline: true,
            },
            {
              name: 'Required Authority',
              value: isHighRisk
                ? 'Founder, Team Kosmo, or Server Owner'
                : 'Staff (Moderator, Admin, Founder)',
              inline: true,
            }
          )
          .setFooter({ text: 'Awaiting human confirmation • Zero mutations performed' })
          .setTimestamp();

        const confirmBtn = new ButtonBuilder()
          .setCustomId(`community_confirm_${proposal.planId}`)
          .setLabel('Confirm Proposal')
          .setStyle(isHighRisk ? ButtonStyle.Danger : ButtonStyle.Primary);

        const cancelBtn = new ButtonBuilder()
          .setCustomId(`community_cancel_${proposal.planId}`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn, cancelBtn);

        await interaction.followUp({
          embeds: [embed],
          components: [row],
          ephemeral: true,
        });
        break;
      }

      case 'plan-status': {
        if (!interaction.guild) {
          await interaction.reply({
            content: '❌ Proposal status can only be viewed within a server.',
            ephemeral: true,
          });
          return;
        }

        const userRoleIds = extractUserRoleIds(interaction.member);
        const authLevel = getAuthLevel(userRoleIds, {
          userId: interaction.user.id,
          guildOwnerId: interaction.guild.ownerId,
        });

        if (authLevel === AuthLevel.NONE) {
          await interaction.reply({
            content: '❌ You do not have permission to view community proposals.',
            ephemeral: true,
          });
          return;
        }

        const pending = await proposalService.getPendingProposalsForGuild(interaction.guild.id);
        if (pending.length === 0) {
          await interaction.reply({
            content: 'ℹ️ No pending community action proposals for this server.',
            ephemeral: true,
          });
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle('📋 Pending Community Action Proposals')
          .setColor(0x3498db)
          .setDescription(`Active pending proposals (${pending.length}/${CommunityProposalService.MAX_PENDING_PROPOSALS}):`)
          .setTimestamp();

        for (const p of pending) {
          embed.addFields({
            name: `Proposal \`${p.planId}\` (${p.actionRisk})`,
            value: `• **Creator**: <@${p.creator.userId}>\n• **Actions**: ${p.actions.length}\n• **Expires**: <t:${Math.floor(p.expiration.getTime() / 1000)}:R>\n• **Rationale**: ${p.rationale.slice(0, 120)}...`,
            inline: false,
          });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
        break;
      }

      default: {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({
            content: `Unknown subcommand: ${subcommand}`,
            ephemeral: true,
          });
        } else {
          await interaction.reply({
            content: `Unknown subcommand: ${subcommand}`,
            ephemeral: true,
          });
        }
        break;
      }
    }
  } catch (error: any) {
    const errorMessage = error?.message || 'An unexpected error occurred.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: `❌ Error: ${errorMessage}`, ephemeral: true });
    } else {
      await interaction.reply({ content: `❌ Error: ${errorMessage}`, ephemeral: true });
    }
  }
}

/**
 * Button interaction handler for Phase 9.8 Community Proposal [Confirm Proposal] and [Cancel] buttons.
 */
export async function handleProposalButton(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;
  const isConfirm = customId.startsWith('community_confirm_');
  const isCancel = customId.startsWith('community_cancel_');

  if (!isConfirm && !isCancel) return;
  if (interaction.replied || interaction.deferred) return;

  const planId = isConfirm
    ? customId.replace('community_confirm_', '')
    : customId.replace('community_cancel_', '');

  if (!interaction.guild) {
    await interaction.reply({
      content: '❌ Confirmation can only be performed within a server.',
      ephemeral: true,
    });
    return;
  }

  const userRoleIds = extractUserRoleIds(interaction.member);
  const context = {
    userId: interaction.user.id,
    guildOwnerId: interaction.guild.ownerId,
  };

  if (isCancel) {
    const cancelRes = await proposalService.cancelProposal(planId, interaction.user.id, interaction.guild.id);
    if (!cancelRes.success) {
      await interaction.reply({ content: `❌ ${cancelRes.message}`, ephemeral: true });
      return;
    }

    const cancelEmbed = new EmbedBuilder()
      .setTitle('🚫 Community Proposal Cancelled')
      .setDescription('The action proposal was cancelled. No changes were made to Discord.')
      .setColor(0x95a5a6)
      .setFooter({ text: `Cancelled by @${interaction.user.username}` })
      .setTimestamp();

    await interaction.update({ embeds: [cancelEmbed], components: [] });
    return;
  }

  // isConfirm branch
  const proposal = await proposalService.getProposal(planId);
  if (!proposal) {
    await interaction.reply({ content: `❌ Proposal "${planId}" not found or expired.`, ephemeral: true });
    return;
  }

  if (proposal.status !== 'PENDING') {
    await interaction.reply({
      content: `❌ Proposal "${planId}" is ${proposal.status.toLowerCase()} and cannot be confirmed.`,
      ephemeral: true,
    });
    return;
  }

  // Authorize
  const decision = authorize(userRoleIds, Category.CONFIRM, context);
  if (decision === 'DENY') {
    await interaction.reply({ content: '❌ You are not authorized to confirm this action.', ephemeral: true });
    return;
  }

  if (decision === 'REQUIRES_FOUNDERS_APPROVAL') {
    await interaction.reply({
      content: '⚠️ Confirmation requires Founder, Team Kosmo, or Server Owner approval.',
      ephemeral: true,
    });
    return;
  }

  // Defer update
  if (typeof (interaction as any).deferUpdate === 'function') {
    await interaction.deferUpdate();
  }

  const execRes = await proposalService.confirmAndExecuteProposal(
    interaction.guild,
    planId,
    userRoleIds,
    context
  );

  if (!execRes.success) {
    const errorEmbed = new EmbedBuilder()
      .setTitle(`❌ Proposal Execution ${execRes.status === 'PARTIALLY_FAILED' ? 'Partially Failed' : 'Failed'}`)
      .setDescription(`**Status:** \`${execRes.status}\`\n\n${execRes.message}`)
      .setColor(0xed4245)
      .setTimestamp();

    if (execRes.executionResults && execRes.executionResults.length > 0) {
      errorEmbed.addFields({
        name: 'Executed Prior to Failure',
        value: execRes.executionResults.map((r, i) => `${i + 1}. ${r}`).join('\n').slice(0, 1024),
        inline: false,
      });
    }

    if (interaction.deferred && typeof (interaction as any).editReply === 'function') {
      await interaction.editReply({ embeds: [errorEmbed], components: [] });
    } else {
      await interaction.update({ embeds: [errorEmbed], components: [] });
    }
    return;
  }

  const successEmbed = new EmbedBuilder()
    .setTitle('✅ Community Action Proposal Executed & Verified')
    .setDescription(`**Proposal ID:** \`${planId}\`\nAll proposed actions have been executed and verified in Discord state.`)
    .setColor(0x57f287)
    .addFields(
      { name: 'Status', value: '`VERIFIED`', inline: true },
      { name: 'Confirmed By', value: `<@${interaction.user.id}>`, inline: true },
      {
        name: 'Execution Results',
        value: execRes.executionResults?.map((r, i) => `${i + 1}. ${r}`).join('\n').slice(0, 1024) || 'All actions succeeded.',
        inline: false,
      }
    )
    .setFooter({ text: 'Community Advisory • Verified Execution' })
    .setTimestamp();

  if (interaction.deferred && typeof (interaction as any).editReply === 'function') {
    await interaction.editReply({ embeds: [successEmbed], components: [] });
  } else {
    await interaction.update({ embeds: [successEmbed], components: [] });
  }
}

export default execute;
