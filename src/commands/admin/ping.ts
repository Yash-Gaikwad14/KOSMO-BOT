import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Replies with Pong! and latency")
  .setDMPermission(false);

export default async function handler(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const latency = Date.now() - interaction.createdTimestamp;
  await interaction.reply({
    content: `Pong! Latency: ${latency}ms`,
    ephemeral: true,
  });
}
