// Literal first import - loads .env before anything else runs.
require("dotenv/config");

import { Client, GatewayIntentBits } from "discord.js";
import * as path from "path";
import { loadCommands } from "./commands/loader";
import { registerCommands } from "./commands/register";
import { handleConfirmationButton } from "./commands/kosmo/manage";
import { handleModerationButton } from "./commands/moderation/mod";

async function main(): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  const clientId = process.env.DISCORD_APP_ID;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!token) {
    console.error("Missing DISCORD_BOT_TOKEN in .env");
    process.exit(1);
  }
  if (!clientId) {
    console.error("Missing DISCORD_APP_ID in .env");
    process.exit(1);
  }
  if (!guildId) {
    console.error("Missing DISCORD_GUILD_ID in .env");
    process.exit(1);
  }

  // Single directory scan for the entire process lifetime.
  const commands = await loadCommands(path.resolve(__dirname, "./commands"));

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
    ],
  });

  client.once("ready", async () => {
    console.log(`Logged in as ${client.user?.tag}`);

    try {
      await registerCommands(commands, token, clientId, guildId);
      console.log("Command registration succeeded");
    } catch (err) {
      console.error("Command registration failed:", err);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    if (interaction.isButton()) {
      try {
        if (!interaction.replied && !interaction.deferred) {
          if (interaction.customId.startsWith("mod_")) {
            await handleModerationButton(interaction);
          } else {
            await handleConfirmationButton(interaction);
          }
        }
      } catch (err) {
        console.error("Error handling button interaction:", err);
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const entry = commands.get(interaction.commandName);
    if (!entry) {
      await interaction.reply({
        content: "Command not found.",
        ephemeral: true,
      });
      return;
    }

    try {
      await entry.default(interaction);
    } catch (e) {
      console.error(`Error executing ${interaction.commandName}:`, e);
      await interaction.reply({
        content: "An error occurred while executing the command.",
        ephemeral: true,
      });
    }
  });

  await client.login(token);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
