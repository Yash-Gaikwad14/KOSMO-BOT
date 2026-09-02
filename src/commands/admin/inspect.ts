import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('inspect')
  .setDescription('Show basic information about this server');

export async function execute(interaction: ChatInputCommandInteraction) {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: 'Command must be used in a guild.', ephemeral: true });
    return;
  }
  const roleCount = guild.roles.cache.size;
  const channelCount = guild.channels.cache.size;
  const embed = new EmbedBuilder()
    .setTitle('Server Inspection')
    .addFields(
      { name: 'Roles', value: `${roleCount}`, inline: true },
      { name: 'Channels', value: `${channelCount}`, inline: true },
    )
    .setTimestamp();
  await interaction.reply({ embeds: [embed] });
}
