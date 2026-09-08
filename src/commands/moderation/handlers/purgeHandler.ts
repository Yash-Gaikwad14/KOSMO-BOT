import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} from 'discord.js';
import { authorize, Category, extractUserRoleIds } from '../../../services/discord/policy';
import { createPendingModAction } from '../../../services/discord/modConfirmation';

export const MAX_PURGE_AMOUNT = 100;

/**
 * Handles proposal creation for /mod purge amount:<number> reason:<reason>.
 * Creates a pending proposal and asks for human confirmation.
 * Does NOT delete any messages.
 */
export async function handlePurgeProposal(interaction: ChatInputCommandInteraction): Promise<void> {
  // 1. Guild-only guard
  const guild = interaction.guild;
  if (!guild) {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: 'Command must be used in a guild.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'Command must be used in a guild.', ephemeral: true });
    }
    return;
  }

  // 2. Authorization check: Category.MODERATE
  const callerRoles = extractUserRoleIds(interaction.member);
  const authDecision = authorize(callerRoles, Category.MODERATE, {
    userId: interaction.user.id,
    guildOwnerId: guild.ownerId,
  });

  if (authDecision !== 'ALLOW') {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: '❌ You are not authorized to use moderation commands.',
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: '❌ You are not authorized to use moderation commands.',
        ephemeral: true,
      });
    }
    return;
  }

  // 3. Channel validity check: must support bulk message deletion
  const channel = interaction.channel;
  if (!channel || typeof (channel as any).bulkDelete !== 'function') {
    const msg = '❌ This channel does not support message deletion.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: msg, ephemeral: true });
    } else {
      await interaction.reply({ content: msg, ephemeral: true });
    }
    return;
  }

  // 4. Bot permission check: ManageMessages in this channel
  const botMember =
    guild.members.me ??
    (typeof guild.members.fetchMe === 'function'
      ? await guild.members.fetchMe().catch(() => null)
      : null);

  let hasManageMessages = false;
  if (botMember && typeof (channel as any).permissionsFor === 'function') {
    const perms = (channel as any).permissionsFor(botMember);
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
    const msg = '❌ Bot lacks the "Manage Messages" permission in this channel.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: msg, ephemeral: true });
    } else {
      await interaction.reply({ content: msg, ephemeral: true });
    }
    return;
  }

  // 5. Extract and validate amount: 1-100 (no silent clamping)
  const amount = interaction.options.getInteger('amount');
  if (
    amount === null ||
    typeof amount !== 'number' ||
    !Number.isInteger(amount) ||
    amount < 1 ||
    amount > MAX_PURGE_AMOUNT
  ) {
    const msg = `❌ Purge amount must be an integer between 1 and ${MAX_PURGE_AMOUNT}.`;
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: msg, ephemeral: true });
    } else {
      await interaction.reply({ content: msg, ephemeral: true });
    }
    return;
  }

  // 6. Extract and validate reason: 1-512 chars
  const rawReason = interaction.options.getString('reason');
  const reason = rawReason ? rawReason.trim() : '';
  if (!reason) {
    const msg = '❌ A valid reason must be provided for the purge.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: msg, ephemeral: true });
    } else {
      await interaction.reply({ content: msg, ephemeral: true });
    }
    return;
  }

  if (reason.length > 512) {
    const msg = '❌ Purge reason cannot exceed 512 characters.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: msg, ephemeral: true });
    } else {
      await interaction.reply({ content: msg, ephemeral: true });
    }
    return;
  }

  // 7. Create pending moderation proposal
  const pendingAction = createPendingModAction({
    guildId: guild.id,
    moderatorId: interaction.user.id,
    channelId: interaction.channelId,
    amount,
    actionType: 'PURGE',
    reason,
  });

  // 8. Build interactive confirmation embed and buttons
  const confirmEmbed = new EmbedBuilder()
    .setTitle('⚠️ CONFIRM MESSAGE PURGE')
    .setColor(0xfee75c)
    .setDescription(
      `Are you sure you want to purge **${amount}** messages from <#${interaction.channelId}>?\n\n` +
      `**Warning**: Message deletion is destructive and cannot be undone.`
    )
    .addFields(
      { name: 'Channel', value: `<#${interaction.channelId}>`, inline: true },
      { name: 'Requested Amount', value: `\`${amount} messages\``, inline: true },
      { name: 'Action', value: '`PURGE`', inline: true },
      { name: 'Reason', value: reason, inline: false },
      {
        name: 'Confirmation Window',
        value: 'This confirmation will expire in **5 minutes**. Only the initiating moderator can confirm.',
        inline: false,
      }
    )
    .setFooter({
      text: `Initiated by @${interaction.user.username} • Awaiting confirmation • No messages deleted yet`,
    })
    .setTimestamp();

  const confirmButton = new ButtonBuilder()
    .setCustomId(`mod_purge_confirm_${pendingAction.id}`)
    .setLabel('Confirm Purge')
    .setStyle(ButtonStyle.Danger);

  const cancelButton = new ButtonBuilder()
    .setCustomId(`mod_purge_cancel_${pendingAction.id}`)
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ embeds: [confirmEmbed], components: [row] });
  } else {
    await interaction.reply({ embeds: [confirmEmbed], components: [row] });
  }
}
