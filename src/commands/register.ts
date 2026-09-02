import { REST, Routes } from "discord.js";
import { CommandEntry } from "./loader";

/**
 * Registers guild-scoped slash commands using an ALREADY-BUILT command map.
 * Does not walk the commands directory itself - the caller (index.ts) is
 * responsible for loading commands once and passing the result in here, so
 * the directory is only ever scanned a single time per process lifetime.
 */
export async function registerCommands(
  commandMap: Map<string, CommandEntry>,
  token: string,
  clientId: string,
  guildId: string
): Promise<void> {
  const commandData = Array.from(commandMap.values()).map((c) => c.data);
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: commandData,
  });
}
