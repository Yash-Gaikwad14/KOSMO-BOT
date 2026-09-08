import {
  ChatInputCommandInteraction,
  ButtonInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { extractUserRoleIds } from '../../services/discord/policy';
import {
  createPendingModAction,
  getPendingModAction,
  atomicConfirmModAction,
  cancelModAction,
  markExecuted,
  markFailed,
} from '../../services/discord/modConfirmation';
import {
  validateRewardAmount,
  validateRewardReason,
  isStaffRewardAuthorized,
  grantPersonalSparks,
  logRewardSparksAudit,
  defaultUnbelievaBoatClient,
  MAX_REWARD_AMOUNT,
  MIN_REWARD_AMOUNT,
  MIN_REASON_LENGTH,
  MAX_REASON_LENGTH,
} from '../../services/economy/rewardService';
import { IUnbelievaBoatClient } from '../../services/economy/unbelievaboatClient';

export const data = new SlashCommandBuilder()
  .setName('reward')
  .setDescription('Staff economy rewards and grants')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('sparks')
      .setDescription('Grant Sparks to your own wallet (Founder/Team Kosmo only)')
      .addIntegerOption((option) =>
        option
          .setName('amount')
          .setDescription(`Amount of Sparks to grant (1 - ${MAX_REWARD_AMOUNT.toLocaleString()})`)
          .setRequired(true)
          .setMinValue(MIN_REWARD_AMOUNT)
          .setMaxValue(MAX_REWARD_AMOUNT)
      )
      .addStringOption((option) =>
        option
          .setName('reason')
          .setDescription(`Reason for this grant (${MIN_REASON_LENGTH} - ${MAX_REASON_LENGTH} chars)`)
          .setRequired(true)
          .setMinLength(MIN_REASON_LENGTH)
          .setMaxLength(MAX_REASON_LENGTH)
      )
  );

/**
 * Handles /reward slash command interactions.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  // 1. Must be executed in a guild
  if (!interaction.guild) {
    await interaction.reply({
      content: '❌ This command can only be used within a server.',
      ephemeral: true,
    });
    return;
  }

  // 2. Centralized Policy Authorization Check
  const callerRoles = extractUserRoleIds(interaction.member);
  if (!isStaffRewardAuthorized(callerRoles)) {
    await interaction.reply({
      content: '❌ Unauthorized: Only Kosmo Founder and Team Kosmo can use `/reward sparks`.',
      ephemeral: true,
    });
    return;
  }

  // 3. Parse and validate subcommand & options
  const subcommand = interaction.options.getSubcommand();
  if (subcommand !== 'sparks') {
    await interaction.reply({
      content: `❌ Unknown subcommand "${subcommand}".`,
      ephemeral: true,
    });
    return;
  }

  const rawAmount = interaction.options.getInteger('amount', true);
  const rawReason = interaction.options.getString('reason', true);

  const amountValidation = validateRewardAmount(rawAmount);
  if (!amountValidation.valid || amountValidation.value === undefined) {
    await interaction.reply({
      content: `❌ ${amountValidation.error}`,
      ephemeral: true,
    });
    return;
  }

  const reasonValidation = validateRewardReason(rawReason);
  if (!reasonValidation.valid || reasonValidation.value === undefined) {
    await interaction.reply({
      content: `❌ ${reasonValidation.error}`,
      ephemeral: true,
    });
    return;
  }

  const amount = amountValidation.value;
  const reason = reasonValidation.value;

  // 4. Create pending action in the confirmation system (5-minute TTL, replay-protected)
  const pendingAction = createPendingModAction({
    guildId: interaction.guild.id,
    moderatorId: interaction.user.id,
    targetId: interaction.user.id,
    targetTag: interaction.user.tag || interaction.user.username,
    amount,
    actionType: 'REWARD_SPARKS',
    reason,
  });

  // 5. Render Ephemeral Confirmation Proposal UI
  const confirmEmbed = new EmbedBuilder()
    .setTitle('✨ KOSMO Sparks Grant')
    .setColor(0x5865f2)
    .setDescription('Awaiting your confirmation to grant Sparks to your own wallet.')
    .addFields(
      {
        name: 'Recipient',
        value: `Your own wallet (<@${interaction.user.id}>)`,
        inline: false,
      },
      {
        name: 'Amount',
        value: `**+${amount.toLocaleString()} Sparks**`,
        inline: true,
      },
      {
        name: 'Reason',
        value: reason,
        inline: false,
      },
      {
        name: 'Status',
        value: '⏳ **Confirmation required**',
        inline: false,
      }
    )
    .setFooter({
      text: 'Expires in 5 minutes • Replay protected • Sole ledger: UnbelievaBoat',
    })
    .setTimestamp();

  const confirmButton = new ButtonBuilder()
    .setCustomId(`reward_sparks_confirm_${pendingAction.id}`)
    .setLabel('Confirm')
    .setStyle(ButtonStyle.Success);

  const cancelButton = new ButtonBuilder()
    .setCustomId(`reward_sparks_cancel_${pendingAction.id}`)
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);

  await interaction.reply({
    embeds: [confirmEmbed],
    components: [row],
    ephemeral: true,
  });
}

/**
 * Handles interactive button clicks for Sparks grant confirmation [Confirm] and [Cancel].
 */
