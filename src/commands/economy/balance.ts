import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { getUserBalanceInfo } from '../../services/economy/balanceService';
import { extractUserRoleIds } from '../../services/discord/policy';

export const data = new SlashCommandBuilder()
  .setName('balance')
  .setDescription('View your Sparks balance, tier, and daily claim status');

export default async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  // 1. Guild-only check
  const guildId = interaction.guildId;
  if (!guildId) {
    const errorPayload = {
      content: '❌ This command can only be used in a server.',
      ephemeral: true,
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorPayload);
    } else {
      await interaction.reply(errorPayload);
    }
    return;
  }

  // 2. Extract caller role IDs
  const callerRoles = extractUserRoleIds(interaction.member);

  // 3. Dispatch to balance service (read-only)
  const result = await getUserBalanceInfo(
    interaction.user.id,
    guildId,
    callerRoles
  );

  // 4. Rate limit / query cooldown
  if (result.onCooldown && result.remainingMs) {
    const seconds = Math.max(1, Math.ceil(result.remainingMs / 1000));
    const cooldownEmbed = new EmbedBuilder()
      .setTitle('⏳ Balance Query Cooldown')
      .setColor(0xe67e22)
      .setDescription(
        `You are querying your balance too quickly. Please wait **${seconds}s** before trying again.`
      )
      .setFooter({ text: 'Rate limits protect against upstream provider throttling.' })
      .setTimestamp();

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ embeds: [cooldownEmbed], ephemeral: true });
    } else {
      await interaction.reply({ embeds: [cooldownEmbed], ephemeral: true });
    }
    return;
  }

  // 5. Success state
  if (result.success && result.balance) {
    const color = result.isHighKarma ? 0xf1c40f : 0x2ecc71;
    const tierText = result.isHighKarma
      ? '⚡ **High-Karma Tier** (4x Daily Boost)'
      : '🪙 **Standard Tier**';

    let dailyStatusText = '✅ **Ready to claim now!** Use `/daily`';
    if (!result.dailyEligible && result.dailyNextClaimAt) {
      const unixNext = Math.floor(result.dailyNextClaimAt.getTime() / 1000);
      dailyStatusText = `⏳ Already claimed • Next: <t:${unixNext}:R>`;
    }

    const embed = new EmbedBuilder()
      .setTitle(`🪙 Sparks Balance — ${interaction.user.username}`)
      .setColor(color)
      .setDescription(`Economy profile for <@${interaction.user.id}>`)
      .addFields(
        {
          name: 'Cash Sparks',
          value: `🪙 \`${result.balance.cash.toLocaleString()} Sparks\``,
          inline: true,
        },
        {
          name: 'Bank Sparks',
          value: `🏦 \`${result.balance.bank.toLocaleString()} Sparks\``,
          inline: true,
        },
        {
          name: 'Total Net Worth',
          value: `💎 \`${result.balance.total.toLocaleString()} Sparks\``,
          inline: true,
        },
        {
          name: 'Account Tier',
          value: tierText,
          inline: true,
        },
        {
          name: 'Daily Allowance',
          value: dailyStatusText,
          inline: true,
        }
      )
      .setFooter({
        text: 'Balance managed via UnbelievaBoat • Earn daily Sparks with /daily',
      })
      .setTimestamp();

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ embeds: [embed], ephemeral: true });
    } else {
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
    return;
  }

  // 6. Upstream / Provider Failure
  const failureEmbed = new EmbedBuilder()
    .setTitle('❌ Balance Lookup Failed')
    .setColor(0xed4245)
    .setDescription(
      'Could not retrieve your Sparks balance from the economy provider at this time. Please try again shortly.'
    )
    .setFooter({ text: 'Balance managed via UnbelievaBoat' })
    .setTimestamp();

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ embeds: [failureEmbed], ephemeral: true });
  } else {
    await interaction.reply({ embeds: [failureEmbed], ephemeral: true });
  }
}
