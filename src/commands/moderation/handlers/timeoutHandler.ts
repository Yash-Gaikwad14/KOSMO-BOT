import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  PermissionFlagsBits,
  ChannelType,
} from 'discord.js';
import { authorize, Category, extractUserRoleIds } from '../../../services/discord/policy';
import { validateModerationTargetSafety } from '../../../services/discord/permissionValidator';
import { runAction } from '../../../services/discord/actions';
import { moderationService } from '../../../services/moderation/moderationService';
import { getAuditRepository } from '../../../services/database/auditRepository';

/**
 * Handles the Phase 4D.1 /mod timeout command.
 */
export async function handleTimeout(interaction: ChatInputCommandInteraction): Promise<void> {
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

  // 2. Bot permission check: ModerateMembers
  const botMember =
    guild.members.me ??
    (typeof guild.members.fetchMe === 'function'
      ? await guild.members.fetchMe().catch(() => null)
      : null);
  const hasBotPerm =
    botMember &&
    (botMember.permissions?.has(PermissionFlagsBits.ModerateMembers) ||
      botMember.permissions?.has('ModerateMembers'));
  if (!hasBotPerm) {
    const msg = '❌ Bot lacks the "Moderate Members" (Timeout) permission.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: msg, ephemeral: true });
    } else {
      await interaction.reply({ content: msg, ephemeral: true });
    }
    return;
  }

  // 3. Centralized Policy Authorization check
  const callerRoles = extractUserRoleIds(interaction.member);
  const authDecision = authorize(callerRoles, Category.MODERATE, {
    userId: interaction.user.id,
    guildOwnerId: guild.ownerId,
  });

  if (authDecision !== 'ALLOW') {
    const msg = '❌ You are not authorized to use moderation commands.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: msg, ephemeral: true });
    } else {
      await interaction.reply({ content: msg, ephemeral: true });
    }
    return;
  }

  // 4. Extract and validate options
  const targetUser = interaction.options.getUser('user', true);
  const duration = interaction.options.getInteger('duration', true);
  const rawReason = interaction.options.getString('reason', true);
  const reason = rawReason ? rawReason.trim() : '';

  if (
    typeof duration !== 'number' ||
    duration < 1 ||
    duration > 10080 ||
    !Number.isInteger(duration)
  ) {
    const msg = '❌ Timeout duration must be an integer between 1 and 10080 minutes (7 days).';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: msg, ephemeral: true });
    } else {
      await interaction.reply({ content: msg, ephemeral: true });
    }
    return;
  }

  if (!reason) {
    const msg = '❌ A valid reason must be provided for the timeout.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: msg, ephemeral: true });
    } else {
      await interaction.reply({ content: msg, ephemeral: true });
    }
    return;
  }

  // 5. Resolve target member
  let targetMember = interaction.options.getMember('user') as GuildMember | null;
  if (!targetMember) {
    try {
      targetMember = await guild.members.fetch(targetUser.id);
    } catch {
      targetMember = null;
    }
  }

  if (!targetMember) {
    const msg = '❌ Member could not be found in this server.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: msg, ephemeral: true });
    } else {
      await interaction.reply({ content: msg, ephemeral: true });
    }
    return;
  }

  // 6. Resolve caller member and perform Target Safety & Role Hierarchy checks
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
    const msg = `❌ ${safetyResult.reason}`;
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: msg, ephemeral: true });
    } else {
      await interaction.reply({ content: msg, ephemeral: true });
    }
    return;
  }

  // 7. Execute centralized Discord mutation through actions.ts
  try {
    await runAction(guild, {
      type: 'timeoutMember',
      payload: {
        memberId: targetMember.id,
        durationMinutes: duration,
        reason,
      },
    });
  } catch (actionErr: any) {
    const msg = `❌ Timeout execution failed: ${actionErr?.message || 'Unknown error'}`;
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: msg, ephemeral: true });
    } else {
      await interaction.reply({ content: msg, ephemeral: true });
    }
    return;
  }

  // 8. Post-action verification
  let verifiedMember: GuildMember | null = targetMember;
  try {
    if (typeof guild.members.fetch === 'function') {
      verifiedMember = await guild.members
        .fetch({ user: targetMember.id, force: true })
        .catch(() => targetMember);
    }
  } catch {
    verifiedMember = targetMember;
  }

  const isTimedOut =
    typeof verifiedMember?.isCommunicationDisabled === 'function'
      ? verifiedMember.isCommunicationDisabled()
      : Boolean(
          verifiedMember?.communicationDisabledUntil &&
            verifiedMember.communicationDisabledUntil.getTime() > Date.now()
        );

  if (!isTimedOut || !verifiedMember?.communicationDisabledUntil) {
    const msg = '❌ Timeout verification failed: member does not have an active timeout.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: msg, ephemeral: true });
    } else {
      await interaction.reply({ content: msg, ephemeral: true });
    }
    return;
  }

  // Record moderation case
  let timeoutCaseRecord: any = null;
  try {
    timeoutCaseRecord = await moderationService.recordSanctionCase({
      guildId: guild.id,
      targetId: targetMember.id,
      targetTag: targetMember.user?.tag || targetMember.id,
      moderatorId: interaction.user.id,
      moderatorTag: interaction.user.tag || interaction.user.username,
      actionType: 'TIMEOUT',
      reason,
      sanctionApplied: `Timed out for ${duration} minute(s)`,
    });
  } catch (caseErr) {
    console.warn('Failed to record sanction case for timeout:', caseErr);
  }

  // 9. Audit logging: Durable PostgreSQL + Operational #mod-logs
  const untilSeconds = Math.floor(verifiedMember.communicationDisabledUntil.getTime() / 1000);

  // 9a. Durable PostgreSQL audit event (metadata-only, non-blocking)
  try {
    const auditRepo = getAuditRepository();
    await auditRepo.recordEvent({
      guildId: guild.id,
      actionType: 'MOD_TIMEOUT',
      actorId: interaction.user.id,
      targetId: targetMember.id,
      status: 'SUCCESS',
      metadata: {
        caseId: timeoutCaseRecord?.caseId,
        moderatorTag: interaction.user.tag || interaction.user.username,
        targetTag: targetMember.user?.tag || targetMember.id,
        durationMinutes: duration,
        expiresAt: verifiedMember.communicationDisabledUntil.toISOString(),
        reason,
      },
    });
  } catch (auditErr) {
    console.warn('[Audit] Failed to persist timeout audit event to PostgreSQL:', auditErr);
  }

  // 9b. Structured audit logging to #mod-logs (if exists)
  const modLogsChannel = guild.channels?.cache?.find?.(
    (c: any) =>
      c.name?.toLowerCase() === 'mod-logs' &&
      (c.type === ChannelType.GuildText || typeof c.send === 'function')
  );

  if (modLogsChannel && typeof (modLogsChannel as any).send === 'function') {
    const logEmbed = new EmbedBuilder()
      .setTitle('🛡️ Member Timed Out')
      .setColor(0xe67e22)
      .addFields(
        {
          name: 'Target Member',
          value: `${targetMember.user?.tag || targetMember.id} (<@${targetMember.id}>)`,
          inline: false,
        },
        {
          name: 'Moderator',
          value: `${interaction.user.tag || interaction.user.username} (<@${interaction.user.id}>)`,
          inline: false,
        },
        { name: 'Duration', value: `${duration} minute(s)`, inline: true },
        {
          name: 'Expires At',
          value: `<t:${untilSeconds}:F> (<t:${untilSeconds}:R>)`,
          inline: true,
        },
        { name: 'Reason', value: reason, inline: false }
      )
      .setTimestamp();

    if (timeoutCaseRecord) {
      logEmbed.addFields({ name: 'Case ID', value: `\`${timeoutCaseRecord.caseId}\``, inline: true });
    }

    try {
      await (modLogsChannel as any).send({ embeds: [logEmbed] });
    } catch (logErr) {
      console.warn('Failed to send audit log to #mod-logs:', logErr);
    }
  }

  // 10. Deliver response embed to moderator
  const responseEmbed = new EmbedBuilder()
    .setTitle('⏳ Member Timed Out')
    .setColor(0xe67e22)
    .setDescription(
      `Successfully timed out **${targetMember.user?.tag || targetMember.displayName || targetMember.id}**.`
    )
    .addFields(
      { name: 'Target', value: `<@${targetMember.id}>`, inline: true },
      { name: 'Duration', value: `${duration} minute(s)`, inline: true },
      { name: 'Expires', value: `<t:${untilSeconds}:R>`, inline: true },
      { name: 'Reason', value: reason, inline: false }
    )
    .setFooter({ text: `Moderator: ${interaction.user.username}` })
    .setTimestamp();

  if (timeoutCaseRecord) {
    responseEmbed.addFields({ name: 'Case ID', value: `\`${timeoutCaseRecord.caseId}\``, inline: true });
  }

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ embeds: [responseEmbed] });
  } else {
    await interaction.reply({ embeds: [responseEmbed] });
  }
}
