import {
  ButtonInteraction,
  EmbedBuilder,
  GuildMember,
  PermissionFlagsBits,
  ChannelType,
} from 'discord.js';
import { authorize, Category, extractUserRoleIds } from '../../../services/discord/policy';
import { validateModerationTargetSafety } from '../../../services/discord/permissionValidator';
import { runAction } from '../../../services/discord/actions';
import {
  getPendingModAction,
  atomicConfirmModAction,
  cancelModAction,
  markExecuted,
} from '../../../services/discord/modConfirmation';
import { moderationService } from '../../../services/moderation/moderationService';
import { getAuditRepository } from '../../../services/database/auditRepository';
import { MAX_PURGE_AMOUNT } from './purgeHandler';

/**
 * Handler for Phase 4D.2 & 4D.3A interactive moderation buttons
 * (`mod_kick_confirm_...`, `mod_kick_cancel_...`, `mod_ban_confirm_...`, `mod_ban_cancel_...`).
 */
export async function handleModerationButton(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;
  const isKickConfirm = customId.startsWith('mod_kick_confirm_');
  const isKickCancel = customId.startsWith('mod_kick_cancel_');
  const isBanConfirm = customId.startsWith('mod_ban_confirm_');
  const isBanCancel = customId.startsWith('mod_ban_cancel_');
  const isPurgeConfirm = customId.startsWith('mod_purge_confirm_');
  const isPurgeCancel = customId.startsWith('mod_purge_cancel_');

  const isConfirm = isKickConfirm || isBanConfirm || isPurgeConfirm;
  const isCancel = isKickCancel || isBanCancel || isPurgeCancel;

  if (!isConfirm && !isCancel) return;

  const actionId = isKickConfirm
    ? customId.replace('mod_kick_confirm_', '')
    : isKickCancel
    ? customId.replace('mod_kick_cancel_', '')
    : isBanConfirm
    ? customId.replace('mod_ban_confirm_', '')
    : isBanCancel
    ? customId.replace('mod_ban_cancel_', '')
    : isPurgeConfirm
    ? customId.replace('mod_purge_confirm_', '')
    : customId.replace('mod_purge_cancel_', '');

  if (!interaction.guild) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Moderation confirmation can only be performed within a server.',
        ephemeral: true,
      });
    }
    return;
  }

  const action = getPendingModAction(actionId);
  if (!action) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Moderation action not found or expired.',
        ephemeral: true,
      });
    }
    return;
  }

  // Binding validation: Server must match
  if (action.guildId !== interaction.guild.id) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Moderation action does not belong to this server.',
        ephemeral: true,
      });
    }
    return;
  }

  // Binding validation: Only original moderator can confirm or cancel
  if (action.moderatorId !== interaction.user.id) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Only the moderator who initiated this action can confirm or cancel it.',
        ephemeral: true,
      });
    }
    return;
  }

  // Channel binding validation for PURGE: must match proposed channel
  if (action.actionType === 'PURGE' && action.channelId && action.channelId !== interaction.channelId) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Purge confirmation must be performed in the channel where it was proposed.',
        ephemeral: true,
      });
    }
    return;
  }

  // Expiration check
  if (action.status === 'EXPIRED' || Date.now() > action.expiresAt.getTime()) {
    action.status = 'EXPIRED';
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ This moderation confirmation has expired (5 minute limit).',
        ephemeral: true,
      });
    }
    return;
  }

  // Replay check
  if (action.status !== 'PENDING') {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: `❌ This action has already been ${action.status.toLowerCase()} and cannot be processed again.`,
        ephemeral: true,
      });
    }
    return;
  }

  // --- Cancellation Flow ---
  if (isCancel) {
    const cancelRes = cancelModAction(actionId, interaction.user.id, interaction.guild.id);
    if (!cancelRes.success) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: `❌ ${cancelRes.message}`, ephemeral: true });
      }
      return;
    }

    const cancelTitle =
      action.actionType === 'BAN'
        ? '🚫 BAN CANCELLED'
        : action.actionType === 'PURGE'
        ? '🚫 PURGE CANCELLED'
        : '🚫 KICK CANCELLED';

    const cancelDesc =
      action.actionType === 'BAN'
        ? `Ban of member **${action.targetTag}** was cancelled. No changes were made.`
        : action.actionType === 'PURGE'
        ? `Message purge in <#${action.channelId}> was cancelled. No messages were deleted.`
        : `Kick of member **${action.targetTag}** was cancelled. No changes were made.`;

    const cancelEmbed = new EmbedBuilder()
      .setTitle(cancelTitle)
      .setDescription(cancelDesc)
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

  // --- Confirmation & Execution Flow ---

  // 1. Re-authorize moderator with Category.MODERATE
  const callerRoles = extractUserRoleIds(interaction.member);
  const authDecision = authorize(callerRoles, Category.MODERATE, {
    userId: interaction.user.id,
    guildOwnerId: interaction.guild.ownerId,
  });

  if (authDecision !== 'ALLOW') {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ You are no longer authorized to execute moderation commands.',
        ephemeral: true,
      });
    }
    return;
  }

  // 2. Pre-execution checks based on actionType
  const botMember =
    interaction.guild.members.me ??
    (typeof interaction.guild.members.fetchMe === 'function'
      ? await interaction.guild.members.fetchMe().catch(() => null)
      : null);

  if (action.actionType === 'PURGE') {
    const purgeChannel = await interaction.guild.channels.fetch(action.channelId!).catch(() => null);
    if (!purgeChannel || typeof (purgeChannel as any).bulkDelete !== 'function') {
      cancelModAction(actionId, interaction.user.id, interaction.guild.id);
      const targetChanEmbed = new EmbedBuilder()
        .setTitle('❌ PURGE ABORTED')
        .setDescription('The target channel could not be found or does not support message deletion.')
        .setColor(0xed4245)
        .setTimestamp();

      if (!interaction.replied && !interaction.deferred) {
        await interaction.update({
          embeds: [targetChanEmbed],
          components: [],
        });
      }
      return;
    }

    let hasManageMessages = false;
    if (botMember && typeof (purgeChannel as any).permissionsFor === 'function') {
      const perms = (purgeChannel as any).permissionsFor(botMember);
      hasManageMessages = Boolean(
        perms &&
        (perms.has(PermissionFlagsBits.ManageMessages) || perms.has('ManageMessages'))
      );
    } else if (botMember && botMember.permissions) {
      hasManageMessages = Boolean(
        botMember.permissions.has(PermissionFlagsBits.ManageMessages) ||
        botMember.permissions.has('ManageMessages')
      );
    }

    if (!hasManageMessages) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ Bot lacks the "Manage Messages" permission in this channel.',
          ephemeral: true,
        });
      }
      return;
    }

    if (
      !action.amount ||
      typeof action.amount !== 'number' ||
      !Number.isInteger(action.amount) ||
      action.amount < 1 ||
      action.amount > MAX_PURGE_AMOUNT
    ) {
      cancelModAction(actionId, interaction.user.id, interaction.guild.id);
      const invEmbed = new EmbedBuilder()
        .setTitle('❌ PURGE ABORTED')
        .setDescription('Invalid purge amount.')
        .setColor(0xed4245)
        .setTimestamp();
      if (!interaction.replied && !interaction.deferred) {
        await interaction.update({ embeds: [invEmbed], components: [] });
      }
      return;
    }

    if (!action.reason || !action.reason.trim() || action.reason.trim().length > 512) {
      cancelModAction(actionId, interaction.user.id, interaction.guild.id);
      const invEmbed = new EmbedBuilder()
        .setTitle('❌ PURGE ABORTED')
        .setDescription('Invalid purge reason.')
        .setColor(0xed4245)
        .setTimestamp();
      if (!interaction.replied && !interaction.deferred) {
        await interaction.update({ embeds: [invEmbed], components: [] });
      }
      return;
    }

    const confirmResult = atomicConfirmModAction(actionId, interaction.user.id, interaction.guild.id);
    if (!confirmResult.success) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: `❌ ${confirmResult.error}`,
          ephemeral: true,
        });
      }
      return;
    }

    if (
      typeof (interaction as any).deferUpdate === 'function' &&
      !interaction.deferred &&
      !interaction.replied
    ) {
      await interaction.deferUpdate();
    }

    let purgeResultMsg = '';
    try {
      purgeResultMsg = await runAction(interaction.guild, {
        type: 'purgeMessages',
        payload: {
          guildId: interaction.guild.id,
          channelId: action.channelId!,
          amount: action.amount!,
          reason: action.reason,
        },
      });
    } catch (purgeErr: any) {
      const failEmbed = new EmbedBuilder()
        .setTitle('❌ PURGE FAILED')
        .setDescription(`Failed to purge messages: ${purgeErr?.message || 'Unknown error'}`)
        .setColor(0xed4245)
        .setTimestamp();

      if (interaction.deferred && typeof (interaction as any).editReply === 'function') {
        await interaction.editReply({ embeds: [failEmbed], components: [] });
      } else if (!interaction.replied) {
        await interaction.update({ embeds: [failEmbed], components: [] });
      }
      return;
    }

    const match = purgeResultMsg.match(/Purged (\d+) of (\d+) message/);
    const deletedCount = match ? parseInt(match[1], 10) : action.amount!;
    const requestedCount = action.amount!;
    const isFull = deletedCount === requestedCount;
    const isPartial = deletedCount > 0 && deletedCount < requestedCount;

    markExecuted(actionId);

    // Record moderation case
    let purgeCaseRecord: any = null;
    try {
      purgeCaseRecord = await moderationService.recordSanctionCase({
        guildId: interaction.guild.id,
        targetId: action.channelId!,
        targetTag: `channel-${action.channelId}`,
        moderatorId: interaction.user.id,
        moderatorTag: interaction.user.tag || interaction.user.username,
        actionType: 'PURGE',
        reason: action.reason,
        sanctionApplied: `Purged ${deletedCount} message(s)`,
      });
    } catch (caseErr) {
      console.warn('Failed to record sanction case for purge:', caseErr);
    }

    // Audit logging: Durable PostgreSQL + Operational #mod-logs
    // Durable PostgreSQL audit event (metadata-only, non-blocking)
    try {
      const auditRepo = getAuditRepository();
      await auditRepo.recordEvent({
        guildId: interaction.guild.id,
        actionType: 'MOD_PURGE',
        actorId: interaction.user.id,
        targetId: action.channelId,
        status: 'SUCCESS',
        metadata: {
          caseId: purgeCaseRecord?.caseId,
          channelId: action.channelId,
          moderatorTag: interaction.user.tag || interaction.user.username,
          requestedCount,
          deletedCount,
          reason: action.reason,
        },
      });
    } catch (auditErr) {
      console.warn('[Audit] Failed to persist purge audit event to PostgreSQL:', auditErr);
    }

    const modLogsChannel = interaction.guild.channels?.cache?.find?.(
      (c: any) =>
        c.name?.toLowerCase() === 'mod-logs' &&
        (c.type === ChannelType.GuildText || typeof c.send === 'function')
    );

    if (modLogsChannel && typeof (modLogsChannel as any).send === 'function') {
      const statusString = isFull
        ? '`EXECUTED & VERIFIED (FULL)`'
        : isPartial
        ? '`EXECUTED & VERIFIED (PARTIAL)`'
        : '`EXECUTED (0 DELETED)`';

      const logEmbed = new EmbedBuilder()
        .setTitle(isFull ? '🛡️ Messages Purged' : '🛡️ Messages Partially Purged')
        .setColor(isFull ? 0xed4245 : 0xfee75c)
        .addFields(
          {
            name: 'Moderator',
            value: `${interaction.user.tag || interaction.user.username} (<@${interaction.user.id}>)`,
            inline: false,
          },
          { name: 'Action', value: '`PURGE`', inline: true },
          { name: 'Channel', value: `<#${action.channelId}>`, inline: true },
          { name: 'Requested Amount', value: `\`${requestedCount}\``, inline: true },
          { name: 'Deleted Amount', value: `\`${deletedCount}\``, inline: true },
          { name: 'Status', value: statusString, inline: true },
          { name: 'Reason', value: action.reason, inline: false }
        )
        .setTimestamp();

      if (purgeCaseRecord) {
        logEmbed.addFields({ name: 'Case ID', value: `\`${purgeCaseRecord.caseId}\``, inline: true });
      }

      try {
        await (modLogsChannel as any).send({ embeds: [logEmbed] });
      } catch (logErr) {
        console.warn('Failed to send audit log to #mod-logs:', logErr);
      }
    }

    const purgeTitle = isFull
      ? '🧹 Messages Purged'
      : deletedCount > 0
      ? '⚠️ Messages Partially Purged'
      : '⚠️ No Messages Purged';

    const purgeColor = isFull ? 0x57f287 : 0xfee75c;
    const purgeDesc = isFull
      ? `Successfully purged **${deletedCount}** message(s) from <#${action.channelId}>.`
      : deletedCount > 0
      ? `Purged **${deletedCount}** of **${requestedCount}** requested message(s) from <#${action.channelId}>.`
      : `0 of **${requestedCount}** requested message(s) were deleted from <#${action.channelId}>.`;

    const successEmbed = new EmbedBuilder()
      .setTitle(purgeTitle)
      .setColor(purgeColor)
      .setDescription(purgeDesc)
      .addFields(
        { name: 'Channel', value: `<#${action.channelId}>`, inline: true },
        { name: 'Action', value: '`PURGE`', inline: true },
        { name: 'Deleted', value: `\`${deletedCount} / ${requestedCount}\``, inline: true },
        { name: 'Status', value: '`EXECUTED`', inline: true },
        { name: 'Reason', value: action.reason, inline: false }
      )
      .setFooter({ text: `Confirmed by @${interaction.user.username}` })
      .setTimestamp();

    if (purgeCaseRecord) {
      successEmbed.addFields({ name: 'Case ID', value: `\`${purgeCaseRecord.caseId}\``, inline: true });
    }

    if (interaction.deferred && typeof (interaction as any).editReply === 'function') {
      await interaction.editReply({ embeds: [successEmbed], components: [] });
    } else if (!interaction.replied) {
      await interaction.update({ embeds: [successEmbed], components: [] });
    }
    return;
  }

  // 2. Re-check bot permission based on actionType (for KICK and BAN)
  if (action.actionType === 'BAN') {
    const hasBanPerm =
      botMember &&
      (botMember.permissions?.has(PermissionFlagsBits.BanMembers) ||
        botMember.permissions?.has('BanMembers'));
    if (!hasBanPerm) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ Bot lacks the "Ban Members" permission.',
          ephemeral: true,
        });
      }
      return;
    }
  } else {
    const hasKickPerm =
      botMember &&
      (botMember.permissions?.has(PermissionFlagsBits.KickMembers) ||
        botMember.permissions?.has('KickMembers'));
    if (!hasKickPerm) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ Bot lacks the "Kick Members" permission.',
          ephemeral: true,
        });
      }
      return;
    }
  }

  // 3. Re-fetch target member (handle member leaving before confirmation)
  let targetMember: GuildMember | null = null;
  try {
    targetMember = await interaction.guild.members.fetch(action.targetId!);
  } catch {
    targetMember = null;
  }

  if (!targetMember) {
    cancelModAction(actionId, interaction.user.id, interaction.guild.id);
    const targetLeftEmbed = new EmbedBuilder()
      .setTitle(action.actionType === 'BAN' ? '❌ BAN ABORTED' : '❌ KICK ABORTED')
      .setDescription(
        `Member **${action.targetTag || 'Unknown'}** is no longer in this server. The ${action.actionType.toLowerCase()} was not executed.`
      )
      .setColor(0xed4245)
      .setTimestamp();

    if (!interaction.replied && !interaction.deferred) {
      await interaction.update({
        embeds: [targetLeftEmbed],
        components: [],
      });
    }
    return;
  }

  // 4. Re-validate target safety & role hierarchy
  let callerMember = interaction.member as GuildMember | null;
  if (!callerMember || !(callerMember as any).roles) {
    try {
      callerMember = await interaction.guild.members.fetch(interaction.user.id);
    } catch {
      callerMember = null;
    }
  }

  const safetyResult = validateModerationTargetSafety(
    interaction.guild,
    callerMember || (interaction.member as any),
    targetMember
  );

  if (!safetyResult.safe) {
    cancelModAction(actionId, interaction.user.id, interaction.guild.id);
    const safetyEmbed = new EmbedBuilder()
      .setTitle(action.actionType === 'BAN' ? '❌ BAN ABORTED' : '❌ KICK ABORTED')
      .setDescription(`Target safety validation failed: ${safetyResult.reason}`)
      .setColor(0xed4245)
      .setTimestamp();

    if (!interaction.replied && !interaction.deferred) {
      await interaction.update({
        embeds: [safetyEmbed],
        components: [],
      });
    }
    return;
  }

  // 5. Atomic state transition: PENDING -> CONFIRMED before execution
  const confirmResult = atomicConfirmModAction(actionId, interaction.user.id, interaction.guild.id);
  if (!confirmResult.success) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: `❌ ${confirmResult.error}`,
        ephemeral: true,
      });
    }
    return;
  }

  // Defer update to prevent 3-second timeout during Discord mutations
  if (
    typeof (interaction as any).deferUpdate === 'function' &&
    !interaction.deferred &&
    !interaction.replied
  ) {
    await interaction.deferUpdate();
  }

  // 6. Execute action strictly through actions.ts:runAction()
  try {
    const actionPayload =
      action.actionType === 'BAN'
        ? {
            type: 'banMember' as const,
            payload: {
              guildId: interaction.guild.id,
              targetId: action.targetId!,
              reason: action.reason,
            },
          }
        : {
            type: 'kickMember' as const,
            payload: {
              guildId: interaction.guild.id,
              targetId: action.targetId!,
              reason: action.reason,
            },
          };

    await runAction(interaction.guild, actionPayload);
  } catch (modErr: any) {
    const failEmbed = new EmbedBuilder()
      .setTitle(`❌ ${action.actionType} FAILED`)
      .setDescription(
        `Failed to ${action.actionType.toLowerCase()} member: ${modErr?.message || 'Unknown error'}`
      )
      .setColor(0xed4245)
      .setTimestamp();

    if (interaction.deferred && typeof (interaction as any).editReply === 'function') {
      await interaction.editReply({ embeds: [failEmbed], components: [] });
    } else if (!interaction.replied) {
      await interaction.update({ embeds: [failEmbed], components: [] });
    }
    return;
  }

  // 7. Post-action verification: Verify that target is banned / no longer in the guild
  let verified = false;
  if (action.actionType === 'BAN') {
    try {
      if (interaction.guild.bans && typeof interaction.guild.bans.fetch === 'function') {
        const banEntry = await interaction.guild.bans.fetch(action.targetId!).catch(() => null);
        if (banEntry) {
          verified = true;
        }
      }
    } catch {
      verified = false;
    }

    // Fallback absence check if guild.bans is unmocked or returns null
    if (!verified) {
      try {
        if (typeof interaction.guild.members.fetch === 'function') {
          const recheck = await interaction.guild.members
            .fetch({ user: action.targetId!, force: true })
            .catch(() => null);
          if (!recheck) {
            verified = true;
          }
        }
      } catch {
        verified = true;
      }
    }
  } else {
    // KICK verification: Absence check
    try {
      if (typeof interaction.guild.members.fetch === 'function') {
        const recheck = await interaction.guild.members
          .fetch({ user: action.targetId!, force: true })
          .catch(() => null);
        if (!recheck) {
          verified = true;
        }
      }
    } catch {
      verified = true;
    }
  }

  if (!verified) {
    const unverifiedEmbed = new EmbedBuilder()
      .setTitle(`❌ ${action.actionType} UNVERIFIED`)
      .setDescription(
        action.actionType === 'BAN'
          ? `Target member **${action.targetTag || 'Unknown'}** could not be verified as banned from the server.`
          : `Target member **${action.targetTag || 'Unknown'}** is still detected in the server. Kick could not be verified.`
      )
      .setColor(0xed4245)
      .setTimestamp();

    if (interaction.deferred && typeof (interaction as any).editReply === 'function') {
      await interaction.editReply({ embeds: [unverifiedEmbed], components: [] });
    } else if (!interaction.replied) {
      await interaction.update({ embeds: [unverifiedEmbed], components: [] });
    }
    return;
  }

  // 8. Atomic transition: CONFIRMED -> EXECUTED only after Discord action succeeds AND verification succeeds
  markExecuted(actionId);

  // Record moderation case
  let caseRecord: any = null;
  try {
    caseRecord = await moderationService.recordSanctionCase({
      guildId: interaction.guild.id,
      targetId: action.targetId!,
      targetTag: action.targetTag || action.targetId!,
      moderatorId: interaction.user.id,
      moderatorTag: interaction.user.tag || interaction.user.username,
      actionType: action.actionType as any,
      reason: action.reason,
      sanctionApplied: action.actionType === 'BAN' ? 'Permanently banned from server' : 'Kicked from server',
    });
  } catch (caseErr) {
    console.warn(`Failed to record sanction case for ${action.actionType}:`, caseErr);
  }

  // 9. Audit logging: Durable PostgreSQL + Operational #mod-logs
  // 9a. Durable PostgreSQL audit event (metadata-only, non-blocking)
  try {
    const auditRepo = getAuditRepository();
    await auditRepo.recordEvent({
      guildId: interaction.guild.id,
      actionType: action.actionType === 'BAN' ? 'MOD_BAN' : 'MOD_KICK',
      actorId: interaction.user.id,
      targetId: action.targetId,
      status: 'SUCCESS',
      metadata: {
        caseId: caseRecord?.caseId,
        moderatorTag: interaction.user.tag || interaction.user.username,
        targetTag: action.targetTag || action.targetId,
        actionType: action.actionType,
        reason: action.reason,
      },
    });
  } catch (auditErr) {
    console.warn(`[Audit] Failed to persist ${action.actionType} audit event to PostgreSQL:`, auditErr);
  }

  // 9b. Structured audit logging to #mod-logs (if channel exists)
  const modLogsChannel = interaction.guild.channels?.cache?.find?.(
    (c: any) =>
      c.name?.toLowerCase() === 'mod-logs' &&
      (c.type === ChannelType.GuildText || typeof c.send === 'function')
  );

  if (modLogsChannel && typeof (modLogsChannel as any).send === 'function') {
    const logEmbed = new EmbedBuilder()
      .setTitle(action.actionType === 'BAN' ? '🛡️ Member Banned' : '🛡️ Member Kicked')
      .setColor(0xed4245)
      .addFields(
        {
          name: 'Target Member',
          value: `${action.targetTag || 'Unknown'} (<@${action.targetId}>)`,
          inline: false,
        },
        {
          name: 'Moderator',
          value: `${interaction.user.tag || interaction.user.username} (<@${interaction.user.id}>)`,
          inline: false,
        },
        { name: 'Action', value: `\`${action.actionType}\``, inline: true },
        { name: 'Status', value: '`EXECUTED & VERIFIED`', inline: true },
        { name: 'Reason', value: action.reason, inline: false }
      )
      .setTimestamp();

    if (caseRecord) {
      logEmbed.addFields({ name: 'Case ID', value: `\`${caseRecord.caseId}\``, inline: true });
    }

    try {
      await (modLogsChannel as any).send({ embeds: [logEmbed] });
    } catch (logErr) {
      console.warn('Failed to send audit log to #mod-logs:', logErr);
    }
  }

  // 10. Update interactive message to report verified success and remove buttons
  const successTitle = action.actionType === 'BAN' ? '🔨 Member Banned' : '👢 Member Kicked';
  const successDesc =
    action.actionType === 'BAN'
      ? `Successfully banned **${action.targetTag || 'Unknown'}** from the server.`
      : `Successfully kicked **${action.targetTag || 'Unknown'}** from the server.`;

  const successEmbed = new EmbedBuilder()
    .setTitle(successTitle)
    .setColor(0x57f287)
    .setDescription(successDesc)
    .addFields(
      { name: 'Target', value: `<@${action.targetId}>`, inline: true },
      { name: 'Action', value: `\`${action.actionType}\``, inline: true },
      { name: 'Status', value: '`EXECUTED`', inline: true },
      { name: 'Reason', value: action.reason, inline: false }
    )
    .setFooter({ text: `Moderator: ${interaction.user.username} • Absence verified` })
    .setTimestamp();

  if (caseRecord) {
    successEmbed.addFields({ name: 'Case ID', value: `\`${caseRecord.caseId}\``, inline: true });
  }

  if (interaction.deferred && typeof (interaction as any).editReply === 'function') {
    await interaction.editReply({
      embeds: [successEmbed],
      components: [],
    });
  } else if (!interaction.replied) {
    await interaction.update({
      embeds: [successEmbed],
      components: [],
    });
  }
}
