// Literal first import - loads .env before anything else runs.
require("dotenv/config");

import { Client } from "discord.js";
import { getDiscordClientOptions } from "./config/discord";
import * as path from "path";
import { loadCommands } from "./commands/loader";
import { registerCommands } from "./commands/register";
import { handleConfirmationButton } from "./commands/kosmo/manage";
import { handleModerationButton } from "./commands/moderation/mod";
import { handleRewardButton } from "./commands/economy/reward";
import { handleProposalButton } from "./commands/community/community";
import { db } from "./services/database";
import { cache } from "./services/cache";
import { handleMessageCreate } from "./events/message/messageCreate";
import { getIntroductionRepository } from "./services/engagement/introductionRepository";

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

  // Database startup check & migrations (if DATABASE_URL configured)
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0) {
    try {
      console.log("Connecting to PostgreSQL and verifying health...");
      await db.connect();
      await db.migrate();
      const introRepo = getIntroductionRepository();
      if ('ensureTable' in introRepo && typeof (introRepo as any).ensureTable === 'function') {
        await (introRepo as any).ensureTable();
      }
      console.log("✅ Database initialized and migrations verified.");
    } catch (dbErr) {
      console.error("❌ Critical Database initialization error:", dbErr);
      if (process.env.NODE_ENV === "production") {
        process.exit(1);
      }
    }
  } else {
    console.log("ℹ️ DATABASE_URL not set; running with in-memory repository fallbacks.");
  }

  // Single directory scan for the entire process lifetime.
  const commands = await loadCommands(path.resolve(__dirname, "./commands"));

  const client = new Client(getDiscordClientOptions());

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}. Starting graceful shutdown...`);
    try {
      client.destroy();
      console.log("Discord client destroyed.");
      await db.disconnect();
      console.log("Database connections closed.");
      await cache.disconnect();
      console.log("Redis cache connections closed.");
    } catch (err) {
      console.error("Error during graceful shutdown:", err);
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

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
          } else if (interaction.customId.startsWith("reward_")) {
            await handleRewardButton(interaction);
          } else if (interaction.customId.startsWith("community_")) {
            await handleProposalButton(interaction);
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

  client.on("messageCreate", async (message) => {
    try {
      await handleMessageCreate(message, client);
    } catch (err) {
      console.error("Error handling messageCreate event:", err);
    }
  });

  await client.login(token);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
