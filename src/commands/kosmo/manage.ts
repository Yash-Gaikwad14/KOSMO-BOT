import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
} from 'discord.js';
import { NLContext, NLPlanResult } from '../../services/discord/types';
import { nlManager } from '../../services/discord/nl_manager';
import { PlanService } from '../../services/discord/plan';
import { runAudit } from '../../services/discord/audit';
import { confirmAndExecutePlan, cancelPlan } from '../../services/discord/confirmation';
import { authorize, Category } from '../../services/discord/policy';
import type { AuditReport } from '../../types/audit';

export const data = new SlashCommandBuilder()
  .setName('kosmo')
  .setDescription('Kosmo Discord Bot Administration Commands')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('manage')
      .setDescription('Plan Discord infrastructure changes using Natural Language')
      .addStringOption((option) =>
        option
          .setName('instruction')
          .setDescription('The natural language instruction for Discord configuration')
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('audit')
      .setDescription('Run a read-only audit of the Discord server configuration')
  );

/**
 * Slash command handler for `/kosmo` commands (e.g. `/kosmo manage`, `/kosmo audit`)
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand(false);
  if (subcommand === 'audit') {
    return handleAudit(interaction);
  }
  if (subcommand && subcommand !== 'manage') {
    return;
  }

  // --- /kosmo manage handler ---
  const instruction = interaction.options.getString('instruction', true);

  if (!instruction) {
    await interaction.reply({
      content: '❌ Please provide a natural language instruction to manage Discord.',
      ephemeral: true,
    });
    return;
  }

  // Extract role IDs using centralized helper
  const userRoleIds = extractUserRoleIds(interaction.member);

  const context: NLContext = {
    userId: interaction.user.id,
    username: interaction.user.username,
    roles: userRoleIds,
    guildId: interaction.guildId ?? undefined,
    guildOwnerId: interaction.guild?.ownerId ?? undefined,
    channelId: interaction.channelId,
  };

  await interaction.deferReply({ ephemeral: false });

  const result: NLPlanResult = await nlManager.generatePlan(instruction, context);

  if (!result.success || !result.plan) {
    const errorMsg = result.error || result.explanation || 'Failed to generate plan.';
    await interaction.editReply({
      content: `❌ **NL Management Request Rejected**\n\n${errorMsg}`,
    });
    return;
  }

  // Store plan in pending store awaiting human confirmation
  PlanService.storePlan(result.plan);

  // Build Phase 3D Action Confirmation Embed
  const embed = new EmbedBuilder()
    .setTitle('⚠️ KOSMO ACTION CONFIRMATION')
    .setDescription(`**Action:** ${result.plan.name}\n${result.plan.description}`)
    .setColor(result.plan.riskLevel === 'HIGH' || result.plan.riskLevel === 'CRITICAL' ? 0xed4245 : 0xfee75c)
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

  // Create [Confirm] and [Cancel] interactive buttons
  const confirmButton = new ButtonBuilder()
    .setCustomId(`kosmo_confirm_${result.plan.id}`)
    .setLabel('Confirm')
    .setStyle(ButtonStyle.Danger);

  const cancelButton = new ButtonBuilder()
    .setCustomId(`kosmo_cancel_${result.plan.id}`)
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);

  await interaction.editReply({
    embeds: [embed],
    components: [row],
  });
}

/**
 * Helper to extract role IDs from a GuildMember or API interaction member
 */
export function extractUserRoleIds(member: any): string[] {
  const userRoleIds: string[] = [];
  if (member && 'roles' in member) {
    const memberRoles = member.roles;
    if (Array.isArray(memberRoles)) {
      userRoleIds.push(...memberRoles.map(String));
    } else if (typeof memberRoles === 'object' && 'cache' in memberRoles) {
      const cache = (memberRoles as any).cache;
      if (typeof cache?.map === 'function') {
        userRoleIds.push(...cache.map((r: any) => r.id || r));
      } else if (typeof cache?.values === 'function') {
        userRoleIds.push(...Array.from(cache.values()).map((r: any) => r.id || r));
      }
    }
  }
  return userRoleIds;
}

