// src/events/message/messageCreate.ts
/**
 * Discord messageCreate Event Pipeline for KosmoBot.
 *
 * Implements:
 * 1. Proactive Welcome Icebreaker for configured newcomer introductions channel.
 * 2. Intent-based conversational AI (@KosmoBot) with Kosmo voice & formatting:
 *    - Homework/offloading -> sharp but playful roast + redirect to AskKosmo / building.
 *    - Silly questions -> playful roast.
 *    - Free API-token begging -> playful roast + redirect.
 *    - Genuine technical questions -> intelligent, useful answer in Kosmo voice.
 *    - Genuine project/workflow questions -> helpful Kosmo response + contextual AskKosmo guidance.
 *    - Serious support, billing, account issues -> serious response, strictly no roasting.
 *    - Moderation or Discord action requests -> enters existing authorization/safety/planning pipeline.
 *
 * Strict Architectural Rules:
 * - Bot messages are ignored.
 * - Ordinary untagged chat is never sent to the LLM or roasted.
 * - Roast detection is NOT a global unmentioned messageCreate listener.
 * - Does NOT require the user to explicitly say "roast me".
 * - All state and concurrency claims use PostgreSQL/Redis authority.
 */

import {
  Client,
  Message,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { getPersonalityConfig, PersonalityConfig } from '../../config/personality';
import {
  getIntroductionRepository,
  getIntroductionWelcomeMessage,
  IIntroductionRepository,
} from '../../services/engagement/introductionRepository';
import {
  buildPersonalityPrompt,
  sanitizeConversationalResponse,
} from '../../services/ai/personality/kosmoPersonality';
import { classifyUserIntent } from '../../services/ai/personality/intentRouter';
import { maybePromoteAskKosmo } from '../../services/ai/personality/engagement';
import { cache } from '../../services/cache';
import { nlManager } from '../../services/discord/nl_manager';
import { PlanService } from '../../services/discord/plan';
import { extractUserRoleIds } from '../../services/discord/policy';
import { NLContext, NLPlanResult } from '../../services/discord/types';

export interface MessageCreateHandlerDependencies {
  config?: PersonalityConfig;
  introRepo?: IIntroductionRepository;
  llmCaller?: (prompt: string, systemPrompt: string) => Promise<string>;
  nlManager?: { generatePlan: (instruction: string, context: NLContext) => Promise<NLPlanResult> };
}

/**
 * Default OpenRouter caller for conversational personality messages.
 */
export async function defaultConversationalLLM(
  prompt: string,
  systemPrompt: string
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set.');
  }

  const model = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct';
  const baseUrl = 'https://openrouter.ai/api/v1';

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/Yash-Gaikwad14/KOSMO-BOT',
      'X-Title': 'Kosmo Discord Bot',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 500,
      reasoning: { effort: 'none', exclude: true },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter API responded with status ${response.status}`);
  }

  const data: any = await response.json();
  const rawContent = data?.choices?.[0]?.message?.content?.trim() || '';

  // Strip reasoning tags if present
  return rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/**
 * Determines whether a message was sent in an introduction channel.
 * Matches:
 * 1. Exact snowflake channel ID match against configured introChannelId.
 * 2. Case-insensitive channel name match against configured introChannelId (e.g. 'introductions' or '#introductions').
 * 3. Fallback: If configured introChannelId is empty or not set, match if channel name is 'introductions' or 'introduction'.
 */
export function isIntroductionChannel(message: Message, configuredIntroChannelId?: string): boolean {
  if (!message || !message.channel) return false;

  const configured = configuredIntroChannelId?.trim() || '';

  // 1. If configured as a numeric snowflake ID
  if (configured && message.channelId === configured) {
    return true;
  }

  // 2. Channel name matching (if channel object has a name)
  const channelName =
    'name' in message.channel && typeof (message.channel as any).name === 'string'
      ? (message.channel as any).name.toLowerCase()
      : '';

  if (configured) {
    const cleanConfigName = configured.replace(/^#/, '').toLowerCase();
    if (channelName && channelName === cleanConfigName) {
      return true;
    }
  }

  // 3. Fallback when introChannelId is not configured: canonical introductions channel
  if (!configured && channelName) {
    return channelName === 'introductions' || channelName === 'introduction';
  }

  return false;
}

/**
 * Main messageCreate event handler.
 */
export async function handleMessageCreate(
  message: Message,
  client: Client,
  deps?: MessageCreateHandlerDependencies
): Promise<void> {
  // 1. Ignore bots and webhook messages
  if (!message || message.author?.bot) {
    return;
  }

  const config = deps?.config || getPersonalityConfig();
  if (!config.enabled) {
    return;
  }

  const introRepo = deps?.introRepo || getIntroductionRepository();

  // 2. Introduction Icebreaker Pipeline (Proactive exception in INTRO_CHANNEL_ID or #introductions)
  if (isIntroductionChannel(message, config.introChannelId) && message.guildId) {
    try {
      const newlyClaimed = await introRepo.claimWelcome(
        message.guildId,
        message.author.id
      );

      if (newlyClaimed) {
        const welcomeText = getIntroductionWelcomeMessage(message.author.id);
        if ('send' in message.channel && typeof message.channel.send === 'function') {
          await message.channel.send(welcomeText);
        }
      }
    } catch (err) {
      console.error('Failed to process introduction welcome icebreaker:', err);
    }
    // Introduction messages do not trigger general LLM conversation
    return;
  }

  // 3. Normal Conversational AI: Strict Mention-Driven Trigger (@KosmoBot)
  const botId = client.user?.id;
  if (!botId) {
    return;
  }

  const isMentioned =
    message.mentions?.users?.has(botId) ||
    message.content.includes(`<@${botId}>`) ||
    message.content.includes(`<@!${botId}>`);

  if (!isMentioned) {
    return; // Ordinary messages without mention are ignored
  }

  // Extract clean prompt by removing bot mentions
  const mentionRegex = new RegExp(`<@!?${botId}>`, 'g');
  const cleanPrompt = message.content.replace(mentionRegex, '').trim();

  if (!cleanPrompt || cleanPrompt.length === 0) {
    await message.reply({
      content: 'Speak up. What are we building, breaking, or compiling today?',
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  // 4. Rate-limit enforcement (5 requests per 30 seconds per user)
  try {
    const rlKey = `ratelimit:aichat:${message.author.id}`;
    const rl = await cache.checkAndIncrementRateLimit(rlKey, 5, 30);
    if (!rl.allowed) {
      await message.reply({
        content: 'Slow down. Let your thoughts compile before queuing another request.',
        allowedMentions: { repliedUser: false },
      });
      return;
    }
  } catch (_err) {
    // Fail-open for rate-limit store glitches in non-critical conversation
  }

  // 5. Intent Understanding & Routing
  const intentDecision = classifyUserIntent(cleanPrompt, message.author?.id);

  // 5a. Discord Administrative / Moderation Action
  if (intentDecision.intent === 'DISCORD_ACTION') {
    const userRoleIds = message.member ? extractUserRoleIds(message.member) : [];
    const context: NLContext = {
      userId: message.author.id,
      username: message.author.username,
      roles: userRoleIds,
      guildId: message.guildId ?? undefined,
      guildOwnerId: message.guild?.ownerId ?? undefined,
      channelId: message.channelId,
    };

    const activeNLManager = deps?.nlManager || nlManager;
    const result = await activeNLManager.generatePlan(cleanPrompt, context);

    if (!result.success || !result.plan) {
      const errorMsg = result.error || result.explanation || 'Failed to generate plan.';
      await message.reply({
        content: `❌ **NL Management Request Rejected**\n\n${errorMsg}`,
        allowedMentions: { repliedUser: false },
      });
      return;
    }

    // Store plan in pending store awaiting human confirmation
    PlanService.storePlan(result.plan);

    const embed = new EmbedBuilder()
      .setTitle('⚠️ KOSMO ACTION CONFIRMATION')
      .setDescription(`**Action:** ${result.plan.name}\n${result.plan.description}`)
      .setColor(
        result.plan.riskLevel === 'HIGH' || result.plan.riskLevel === 'CRITICAL'
          ? 0xed4245
          : 0xfee75c
      )
      .addFields(
        { name: 'Risk Level', value: `\`${result.plan.riskLevel}\``, inline: true },
        { name: 'Status', value: '`Awaiting human confirmation`', inline: true },
        { name: 'Execution Notice', value: 'No changes have been made yet.', inline: false },
        {
          name: `Proposed Actions (${result.plan.actions.length})`,
          value: result.plan.actions
            .map((a, i) => `${i + 1}. **${a.type}**: \`${JSON.stringify(a.payload)}\``)
            .join('\n')
            .substring(0, 1024),
        },
        {
          name: 'Authority Required',
          value: 'Requires confirmation by Server Owner, Founder, or Team Kosmo.',
        }
      )
      .setFooter({
        text: 'Awaiting human confirmation • No mutations performed yet',
      })
      .setTimestamp();

    const confirmButton = new ButtonBuilder()
      .setCustomId(`kosmo_confirm_${result.plan.id}`)
      .setLabel('Confirm')
      .setStyle(ButtonStyle.Danger);

    const cancelButton = new ButtonBuilder()
      .setCustomId(`kosmo_cancel_${result.plan.id}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);

    await message.reply({
      embeds: [embed],
      components: [row],
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  // 5b. Direct Static Response (Homework roast+redirect, Free token roast, Silly question roast, Serious support redirect)
  if (intentDecision.staticResponse) {
    const sanitized = sanitizeConversationalResponse(intentDecision.staticResponse);
    await message.reply({
      content: sanitized,
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  // 6. Conversational AI Generation via LLM for Genuine Technical & Project Inquiries
  try {
    const baseSystemPrompt = intentDecision.systemPromptModifier || undefined;
    const systemPrompt = buildPersonalityPrompt(baseSystemPrompt, config);
    const llmCaller = deps?.llmCaller || defaultConversationalLLM;

    const rawOutput = await llmCaller(cleanPrompt, systemPrompt);
    const sanitizedOutput = sanitizeConversationalResponse(rawOutput);

    // Apply contextual AskKosmo promotion only for project queries, not mechanically to all technical answers
    const finalResponse =
      intentDecision.intent === 'GENUINE_PROJECT'
        ? maybePromoteAskKosmo(cleanPrompt, sanitizedOutput, config, false)
        : sanitizedOutput;

    await message.reply({
      content: finalResponse || 'Nothing to report. Push cleaner code.',
      allowedMentions: { repliedUser: false },
    });
  } catch (err) {
    console.error('Conversational AI response failed:', err);
    await message.reply({
      content: 'My cognitive uplink hit a transient hiccup. Try asking again in a moment.',
      allowedMentions: { repliedUser: false },
    });
  }
}