export async function handleRewardButton(
  interaction: ButtonInteraction,
  clientOverride?: IUnbelievaBoatClient
): Promise<void> {
  const customId = interaction.customId;
  const isConfirm = customId.startsWith('reward_sparks_confirm_');
  const isCancel = customId.startsWith('reward_sparks_cancel_');

  if (!isConfirm && !isCancel) return;

  const actionId = isConfirm
    ? customId.replace('reward_sparks_confirm_', '')
    : customId.replace('reward_sparks_cancel_', '');

  if (!interaction.guild) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Sparks reward confirmation can only be performed within a server.',
        ephemeral: true,
      });
    }
    return;
  }

  const action = getPendingModAction(actionId);
  if (!action) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Sparks grant action not found or expired.',
        ephemeral: true,
      });
    }
    return;
  }

  // Guild binding validation
  if (action.guildId !== interaction.guild.id) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Action does not belong to this server.',
        ephemeral: true,
      });
    }
    return;
  }

  // Actor binding validation
  if (action.moderatorId !== interaction.user.id) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Only the staff member who initiated this grant can confirm it.',
        ephemeral: true,
      });
    }
    return;
  }

  // Handle Cancel
  if (isCancel) {
    cancelModAction(actionId, interaction.user.id, interaction.guild.id);
    const cancelEmbed = new EmbedBuilder()
      .setTitle('🚫 Sparks Grant Cancelled')
      .setDescription('The Sparks grant was cancelled. No currency was modified.')
      .setColor(0xed4245)
      .setTimestamp();

    if (!interaction.replied && !interaction.deferred) {
      await interaction.update({ embeds: [cancelEmbed], components: [] });
    }
    return;
  }

  // Handle Confirm
  // 1. Re-check staff authorization at execution time
  const callerRoles = extractUserRoleIds(interaction.member);
  if (!isStaffRewardAuthorized(callerRoles)) {
    cancelModAction(actionId, interaction.user.id, interaction.guild.id);
    const deniedEmbed = new EmbedBuilder()
      .setTitle('❌ Grant Aborted')
      .setDescription('Unauthorized: You no longer possess the required staff role to confirm this grant.')
      .setColor(0xed4245)
      .setTimestamp();

    if (!interaction.replied && !interaction.deferred) {
      await interaction.update({ embeds: [deniedEmbed], components: [] });
    }
    return;
  }

  // 2. Re-validate immutable payload
  const amtCheck = validateRewardAmount(action.amount);
  const rsnCheck = validateRewardReason(action.reason);
  if (!amtCheck.valid || !rsnCheck.valid || amtCheck.value === undefined || rsnCheck.value === undefined) {
    cancelModAction(actionId, interaction.user.id, interaction.guild.id);
    const invEmbed = new EmbedBuilder()
      .setTitle('❌ Grant Aborted')
      .setDescription('Invalid or tampered payload parameters.')
      .setColor(0xed4245)
      .setTimestamp();

    if (!interaction.replied && !interaction.deferred) {
      await interaction.update({ embeds: [invEmbed], components: [] });
    }
    return;
  }

  // 3. Atomic confirmation (transitions PENDING -> CONFIRMED; protects against double-clicks/replays)
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

  // 4. Dispatch mutation to UnbelievaBoat
  const ubbClient = clientOverride || defaultUnbelievaBoatClient;
  let result: any;
  try {
    result = await grantPersonalSparks(
      ubbClient,
      interaction.guild.id,
      interaction.user.id,
      amtCheck.value,
      rsnCheck.value
    );
  } catch (err: any) {
    result = {
      success: false,
      amount: amtCheck.value,
      error: err?.message || 'Unexpected exception communicating with economy service.',
    };
  }

  const timestamp = new Date().toISOString();

  if (result.success) {
    markExecuted(actionId);

    const successEmbed = new EmbedBuilder()
      .setTitle('✨ Sparks Added')
      .setColor(0x57f287)
      .setDescription(`Successfully added **+${amtCheck.value.toLocaleString()} Sparks** to your wallet.`)
      .addFields(
        {
          name: 'Amount Added',
          value: `+${amtCheck.value.toLocaleString()} Sparks`,
          inline: true,
        },
        {
          name: 'New Cash Balance',
          value: result.cash !== undefined ? `${result.cash.toLocaleString()} Sparks` : 'Updated',
          inline: true,
        },
        {
          name: 'Total Balance',
          value: result.total !== undefined ? `${result.total.toLocaleString()} Sparks` : 'Updated',
          inline: true,
        },
        {
          name: 'Reason',
          value: rsnCheck.value,
          inline: false,
        }
      )
      .setFooter({ text: 'Sole authoritative ledger: UnbelievaBoat' })
      .setTimestamp();

    if (typeof (interaction as any).editReply === 'function') {
      await (interaction as any).editReply({ embeds: [successEmbed], components: [] });
    }

    // 5. Send structured audit log to #mod-logs
    await logRewardSparksAudit(interaction.guild, {
      actorId: interaction.user.id,
      actorTag: interaction.user.tag || interaction.user.username,
      guildId: interaction.guild.id,
      amount: amtCheck.value,
      reason: rsnCheck.value,
      actionId,
      timestamp,
      result: 'SUCCESS',
      newCash: result.cash,
      newTotal: result.total,
    });
  } else {
    markFailed(actionId);

    const failEmbed = new EmbedBuilder()
      .setTitle('❌ Sparks Grant Failed')
      .setColor(0xed4245)
      .setDescription(`Failed to grant Sparks: ${result.error || 'Unknown provider error'}`)
      .setTimestamp();

    if (typeof (interaction as any).editReply === 'function') {
      await (interaction as any).editReply({ embeds: [failEmbed], components: [] });
    }

    await logRewardSparksAudit(interaction.guild, {
      actorId: interaction.user.id,
      actorTag: interaction.user.tag || interaction.user.username,
      guildId: interaction.guild.id,
      amount: amtCheck.value,
      reason: rsnCheck.value,
      actionId,
      timestamp,
      result: 'FAILED',
      error: result.error,
    });
  }
}

export default execute;
