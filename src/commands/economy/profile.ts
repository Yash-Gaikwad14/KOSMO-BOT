import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { getProfile } from '../../services/economy/profileService';

export const data = new SlashCommandBuilder()
  .setName('profile')
  .setDescription('View your Kosmo community profile, recognition badges, and economy status');

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

  // 2. Fetch profile info
  const result = await getProfile(
    interaction.user.id,
    guildId,
    interaction.member
  );

  // 3. Cooldown notice (ephemeral)
  if (result.onCooldown && result.remainingMs) {
    const seconds = Math.max(1, Math.ceil(result.remainingMs / 1000));
    const cooldownEmbed = new EmbedBuilder()
      .setTitle('⏳ Profile Query Cooldown')
      .setColor(0xe67e22)
      .setDescription(
        `You are querying your profile too quickly. Please wait **${seconds}s** before trying again.`
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

  // 4. Provider failure (ephemeral)
  if (!result.success || !result.balance) {
    const failureEmbed = new EmbedBuilder()
      .setTitle('❌ Profile Lookup Failed')
      .setColor(0xed4245)
      .setDescription(
        'Could not retrieve your economy details from the provider at this time. Please try again shortly.'
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

  // 5. Build profile embed (ephemeral)
  const isElevated = result.isHighKarma || !!result.recognition.premiumTier;
  const color = isElevated ? 0xf1c40f : 0x5865f2;

  const recognitionLines: string[] = [];
  if (result.recognition.badges.length > 0) {
    recognitionLines.push(...result.recognition.badges);
  }
  const recognitionText =
    recognitionLines.length > 0
      ? recognitionLines.join('\n')
      : 'No special recognition yet.';

  const economyText = [
    `🪙 **Cash:** \`${result.balance.cash.toLocaleString()} Sparks\``,
    `🏦 **Bank:** \`${result.balance.bank.toLocaleString()} Sparks\``,
    `💎 **Total:** \`${result.balance.total.toLocaleString()} Sparks\``,
  ].join('\n');

  let dailyStatusText = '✅ Ready to claim — use `/daily`';
  if (!result.dailyEligible && result.dailyNextClaimAt) {
    const unixNext = Math.floor(result.dailyNextClaimAt.getTime() / 1000);
    dailyStatusText = `⏳ Already claimed • Available <t:${unixNext}:R>`;
  }

  const dailyText = [
    `⚡ **Tier:** ${result.isHighKarma ? 'High-Karma (2,000 Sparks/day)' : 'Standard (500 Sparks/day)'}`,
    `🎁 **Status:** ${dailyStatusText}`,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`👤 Kosmo Profile — ${interaction.user.username}`)
    .setColor(color)
    .setDescription(`Community standing and economy profile for <@${interaction.user.id}>`)
    .addFields(
      {
        name: '🎖️ Recognition',
        value: recognitionText,
        inline: true,
      }
    );

  if (result.recognition.premiumTier) {
    embed.addFields({
      name: '💎 Premium Status',
      value: result.recognition.premiumTier,
      inline: true,
    });
  }

  if (result.recognition.domainRoles.length > 0) {
    embed.addFields({
      name: '🏛️ Guild Affiliation',
      value: result.recognition.domainRoles.join('\n'),
      inline: true,
    });
  }

  embed.addFields(
    {
      name: '💰 Sparks Economy',
      value: economyText,
      inline: false,
    },
    {
      name: '📅 Daily Allowance',
      value: dailyText,
      inline: false,
    }
  );

  embed
    .setFooter({ text: 'Kosmo Community • Economy managed via UnbelievaBoat' })
    .setTimestamp();

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ embeds: [embed], ephemeral: true });
  } else {
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}