/**
 * Handler for Phase 3D interactive confirmation buttons [Confirm] and [Cancel]
 */
export async function handleConfirmationButton(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;
  const isConfirm = customId.startsWith('kosmo_confirm_');
  const isCancel = customId.startsWith('kosmo_cancel_');

  if (!isConfirm && !isCancel) return;

  // Guard against duplicate handling
  if (interaction.replied || interaction.deferred) return;

  const planId = isConfirm
    ? customId.replace('kosmo_confirm_', '')
    : customId.replace('kosmo_cancel_', '');

  if (!interaction.guild) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Confirmation can only be performed within a server.',
        ephemeral: true,
      });
    }
    return;
  }

  const userRoleIds = extractUserRoleIds(interaction.member);
  const context = {
    userId: interaction.user.id,
    guildOwnerId: interaction.guild.ownerId,
  };

  if (isCancel) {
    const result = cancelPlan(planId, userRoleIds, context);
    if (!result.success) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: `❌ ${result.message}`,
          ephemeral: true,
        });
      }
      return;
    }

    const cancelEmbed = new EmbedBuilder()
      .setTitle('🚫 KOSMO ACTION CANCELLED')
      .setDescription('Action cancelled. No changes were made.')
      .setColor(0x95a5a6)
      .setFooter({ text: `Cancelled by @${interaction.user.username} • No mutations performed` })
      .setTimestamp();

    if (!interaction.replied && !interaction.deferred) {
      await interaction.update({
        embeds: [cancelEmbed],
        components: [],
      });
    }
    return;
  }

  // isConfirm branch: Check plan existence and status before deferring
  const plan = PlanService.getPlan(planId);
  if (!plan) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: `❌ Plan "${planId}" not found or expired.`,
        ephemeral: true,
      });
    }
    return;
  }

  if (plan.status !== 'PROPOSED') {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: `❌ Plan "${planId}" has already been ${plan.status.toLowerCase()} and cannot be confirmed again.`,
        ephemeral: true,
      });
    }
    return;
  }

  // Check centralized authorization before deferring
  const authDecision = authorize(userRoleIds, Category.CONFIRM, context);

  if (authDecision === 'DENY') {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ You are not authorized to confirm this action.',
        ephemeral: true,
      });
    }
    return;
  }

  if (authDecision === 'REQUIRES_FOUNDERS_APPROVAL') {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '⚠️ Confirmation requires Founder or Team Kosmo approval.',
        ephemeral: true,
      });
    }
    return;
  }

  // Defer update immediately if supported to prevent 3-second timeout during Discord mutations
  if (typeof (interaction as any).deferUpdate === 'function' && !interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate();
  }

  // Execute plan mutations
  const result = await confirmAndExecutePlan(interaction.guild, planId, userRoleIds, context);

  if (!result.success) {
    const errorEmbed = new EmbedBuilder()
      .setTitle('❌ KOSMO ACTION FAILED')
      .setDescription(result.message)
      .setColor(0xed4245)
      .setTimestamp();

    if (interaction.deferred && typeof (interaction as any).editReply === 'function') {
      await interaction.editReply({
        embeds: [errorEmbed],
        components: [],
      });
    } else if (!interaction.replied) {
      await interaction.update({
        embeds: [errorEmbed],
        components: [],
      });
    }
    return;
  }

  const executedEmbed = new EmbedBuilder()
    .setTitle('✅ KOSMO ACTION CONFIRMED & EXECUTED')
    .setDescription(`**Action:** ${result.plan?.name ?? 'Plan'}\nAction confirmed and executed.`)
    .setColor(0x57f287)
    .addFields(
      { name: 'Status', value: '`EXECUTED`', inline: true },
      { name: 'Confirmed By', value: `<@${interaction.user.id}>`, inline: true },
      {
        name: 'Execution Results',
        value:
          result.executionResults && result.executionResults.length > 0
            ? result.executionResults.map((r, i) => `${i + 1}. ${r}`).join('\n').substring(0, 1024)
            : 'All actions completed successfully.',
      }
    )
    .setFooter({ text: 'Controlled Discord Execution Complete' })
    .setTimestamp();

  if (interaction.deferred && typeof (interaction as any).editReply === 'function') {
    await interaction.editReply({
      embeds: [executedEmbed],
      components: [],
    });
  } else if (!interaction.replied) {
    await interaction.update({
      embeds: [executedEmbed],
      components: [],
    });
  }
}

