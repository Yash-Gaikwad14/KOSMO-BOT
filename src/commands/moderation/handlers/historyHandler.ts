import {
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { authorize, Category, extractUserRoleIds } from '../../../services/discord/policy';
import { moderationService } from '../../../services/moderation/moderationService';

/**
 * Handles the /mod history command: displays complete moderation history and active strikes.
 */
export async function handleHistory(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: 'Command must be used in a guild.', ephemeral: true });
    return;
  }

  // Authorization check
  const callerRoles = extractUserRoleIds(interaction.member);
  const authDecision = authorize(callerRoles, Category.MODERATE, {
    userId: interaction.user.id,
    guildOwnerId: guild.ownerId,
  });

  if (authDecision !== 'ALLOW') {
    await interaction.reply({
      content: '❌ You are not authorized to use moderation commands.',
      ephemeral: true,
    });
    return;
  }

  const targetUser = interaction.options.getUser('user', true);
  const history = await moderationService.getModerationHistory(guild.id, targetUser.id);

  const historyEmbed = new EmbedBuilder()
    .setTitle(`📋 Moderation History — ${targetUser.tag || targetUser.username}`)
    .setColor(history.activeStrikes >= 3 ? 0xed4245 : history.activeStrikes > 0 ? 0xf39c12 : 0x2ecc71)
    .setDescription(`Record for <@${targetUser.id}> (\`${targetUser.id}\`)`)
    .addFields(
      { name: 'Active Strikes', value: `\`${history.activeStrikes} / 3\``, inline: true },
      { name: 'Total Cases', value: `\`${history.totalCases}\``, inline: true }
    )
    .setFooter({ text: 'Staff-Only View • Moderation history is confidential.' })
    .setTimestamp();

  if (history.cases.length === 0) {
    historyEmbed.addFields({ name: 'History', value: 'Clean record. No moderation cases found.', inline: false });
  } else {
    const caseLines = history.cases.slice(0, 10).map((c) => {
      const date = `<t:${Math.floor(c.createdAt.getTime() / 1000)}:d>`;
      return `• \`${c.caseId}\` [**${c.actionType}**] (${date}) — ${c.reason} *(by <@${c.moderatorId}>)*`;
    });
    historyEmbed.addFields({
      name: `Recent Cases (${Math.min(10, history.cases.length)} of ${history.totalCases})`,
      value: caseLines.join('\n'),
      inline: false,
    });
  }

  await interaction.reply({ embeds: [historyEmbed], ephemeral: true });
}

/**
 * Handles the /mod case command: displays complete case details.
 */
export async function handleCase(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: 'Command must be used in a guild.', ephemeral: true });
    return;
  }

  // Authorization check
  const callerRoles = extractUserRoleIds(interaction.member);
  const authDecision = authorize(callerRoles, Category.MODERATE, {
    userId: interaction.user.id,
    guildOwnerId: guild.ownerId,
  });

  if (authDecision !== 'ALLOW') {
    await interaction.reply({
      content: '❌ You are not authorized to use moderation commands.',
      ephemeral: true,
    });
    return;
  }

  const caseId = interaction.options.getString('case_id', true).trim();
  const caseRecord = await moderationService.getCaseById(guild.id, caseId);

  if (!caseRecord) {
    await interaction.reply({
      content: `❌ Case \`${caseId}\` was not found in this server.`,
      ephemeral: true,
    });
    return;
  }

  const caseEmbed = new EmbedBuilder()
    .setTitle(`📁 Case Details — ${caseRecord.caseId}`)
    .setColor(0x3498db)
    .addFields(
      { name: 'Case ID', value: `\`${caseRecord.caseId}\``, inline: true },
      { name: 'Action', value: `\`${caseRecord.actionType}\``, inline: true },
      { name: 'Status', value: `\`${caseRecord.status}\``, inline: true },
      { name: 'Target', value: `<@${caseRecord.targetId}> (\`${caseRecord.targetTag}\`)`, inline: true },
      { name: 'Moderator', value: `<@${caseRecord.moderatorId}> (\`${caseRecord.moderatorTag}\`)`, inline: true },
      { name: 'Created At', value: `<t:${Math.floor(caseRecord.createdAt.getTime() / 1000)}:F>`, inline: true },
      { name: 'Reason', value: caseRecord.reason, inline: false }
    )
    .setFooter({ text: 'Staff-Only View • Confidential Moderation Case' })
    .setTimestamp();

  if (caseRecord.evidence) {
    caseEmbed.addFields({ name: 'Evidence', value: caseRecord.evidence, inline: false });
  }

  if (caseRecord.sanctionApplied) {
    caseEmbed.addFields({ name: 'Sanction Applied', value: caseRecord.sanctionApplied, inline: true });
  }

  if (caseRecord.resolutionNotes) {
    caseEmbed.addFields({ name: 'Resolution Notes', value: caseRecord.resolutionNotes, inline: false });
  }

  await interaction.reply({ embeds: [caseEmbed], ephemeral: true });
}
