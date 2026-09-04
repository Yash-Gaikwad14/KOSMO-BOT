import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ButtonInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  GuildMember,
  PermissionFlagsBits,
  ChannelType,
} from 'discord.js';
import { authorize, Category, extractUserRoleIds } from '../../services/discord/policy';
import { validateModerationTargetSafety } from '../../services/discord/permissionValidator';
import { runAction } from '../../services/discord/actions';
import {
  createPendingModAction,
  getPendingModAction,
  atomicConfirmModAction,
  cancelModAction,
  markExecuted,
} from '../../services/discord/modConfirmation';

export const data = new SlashCommandBuilder()
  .setName('mod')
  .setDescription('Staff moderation commands for Kosmo Community')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('timeout')
      .setDescription('Timeout a server member for a specified duration')
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('The member to timeout')
          .setRequired(true)
      )
      .addIntegerOption((option) =>
        option
          .setName('duration')
          .setDescription('Duration of timeout in minutes (1 - 10080)')
          .setMinValue(1)
          .setMaxValue(10080)
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName('reason')
          .setDescription('Reason for timeout')
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('kick')
      .setDescription('Kick a member from the server (requires interactive confirmation)')
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('The member to kick')
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName('reason')
          .setDescription('Reason for kick (max 512 characters)')
          .setRequired(true)
      )
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand(false);

  if (subcommand === 'kick') {
    return handleKickProposal(interaction);
  }

  // Default to timeout handler (preserves Phase 4D.1 behavior)
  return handleTimeout(interaction);
}

/**
 * Handles the Phase 4D.1 /mod timeout command.
 */
async function handleTimeout(interaction: ChatInputCommandInteraction): Promise<void> {
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

  // 9. Structured audit logging to #mod-logs (if exists)
  const untilSeconds = Math.floor(verifiedMember.communicationDisabledUntil.getTime() / 1000);
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

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ embeds: [responseEmbed] });
  } else {
    await interaction.reply({ embeds: [responseEmbed] });
  }
}

/**
 * Handles the Phase 4D.2 /mod kick proposal command.
 * Proposes the kick and renders human confirmation UI without kicking immediately.
 */
async function handleKickProposal(interaction: ChatInputCommandInteraction): Promise<void> {
  // 1. Must be executed in a guild
  const guild = interaction.guild;
  if (!guild) {
    const msg = 'Command must be used in a guild.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: msg, ephemeral: true });
    } else {
      await interaction.reply({ content: msg, ephemeral: true });
    }
    return;
  }

  // 2. Bot permission check: KickMembers
  const botMember =
    guild.members.me ??
    (typeof guild.members.fetchMe === 'function'
      ? await guild.members.fetchMe().catch(() => null)
      : null);
  const hasKickPerm =
    botMember &&
    (botMember.permissions?.has(PermissionFlagsBits.KickMembers) ||
      botMember.permissions?.has('KickMembers'));
  if (!hasKickPerm) {
    const msg = '❌ Bot lacks the "Kick Members" permission.';
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
  const rawReason = interaction.options.getString('reason', true);
  const reason = rawReason ? rawReason.trim() : '';

  if (!reason) {
    const msg = '❌ A valid reason must be provided for the kick.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: msg, ephemeral: true });
    } else {
      await interaction.reply({ content: msg, ephemeral: true });
    }
    return;
  }

  if (reason.length > 512) {
    const msg = '❌ Kick reason cannot exceed 512 characters.';
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

  // 7. Store pending moderation action with 5-minute TTL
  const pendingAction = createPendingModAction({
    guildId: guild.id,
    moderatorId: interaction.user.id,
    targetId: targetMember.id,
    targetTag: targetMember.user?.tag || targetMember.displayName || targetMember.id,
    actionType: 'KICK',
    reason,
  });

  // 8. Build interactive confirmation embed and buttons
  const confirmEmbed = new EmbedBuilder()
    .setTitle('⚠️ CONFIRM MEMBER KICK')
    .setColor(0xed4245)
    .setDescription(
      `Are you sure you want to kick **${targetMember.user?.tag || targetMember.displayName || targetMember.id}** from the server?`
    )
    .addFields(
      {
        name: 'Target Member',
        value: `${targetMember.user?.tag || targetMember.id} (<@${targetMember.id}>)`,
        inline: true,
      },
      { name: 'Action', value: '`KICK`', inline: true },
      { name: 'Reason', value: reason, inline: false },
      {
        name: '⚠️ High-Impact Action Warning',
        value:
          'Kicking a member removes them from the server immediately. They may rejoin if they have a valid invite link. This action cannot be undone automatically.',
        inline: false,
      },
      {
        name: 'Confirmation Window',
        value: 'This confirmation will expire in **5 minutes**. Only the initiating moderator can confirm.',
        inline: false,
      }
    )
    .setFooter({
      text: `Initiated by @${interaction.user.username} • Awaiting confirmation • No changes made yet`,
    })
    .setTimestamp();

  const confirmButton = new ButtonBuilder()
    .setCustomId(`mod_kick_confirm_${pendingAction.id}`)
    .setLabel('Confirm Kick')
    .setStyle(ButtonStyle.Danger);

  const cancelButton = new ButtonBuilder()
    .setCustomId(`mod_kick_cancel_${pendingAction.id}`)
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ embeds: [confirmEmbed], components: [row] });
  } else {
    await interaction.reply({ embeds: [confirmEmbed], components: [row] });
  }
}