/**
 * Handler for `/kosmo audit` (strictly read-only)
 */
async function handleAudit(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: '❌ `/kosmo audit` can only be used within a server (guild).',
      ephemeral: true,
    });
    return;
  }

  // Extract user role IDs
  const userRoleIds = extractUserRoleIds(interaction.member);

  try {
    const report: AuditReport = await runAudit(interaction.guild, userRoleIds, interaction.user.id);

    const categoriesCount = report.channels.filter(
      (c) => c.type === '4' || c.type.includes('CATEGORY')
    ).length;
    const textCount = report.channels.filter(
      (c) => c.type === '0' || c.type.includes('TEXT')
    ).length;
    const voiceCount = report.channels.filter(
      (c) => c.type === '2' || c.type.includes('VOICE')
    ).length;
    const otherCount = report.channels.length - categoriesCount - textCount - voiceCount;

    const rolesSummary =
      report.roles.length > 0
        ? report.roles
            .slice(0, 10)
            .map((r) => r.name)
            .join(', ') +
          (report.roles.length > 10 ? ` *(+${report.roles.length - 10} more)*` : '')
        : 'None';

    const commandsSummary =
      report.commands.length > 0
        ? report.commands.map((c) => `\`/${c.name}\``).join(', ')
        : 'None';

    const embed = new EmbedBuilder()
      .setTitle('🔍 Kosmo Discord Audit Report [READ-ONLY]')
      .setDescription(
        `Strictly read-only audit snapshot for **${report.guild.name}**. No changes were made.`
      )
      .setColor(0x5865f2)
      .addFields(
        {
          name: 'Server Information',
          value: `**Name:** ${report.guild.name}\n**ID:** \`${report.guild.id}\``,
          inline: true,
        },
        {
          name: 'Resource Counts',
          value: `**Roles:** ${report.roles.length}\n**Channels:** ${report.channels.length}\n**Commands:** ${report.commands.length}`,
          inline: true,
        },
        {
          name: 'Desired-State Config',
          value: report.hasDesiredStateConfig
            ? '✅ Detected (`desiredState.json`)'
            : '⚠️ Not detected',
          inline: true,
        },
        {
          name: `Channels Breakdown (${report.channels.length})`,
          value: `📁 Categories: **${categoriesCount}** | 💬 Text: **${textCount}** | 🔊 Voice: **${voiceCount}**${
            otherCount > 0 ? ` | 📌 Other: **${otherCount}**` : ''
          }`,
        },
        {
          name: `Roles (${report.roles.length})`,
          value: rolesSummary.substring(0, 1024),
        },
        {
          name: `Registered Slash Commands (${report.commands.length})`,
          value: commandsSummary.substring(0, 1024),
        }
      )
      .setFooter({ text: 'Audit Mode: STRICTLY READ-ONLY • No mutations performed' })
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes('unauthorized')) {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: '❌ **Unauthorized:** You do not have permission to run a server audit.',
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: '❌ **Unauthorized:** You do not have permission to run a server audit.',
          ephemeral: true,
        });
      }
      return;
    }

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: `❌ **Audit Failed:** ${message}`,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: `❌ **Audit Failed:** ${message}`,
        ephemeral: true,
      });
    }
  }
}

export default execute;
