import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  GuildMember,
  PermissionFlagsBits,
} from 'discord.js';
import { authorize, Category, extractUserRoleIds } from '../../../services/discord/policy';
import { validateModerationTargetSafety } from '../../../services/discord/permissionValidator';
import { createPendingModAction } from '../../../services/discord/modConfirmation';

/**
 * Handles the Phase 4D.2 /mod kick proposal command.
 * Proposes the kick and renders human confirmation UI without kicking immediately.
 */
export async function handleKickProposal(interaction: ChatInputCommandInteraction): Promise<void> {
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
