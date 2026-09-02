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
