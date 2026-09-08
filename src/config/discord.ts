import { GatewayIntentBits, Options, ClientOptions } from 'discord.js';

/**
 * Production Discord.js Client configuration.
 * Hardened under H-05 with conservative native cache lifecycle management:
 * - MessageManager: Capped at 100 messages per text channel via makeCache
 * - Message Sweeper: Native sweep every 3,600s (1h) evicting messages older than 1,800s (30m)
 * - Thread Sweeper: Retains Discord.js native defaults (sweep every 1h, lifetime 4h)
 * - Roles, Channels, Guilds, and Members: Intentionally retained (Category A - Never Swept)
 *   to guarantee H-03 lookup performance, role hierarchy checks, and permission validation.
 */
export function getDiscordClientOptions(): ClientOptions {
  return {
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
    ],
    makeCache: Options.cacheWithLimits({
      MessageManager: 100,
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      messages: {
        interval: 3600,
        lifetime: 1800,
      },
    },
  };
}
