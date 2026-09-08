import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import {
  getLeaderboard,
  LeaderboardSort,
} from '../../services/economy/leaderboardService';

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('View the server Sparks economy leaderboard')
  .addStringOption((option) =>
    option
      .setName('sort')
      .setDescription('Ranking criteria (Total, Cash, or Bank)')
      .setRequired(false)
      .addChoices(
        { name: 'Total Sparks', value: 'total' },
        { name: 'Cash Sparks', value: 'cash' },
        { name: 'Bank Sparks', value: 'bank' }
      )
  )
  .addIntegerOption((option) =>
    option
      .setName('page')
      .setDescription('Page number (1–10)')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(10)
  );

export default async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  // 1. Guild-only guard
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

  // 2. Parse options
  const sortOption = (interaction.options.getString('sort') as LeaderboardSort) || 'total';
  const pageOption = interaction.options.getInteger('page') || 1;

  // 3. Dispatch to leaderboard service (read-only)
  const result = await getLeaderboard(
    interaction.user.id,
    guildId,
    sortOption,
    pageOption
  );

  // 4. Rate-limit / Query cooldown (ephemeral)
  if (result.onCooldown && result.remainingMs) {
    const seconds = Math.max(1, Math.ceil(result.remainingMs / 1000));
    const cooldownEmbed = new EmbedBuilder()
      .setTitle('⏳ Leaderboard Query Cooldown')
      .setColor(0xe67e22)
      .setDescription(
        `You are querying the leaderboard too quickly. Please wait **${seconds}s** before trying again.`
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

  // 5. Upstream provider failure (ephemeral)
  if (!result.success) {
    const failureEmbed = new EmbedBuilder()
      .setTitle('❌ Leaderboard Lookup Failed')
      .setColor(0xed4245)
      .setDescription(
        'Could not retrieve the Sparks leaderboard from the economy provider at this time. Please try again shortly.'
      )
      .setFooter({ text: 'Balance managed via UnbelievaBoat' })
      .setTimestamp();

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ embeds: [failureEmbed], ephemeral: true });
    } else {
      await interaction.reply({ embeds: [failureEmbed], ephemeral: true });
    }
    return;
  }

  // 6. Success state (PUBLIC response)
  const titles: Record<LeaderboardSort, string> = {
    total: '🏆 Total Sparks Leaderboard',
    cash: '💰 Cash Sparks Leaderboard',
    bank: '🏦 Bank Sparks Leaderboard',
  };

  const colors: Record<LeaderboardSort, number> = {
    total: 0xf1c40f, // Gold
    cash: 0x2ecc71,  // Emerald
    bank: 0x3498db,  // Diamond / Blue
  };

  const title = titles[result.sort] || titles.total;
  const color = colors[result.sort] || colors.total;

  const descriptionLines: string[] = [];

  if (result.entries.length === 0) {
    descriptionLines.push('No ranked users found for this server.');
  } else {
    for (const entry of result.entries) {
      let badge: string;
      if (entry.rank === 1) badge = '🥇';
      else if (entry.rank === 2) badge = '🥈';
      else if (entry.rank === 3) badge = '🥉';
      else badge = `\`${entry.rank}.\``;

      let displayAmount: number;
      if (result.sort === 'cash') displayAmount = entry.cash;
      else if (result.sort === 'bank') displayAmount = entry.bank;
      else displayAmount = entry.total;

      descriptionLines.push(
        `${badge} <@${entry.userId}> — **${displayAmount.toLocaleString()} Sparks**`
      );
    }
  }

  const footerText =
    typeof result.totalPages === 'number' && result.totalPages > 0
      ? `Page ${result.page} of ${result.totalPages} • UnbelievaBoat Economy`
      : `Page ${result.page} • UnbelievaBoat Economy`;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setDescription(descriptionLines.join('\n'))
    .setFooter({ text: footerText })
    .setTimestamp();

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ embeds: [embed] });
  } else {
    await interaction.reply({ embeds: [embed] });
  }
}
