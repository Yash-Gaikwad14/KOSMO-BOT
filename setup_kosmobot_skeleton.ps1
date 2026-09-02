# setup_kosmobot_skeleton.ps1
# Run this from inside KOSMO-BOT\ (the real repo folder, confirmed via
# `git status` showing "On branch main" before running this).
#
# This creates every file and folder for the Round 1 skeleton, with the two
# bugs (top-level await, double directory scan) already fixed.

$ErrorActionPreference = "Stop"

Write-Host "Creating root files..." -ForegroundColor Cyan

@'
{
  "name": "kosmo-bot",
  "version": "1.0.0",
  "description": "Kosmo Discord bot - initial CommonJS skeleton",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node src/index.ts"
  },
  "author": "Yash Gaikwad",
  "license": "MIT",
  "dependencies": {
    "discord.js": "^14.15.3",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "@types/node": "^22.7.4",
    "ts-node": "^10.9.2",
    "typescript": "^5.6.2",
    "eslint": "^9.14.0",
    "@typescript-eslint/parser": "^8.14.0",
    "@typescript-eslint/eslint-plugin": "^8.14.0"
  }
}
'@ | Set-Content -Path "package.json" -Encoding utf8

@'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
'@ | Set-Content -Path "tsconfig.json" -Encoding utf8

@'
node_modules/
dist/
.env
'@ | Set-Content -Path ".gitignore" -Encoding utf8

@'
DISCORD_BOT_TOKEN=
DISCORD_APP_ID=
DISCORD_GUILD_ID=
'@ | Set-Content -Path ".env.example" -Encoding utf8

Write-Host "Creating folder structure..." -ForegroundColor Cyan

$folders = @(
  "src\commands\economy", "src\commands\moderation", "src\commands\support",
  "src\commands\premium", "src\commands\admin", "src\commands\ai",
  "src\events\guild", "src\events\member", "src\events\interaction", "src\events\message",
  "src\modules\economy", "src\modules\tickets", "src\modules\moderation",
  "src\modules\referrals", "src\modules\premium", "src\modules\provisioning", "src\modules\ai",
  "src\services\discord", "src\services\database", "src\services\payments",
  "src\services\ai", "src\services\cache",
  "src\workers\queues",
  "src\config"
)

foreach ($f in $folders) {
    New-Item -ItemType Directory -Path $f -Force | Out-Null
}

# .gitkeep for folders that won't get a real file in this round
$emptyFolders = @(
  "src\commands\economy", "src\commands\moderation", "src\commands\support",
  "src\commands\premium", "src\commands\ai",
  "src\events\guild", "src\events\member", "src\events\interaction", "src\events\message",
  "src\modules\economy", "src\modules\tickets", "src\modules\moderation",
  "src\modules\referrals", "src\modules\premium", "src\modules\provisioning", "src\modules\ai",
  "src\services\discord", "src\services\payments", "src\services\ai",
  "src\workers\queues",
  "src\config"
)
foreach ($f in $emptyFolders) {
    New-Item -ItemType File -Path (Join-Path $f ".gitkeep") -Force | Out-Null
}

Write-Host "Creating src/commands/loader.ts..." -ForegroundColor Cyan

@'
import * as fs from "fs";
import * as path from "path";

export interface CommandEntry {
  data: any;
  default: (interaction: any) => Promise<void>;
}

/**
 * Recursively walks `baseDir` and returns every .ts/.js file, excluding
 * dotfiles like .gitkeep.
 */
async function walkDir(baseDir: string): Promise<string[]> {
  const entries = await fs.promises.readdir(baseDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDir(fullPath)));
    } else if (
      entry.isFile() &&
      (fullPath.endsWith(".ts") || fullPath.endsWith(".js")) &&
      !entry.name.startsWith(".")
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Loads every command module under `commandsRoot` exactly once and returns
 * a Map<commandName, CommandEntry>. This is the ONLY place that walks the
 * commands directory - both interaction handling and command registration
 * must reuse this same result, not call this function twice.
 */
export async function loadCommands(
  commandsRoot: string
): Promise<Map<string, CommandEntry>> {
  const files = await walkDir(commandsRoot);
  const map = new Map<string, CommandEntry>();
  for (const file of files) {
    // loader.ts and register.ts live in commands/ too but export no `data`,
    // so they are naturally skipped by the check below.
    const mod = await import(file);
    if (mod && mod.data && typeof mod.default === "function") {
      map.set(mod.data.name, { data: mod.data, default: mod.default });
    }
  }
  return map;
}
'@ | Set-Content -Path "src\commands\loader.ts" -Encoding utf8

Write-Host "Creating src/commands/register.ts..." -ForegroundColor Cyan

@'
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
'@ | Set-Content -Path "src\commands\register.ts" -Encoding utf8

Write-Host "Creating src/commands/admin/ping.ts..." -ForegroundColor Cyan

@'
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
'@ | Set-Content -Path "src\commands\admin\ping.ts" -Encoding utf8

Write-Host "Creating src/index.ts (fixed: no top-level await, single scan)..." -ForegroundColor Cyan

@'
// Literal first import - loads .env before anything else runs.
require("dotenv/config");

import { Client, GatewayIntentBits } from "discord.js";
import * as path from "path";
import { loadCommands } from "./commands/loader";
import { registerCommands } from "./commands/register";

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
'@ | Set-Content -Path "src\index.ts" -Encoding utf8

Write-Host "Creating src/services/database/index.ts..." -ForegroundColor Cyan

@'
export type UserRecord = {
  discordId: string;
  username: string;
  createdAt: Date;
  [key: string]: unknown;
};

export interface Database {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getUser(discordId: string): Promise<UserRecord | null>;
  upsertUser(user: UserRecord): Promise<void>;
}

class InMemoryDatabase implements Database {
  private store = new Map<string, UserRecord>();

  async connect(): Promise<void> {
    console.log("In-memory DB ready");
  }
  async disconnect(): Promise<void> {
    console.log("In-memory DB closed");
  }
  async getUser(discordId: string): Promise<UserRecord | null> {
    return this.store.get(discordId) ?? null;
  }
  async upsertUser(user: UserRecord): Promise<void> {
    this.store.set(user.discordId, user);
  }
}

// Stub singleton - swap for a real Postgres-backed implementation later.
export const db: Database = new InMemoryDatabase();
'@ | Set-Content -Path "src\services\database\index.ts" -Encoding utf8

Write-Host "Creating src/services/cache/index.ts..." -ForegroundColor Cyan

@'
export interface Cache {
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  get<T>(key: string): Promise<T | null>;
  del(key: string): Promise<void>;
  flush(): Promise<void>;
}

class MemoryCache implements Cache {
  private map = new Map<string, { value: unknown; expiresAt?: number }>();

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
    this.map.set(key, { value, expiresAt });
  }
  async get<T>(key: string): Promise<T | null> {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.map.delete(key);
      return null;
    }
    return entry.value as T;
  }
  async del(key: string): Promise<void> {
    this.map.delete(key);
  }
  async flush(): Promise<void> {
    this.map.clear();
  }
}

// Stub singleton - swap for a real Redis-backed implementation later.
export const cache: Cache = new MemoryCache();
'@ | Set-Content -Path "src\services\cache\index.ts" -Encoding utf8

Write-Host ""
Write-Host "Done. Every file and folder created." -ForegroundColor Green
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  npm install"
Write-Host "  npm run build"
Write-Host ""
Write-Host "Paste the RAW output of both commands back for verification." -ForegroundColor Yellow
