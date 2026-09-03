import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { NLContext, NLPlanResult } from '../../services/discord/types';
import { nlManager } from '../../services/discord/nl_manager';
import { PlanService } from '../../services/discord/plan';

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
  );

/**
 * Slash command handler for `/kosmo manage <instruction>`
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand(false);
  if (subcommand && subcommand !== 'manage') {
    return;
  }

  const instruction = interaction.options.getString('instruction', true);

  if (!instruction) {
    await interaction.reply({
      content: '❌ Please provide a natural language instruction to manage Discord.',
      ephemeral: true,
    });
    return;
  }

  // Extract roles safely
  const roles: string[] = [];
  if (interaction.member && 'roles' in interaction.member) {
    const memberRoles = interaction.member.roles;
    if (Array.isArray(memberRoles)) {
      roles.push(...memberRoles);
    } else if (typeof memberRoles === 'object' && 'cache' in memberRoles) {
      roles.push(...(memberRoles.cache as any).map((r: any) => r.name || r.id));
    }
  }

  const context: NLContext = {
    userId: interaction.user.id,
    username: interaction.user.username,
    roles,
    guildId: interaction.guildId ?? undefined,
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

  // Plan generated successfully (requires human confirmation)
  const formattedSummary = PlanService.formatPlanSummary(result.plan);

  const embed = new EmbedBuilder()
    .setTitle(`📋 Plan: ${result.plan.name}`)
    .setDescription(result.plan.description)
    .addFields(
      { name: 'Risk Level', value: `\`${result.plan.riskLevel}\``, inline: true },
      { name: 'Status', value: `\`${result.plan.status}\``, inline: true },
      { name: 'Actions Count', value: `${result.plan.actions.length}`, inline: true },
      {
        name: 'Proposed Actions',
        value: result.plan.actions
          .map((a, i) => `${i + 1}. **${a.type}**: \`${JSON.stringify(a.payload)}\``)
          .join('\n')
          .substring(0, 1024),
      }
    )
    .setFooter({
      text: 'Human Confirmation Required: Use /kosmo confirm or /kosmo cancel',
    })
    .setTimestamp();

  await interaction.editReply({
    content: `⚠️ **Plan Generated for Human Review** (ID: \`${result.plan.id}\`):\n${formattedSummary}\n\n*Execute with:* \`/kosmo confirm ${result.plan.id}\` | *Abort with:* \`/kosmo cancel ${result.plan.id}\``,
    embeds: [embed],
  });
}

export default execute;
