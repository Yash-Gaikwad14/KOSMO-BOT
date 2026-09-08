import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  ChannelType,
} from 'discord.js';
import { authorize, Category, extractUserRoleIds } from '../../../services/discord/policy';
import { validateModerationTargetSafety } from '../../../services/discord/permissionValidator';
import { moderationService } from '../../../services/moderation/moderationService';
import { CaseSeverity } from '../../../types/moderation';
import { getAuditRepository } from '../../../services/database/auditRepository';

/**
 * Handles the /mod strike command: issues an infraction strike and displays policy escalation recommendation.
 */
export async function handleStrike(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: 'Command must be used in a guild.', ephemeral: true });
    return;
  }

  // 1. Authorization
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

  // 2. Options
  const targetUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason', true);
  const evidence = interaction.options.getString('evidence') ?? undefined;
  const severity = (interaction.options.getString('severity') as CaseSeverity) || 'MEDIUM';

  // 3. Resolve target
  let targetMember: GuildMember | null = null;
  try {
    targetMember = await guild.members.fetch(targetUser.id);
  } catch {
    targetMember = null;
  }

  if (!targetMember) {
    await interaction.reply({
      content: '❌ Target user is not a member of this server.',
      ephemeral: true,
    });
    return;
  }

  // 4. Safety & hierarchy check
  let callerMember = interaction.member as GuildMember | null;
  if (!callerMember || !(callerMember as any).roles) {
    try {
      callerMember = await guild.members.fetch(interaction.user.id);
    } catch {
      callerMember = null;
    }
  }

  const safetyResult = validateModerationTargetSafety(
    guild,
    callerMember || (interaction.member as any),
    targetMember
  );

  if (!safetyResult.safe) {
    await interaction.reply({
      content: `❌ Cannot strike member: ${safetyResult.reason}`,
      ephemeral: true,
    });
    return;
  }

  // 5. Issue strike
  const { caseRecord, activeStrikeCount, recommendation } = await moderationService.issueStrike({
    guildId: guild.id,
    targetId: targetMember.id,
    targetTag: targetMember.user?.tag || targetMember.id,
    moderatorId: interaction.user.id,
    moderatorTag: interaction.user.tag || interaction.user.username,
    reason,
    evidence,
    severity,
  });

  // 6. DM target member
  let dmSent = false;
  try {
    const dmEmbed = new EmbedBuilder()
      .setTitle(`🚨 Infraction Strike Recorded — ${guild.name}`)
      .setColor(0xe74c3c)
      .setDescription(
        `You have received an infraction strike in **${guild.name}**.\nActive strikes on your account: **${activeStrikeCount} / 3**.`
      )
      .addFields(
        { name: 'Reason', value: reason, inline: false },
        { name: 'Case ID', value: `\`${caseRecord.caseId}\``, inline: true }
      )
      .setFooter({ text: 'Continued infractions will escalate towards a temporary timeout or permanent ban.' })
      .setTimestamp();

    await targetMember.send({ embeds: [dmEmbed] });
    dmSent = true;
  } catch {
    dmSent = false;
  }

  // 7. Audit logging: Durable PostgreSQL + Operational #mod-logs
  // 7a. Durable PostgreSQL audit event (metadata-only, non-blocking)
  try {
    const auditRepo = getAuditRepository();
    await auditRepo.recordEvent({
      guildId: guild.id,
      actionType: 'MOD_STRIKE',
      actorId: interaction.user.id,
      targetId: targetMember.id,
      status: 'SUCCESS',
      metadata: {
        caseId: caseRecord.caseId,
        moderatorTag: interaction.user.tag || interaction.user.username,
        targetTag: targetMember.user?.tag || targetMember.id,
        activeStrikeCount,
        severity,
        reason,
        hasEvidence: !!evidence,
        dmSent,
      },
    });
  } catch (auditErr) {
    console.warn('[Audit] Failed to persist strike audit event to PostgreSQL:', auditErr);
  }

  // 7b. Structured audit log to #mod-logs
  const modLogsChannel = guild.channels?.cache?.find?.(
    (c: any) =>
      c.name?.toLowerCase() === 'mod-logs' &&
      (c.type === ChannelType.GuildText || typeof c.send === 'function')
  );

  if (modLogsChannel && typeof (modLogsChannel as any).send === 'function') {
    const logEmbed = new EmbedBuilder()
      .setTitle('🛡️ Member Struck')
      .setColor(0xe74c3c)
      .addFields(
        { name: 'Case ID', value: `\`${caseRecord.caseId}\``, inline: true },
        { name: 'Target Member', value: `${targetMember.user?.tag || targetMember.id} (<@${targetMember.id}>)`, inline: false },
        { name: 'Moderator', value: `${interaction.user.tag || interaction.user.username} (<@${interaction.user.id}>)`, inline: false },
        { name: 'Active Strikes', value: `\`${activeStrikeCount} / 3\``, inline: true },
        { name: 'Severity', value: severity, inline: true },
        { name: 'Policy Recommendation', value: recommendation.explanation, inline: false },
        { name: 'Reason', value: reason, inline: false }
      )
      .setTimestamp();

    if (evidence) {
      logEmbed.addFields({ name: 'Evidence', value: evidence, inline: false });
    }

    try {
      await (modLogsChannel as any).send({ embeds: [logEmbed] });
    } catch (logErr) {
      console.warn('Failed to send audit log to #mod-logs:', logErr);
    }
  }

  // 8. Reply to moderator
  const replyEmbed = new EmbedBuilder()
    .setTitle('⚡ Member Struck')
    .setColor(0xe74c3c)
    .setDescription(`Successfully recorded strike against **${targetMember.user?.tag || targetMember.id}**.`)
    .addFields(
      { name: 'Case ID', value: `\`${caseRecord.caseId}\``, inline: true },
      { name: 'Target', value: `<@${targetMember.id}>`, inline: true },
      { name: 'Active Strikes', value: `**${activeStrikeCount} / 3**`, inline: true },
      { name: 'Policy Escalation Recommendation', value: `${recommendation.explanation}\n*${recommendation.commandHint}*`, inline: false },
      { name: '⚠️ Important Notice', value: 'Policy recommendations are NOT executed automatically. Staff must explicitly decide and run the recommended command if deemed appropriate.', inline: false },
      { name: 'Reason', value: reason, inline: false }
    )
    .setFooter({ text: `Moderator: ${interaction.user.username} • DM: ${dmSent ? 'Sent' : 'Blocked'}` })
    .setTimestamp();

  if (evidence) {
    replyEmbed.addFields({ name: 'Evidence', value: evidence, inline: false });
  }

  await interaction.reply({ embeds: [replyEmbed] });
}
