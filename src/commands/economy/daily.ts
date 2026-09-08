import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { claimDaily } from '../../services/economy/dailyService';
import { extractUserRoleIds } from '../../services/discord/policy';

export const data = new SlashCommandBuilder()
  .setName('daily')
  .setDescription('Claim your daily Sparks allowance');

export default async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  // 1. Guild-only check
  const guildId = interaction.guildId;
  if (!guildId) {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: '❌ This command can only be used in a server.',
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: '❌ This command can only be used in a server.',
        ephemeral: true,
      });
    }
    return;
  }

  // 2. Extract caller role IDs
  const callerRoles = extractUserRoleIds(interaction.member);

  // 3. Dispatch to daily service
  const result = await claimDaily(interaction.user.id, guildId, callerRoles);

  // 4. Render response embed
  if (result.success && result.nextClaimAt) {
    const unixNext = Math.floor(result.nextClaimAt.getTime() / 1000);
    const title = result.isHighKarma
      ? '⚡ Daily Sparks Claimed (High-Karma Tier)'
      : '🪙 Daily Sparks Claimed (Standard Tier)';
    const color = result.isHighKarma ? 0xf1c40f : 0x2ecc71;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(color)
      .setDescription(
        `Successfully awarded **+${result.sparksAwarded.toLocaleString()} Sparks** to <@${interaction.user.id}>!`
      )
      .addFields(
        {
          name: 'Sparks Awarded',
          value: `\`+${result.sparksAwarded.toLocaleString()} Sparks\``,
          inline: true,
        },
        {
          name: 'Tier',
          value: result.isHighKarma ? '⚡ **High-Karma** (4x Boost)' : '🪙 **Standard**',
          inline: true,
        },
        {
          name: 'Next Claim Available',
          value: `<t:${unixNext}:R> (<t:${unixNext}:t>)`,
          inline: false,
        }
      )
      .setFooter({
        text: result.isHighKarma
          ? 'Thank you for your active community contributions!'
          : 'Tip: Level up your Karma to unlock the 2,000 Sparks/day High-Karma tier.',
      })
      .setTimestamp();

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ embeds: [embed] });
    } else {
      await interaction.reply({ embeds: [embed] });
    }
    return;
  }

  if (result.onCooldown && result.nextClaimAt) {
    const unixNext = Math.floor(result.nextClaimAt.getTime() / 1000);
    const embed = new EmbedBuilder()
      .setTitle('⏳ Daily Sparks Cooldown')
      .setColor(0xe67e22)
      .setDescription('You have already claimed your daily Sparks today.')
      .addFields({
        name: 'Next Claim Available',
        value: `<t:${unixNext}:R> (<t:${unixNext}:t>)`,
        inline: false,
      })
      .setFooter({ text: 'Daily claims reset every 24 hours.' })
      .setTimestamp();

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ embeds: [embed], ephemeral: true });
    } else {
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
    return;
  }

  // API or synchronization failure
  const failureEmbed = new EmbedBuilder()
    .setTitle('❌ Economy Synchronization Failed')
    .setColor(0xed4245)
    .setDescription(
      'Could not process your daily Sparks reward at this time. Your daily claim was not consumed. Please try again later.'
    )
    .setFooter({ text: 'Balance managed via UnbelievaBoat' })
    .setTimestamp();

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ embeds: [failureEmbed], ephemeral: true });
  } else {
    await interaction.reply({ embeds: [failureEmbed], ephemeral: true });
  }
}
