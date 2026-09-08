import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  ChannelType,
} from 'discord.js';
import { authorize, Category, extractUserRoleIds } from '../../../services/discord/policy';
import { validateModerationTargetSafety } from '../../../services/discord/permissionValidator';
import { moderationService } from '../../../services/moderation/moderationService';
import { getAuditRepository } from '../../../services/database/auditRepository';

/**
 * Handles the /mod warn command: issues a formal warning and creates a moderation case.
 */
export async function handleWarn(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: 'Command must be used in a guild.', ephemeral: true });
    return;
  }

  // 1. Centralized Policy Authorization
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

  // 2. Extract options
  const targetUser = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason', true);
  const evidence = interaction.options.getString('evidence') ?? undefined;

  // 3. Resolve target member
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

  // 4. Validate target safety & role hierarchy
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
      content: `❌ Cannot warn member: ${safetyResult.reason}`,
      ephemeral: true,
    });
    return;
  }

  // 5. Issue warning via moderationService
  const { caseRecord } = await moderationService.issueWarning({
    guildId: guild.id,
    targetId: targetMember.id,
    targetTag: targetMember.user?.tag || targetMember.id,
    moderatorId: interaction.user.id,
    moderatorTag: interaction.user.tag || interaction.user.username,
    reason,
    evidence,
  });

  // 6. Attempt DM delivery
  let dmSent = false;
  try {
    const dmEmbed = new EmbedBuilder()
      .setTitle(`⚠️ Warning Received — ${guild.name}`)
      .setColor(0xf39c12)
      .setDescription(`You have received an official warning from the staff of **${guild.name}**.`)
      .addFields(
        { name: 'Reason', value: reason, inline: false },
        { name: 'Case ID', value: `\`${caseRecord.caseId}\``, inline: true }
      )
      .setFooter({ text: 'Please review server rules to avoid escalation.' })
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
      actionType: 'MOD_WARN',
      actorId: interaction.user.id,
      targetId: targetMember.id,
      status: 'SUCCESS',
      metadata: {
        caseId: caseRecord.caseId,
        moderatorTag: interaction.user.tag || interaction.user.username,
        targetTag: targetMember.user?.tag || targetMember.id,
        reason,
        hasEvidence: !!evidence,
        dmSent,
      },
    });
  } catch (auditErr) {
    console.warn('[Audit] Failed to persist warn audit event to PostgreSQL:', auditErr);
  }

  // 7b. Structured audit log to #mod-logs
  const modLogsChannel = guild.channels?.cache?.find?.(
    (c: any) =>
      c.name?.toLowerCase() === 'mod-logs' &&
      (c.type === ChannelType.GuildText || typeof c.send === 'function')
  );

  if (modLogsChannel && typeof (modLogsChannel as any).send === 'function') {
    const logEmbed = new EmbedBuilder()
      .setTitle('🛡️ Member Warned')
      .setColor(0xf39c12)
      .addFields(
        { name: 'Case ID', value: `\`${caseRecord.caseId}\``, inline: true },
        { name: 'Target Member', value: `${targetMember.user?.tag || targetMember.id} (<@${targetMember.id}>)`, inline: false },
        { name: 'Moderator', value: `${interaction.user.tag || interaction.user.username} (<@${interaction.user.id}>)`, inline: false },
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

  // 8. Deliver confirmation to moderator
  const replyEmbed = new EmbedBuilder()
    .setTitle('⚠️ Member Warned')
    .setColor(0xf39c12)
    .setDescription(`Successfully issued a warning to **${targetMember.user?.tag || targetMember.id}**.`)
    .addFields(
      { name: 'Case ID', value: `\`${caseRecord.caseId}\``, inline: true },
      { name: 'Target', value: `<@${targetMember.id}>`, inline: true },
      { name: 'DM Notification', value: dmSent ? '✅ Delivered' : '⚠️ Blocked / Closed DMs', inline: true },
      { name: 'Reason', value: reason, inline: false }
    )
    .setFooter({ text: `Moderator: ${interaction.user.username}` })
    .setTimestamp();

  if (evidence) {
    replyEmbed.addFields({ name: 'Evidence', value: evidence, inline: false });
  }

  await interaction.reply({ embeds: [replyEmbed] });
}