/**
 * Handler for Phase 4D.2 interactive moderation buttons (`mod_kick_confirm_...` and `mod_kick_cancel_...`).
 */
export async function handleModerationButton(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;
  const isConfirm = customId.startsWith('mod_kick_confirm_');
  const isCancel = customId.startsWith('mod_kick_cancel_');

  if (!isConfirm && !isCancel) return;

  const actionId = isConfirm
    ? customId.replace('mod_kick_confirm_', '')
    : customId.replace('mod_kick_cancel_', '');

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

    const cancelEmbed = new EmbedBuilder()
      .setTitle('🚫 KICK CANCELLED')
      .setDescription(`Kick of member **${action.targetTag}** was cancelled. No changes were made.`)
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

  // 2. Re-check bot permission: KickMembers
  const botMember =
    interaction.guild.members.me ??
    (typeof interaction.guild.members.fetchMe === 'function'
      ? await interaction.guild.members.fetchMe().catch(() => null)
      : null);
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

  // 3. Re-fetch target member (handle member leaving before confirmation)
  let targetMember: GuildMember | null = null;
  try {
    targetMember = await interaction.guild.members.fetch(action.targetId);
  } catch {
    targetMember = null;
  }

  if (!targetMember) {
    cancelModAction(actionId, interaction.user.id, interaction.guild.id);
    const targetLeftEmbed = new EmbedBuilder()
      .setTitle('❌ KICK ABORTED')
      .setDescription(
        `Member **${action.targetTag}** is no longer in this server. The kick was not executed.`
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
      .setTitle('❌ KICK ABORTED')
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

  // 6. Execute kick strictly through actions.ts:runAction()
  try {
    await runAction(interaction.guild, {
      type: 'kickMember',
      payload: {
        guildId: interaction.guild.id,
        targetId: action.targetId,
        reason: action.reason,
      },
    });
  } catch (kickErr: any) {
    const failEmbed = new EmbedBuilder()
      .setTitle('❌ KICK FAILED')
      .setDescription(`Failed to kick member: ${kickErr?.message || 'Unknown error'}`)
      .setColor(0xed4245)
      .setTimestamp();

    if (interaction.deferred && typeof (interaction as any).editReply === 'function') {
      await interaction.editReply({ embeds: [failEmbed], components: [] });
    } else if (!interaction.replied) {
      await interaction.update({ embeds: [failEmbed], components: [] });
    }
    return;
  }

  // 7. Post-action verification: Verify that target is no longer in the guild
  let stillInGuild = false;
  try {
    if (typeof interaction.guild.members.fetch === 'function') {
      const recheck = await interaction.guild.members
        .fetch({ user: action.targetId, force: true })
        .catch(() => null);
      if (recheck) {
        stillInGuild = true;
      }
    }
  } catch {
    stillInGuild = false;
  }

  if (stillInGuild) {
    const unverifiedEmbed = new EmbedBuilder()
      .setTitle('❌ KICK UNVERIFIED')
      .setDescription(
        `Target member **${action.targetTag}** is still detected in the server. Kick could not be verified.`
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

  // 8. Atomic transition: CONFIRMED -> EXECUTED only after Discord kick succeeds AND post-action verification confirms absence
  markExecuted(actionId);

  // 9. Structured audit logging to #mod-logs (if channel exists)
  const modLogsChannel = interaction.guild.channels?.cache?.find?.(
    (c: any) =>
      c.name?.toLowerCase() === 'mod-logs' &&
      (c.type === ChannelType.GuildText || typeof c.send === 'function')
  );

  if (modLogsChannel && typeof (modLogsChannel as any).send === 'function') {
    const logEmbed = new EmbedBuilder()
      .setTitle('🛡️ Member Kicked')
      .setColor(0xed4245)
      .addFields(
        {
          name: 'Target Member',
          value: `${action.targetTag} (<@${action.targetId}>)`,
          inline: false,
        },
        {
          name: 'Moderator',
          value: `${interaction.user.tag || interaction.user.username} (<@${interaction.user.id}>)`,
          inline: false,
        },
        { name: 'Action', value: '`KICK`', inline: true },
        { name: 'Status', value: '`EXECUTED & VERIFIED`', inline: true },
        { name: 'Reason', value: action.reason, inline: false }
      )
      .setTimestamp();

    try {
      await (modLogsChannel as any).send({ embeds: [logEmbed] });
    } catch (logErr) {
      console.warn('Failed to send audit log to #mod-logs:', logErr);
    }
  }

  // 10. Update interactive message to report verified success and remove buttons
  const successEmbed = new EmbedBuilder()
    .setTitle('👢 Member Kicked')
    .setColor(0x57f287)
    .setDescription(`Successfully kicked **${action.targetTag}** from the server.`)
    .addFields(
      { name: 'Target', value: `<@${action.targetId}>`, inline: true },
      { name: 'Action', value: '`KICK`', inline: true },
      { name: 'Status', value: '`EXECUTED`', inline: true },
      { name: 'Reason', value: action.reason, inline: false }
    )
    .setFooter({ text: `Moderator: ${interaction.user.username} • Absence verified` })
    .setTimestamp();

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

export default execute;
