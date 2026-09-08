import { Guild, Role, GuildChannel, ChannelType, CategoryChannel } from 'discord.js';

/**
 * Normalizes a channel or category name by:
 * - Stripping leading '#'
 * - Trimming whitespace
 * - Removing leading emojis, symbols, and decorative separators (e.g. "🎓・", "💻-", "📈 | ", "⚖️・", "🎨・")
 * - Normalizing whitespace and case (lowercase)
 */
export function normalizeChannelName(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let name = raw.trim();
  if (name.startsWith('#')) {
    name = name.slice(1).trim();
  }
  // Strip leading emojis, symbols, and decorative separators:
  // - Unicode pictographs / emojis (\p{Extended_Pictographic}, \p{Emoji_Component})
  // - Variation selectors \uFE0E, \uFE0F, Zero-width joiner \u200D, Keycaps \u20E3
  // - Decorative separators: ・ (\u30FB), · (\u00B7), • (\u2022), |, ~, —, –, :, _, -, /
  // - Surrounding whitespace
  // eslint-disable-next-line no-misleading-character-class, no-useless-escape -- Explicitly matching individual emoji variation selectors, ZWJs, and keycaps for decorative prefix stripping
  name = name.replace(/^[\p{Extended_Pictographic}\p{Emoji_Component}\uFE0E\uFE0F\u200D\u20E3\s・·•|~—–:_\-\/]+/u, '');
  return name.trim().toLowerCase();
}

/**
 * Converts a string into a standardized slug (lowercase, alphanumeric with hyphens, '&' replaced by 'and').
 */
export function slugify(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Find a role by Snowflake ID, exact name, case-insensitive name, or role slug.
 * Throws an informative error if matching produces multiple ambiguous roles.
 */
export function findRole(guild: Guild, nameOrId: string): Role | null {
  if (!nameOrId || typeof nameOrId !== 'string') return null;
  const clean = nameOrId.trim();
  if (!clean) return null;

  const roleCache = guild.roles?.cache;
  if (!roleCache) return null;

  // 1. Direct O(1) Snowflake ID lookup before any iteration
  const byId = roleCache.get(clean);
  if (byId) return byId;

  // For name-based matching, iterate cache without allocating intermediate full arrays where possible
  const exactMatches: Role[] = [];
  const lowerClean = clean.toLowerCase();
  const caseInsensitiveMatches: Role[] = [];
  const targetSlug = slugify(clean);
  const slugMatches: Role[] = [];

  for (const role of roleCache.values()) {
    if (role.name === clean) {
      exactMatches.push(role);
    }
    if (role.name.toLowerCase() === lowerClean) {
      caseInsensitiveMatches.push(role);
    }
    if (targetSlug && slugify(role.name) === targetSlug) {
      slugMatches.push(role);
    }
  }

  // 2. Exact name match
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) {
    throw new Error(
      `Role name "${nameOrId}" is ambiguous (matched ${exactMatches.length} roles: ${exactMatches.map(r => r.name).join(', ')}). Please specify the role by ID.`
    );
  }

  // 3. Case-insensitive exact name match
  if (caseInsensitiveMatches.length === 1) return caseInsensitiveMatches[0];
  if (caseInsensitiveMatches.length > 1) {
    throw new Error(
      `Role name "${nameOrId}" is ambiguous (matched ${caseInsensitiveMatches.length} roles: ${caseInsensitiveMatches.map(r => r.name).join(', ')}). Please specify the role by ID.`
    );
  }

  // 4. Role slug match (e.g. "academia-and-education" -> "Academia & Education")
  if (slugMatches.length === 1) return slugMatches[0];
  if (slugMatches.length > 1) {
    throw new Error(
      `Role slug "${targetSlug}" is ambiguous (matched ${slugMatches.length} roles: ${slugMatches.map(r => r.name).join(', ')}). Please specify the role by ID.`
    );
  }

  return null;
}

/**
 * Find a channel by Snowflake ID, exact channel name, case-insensitive channel name,
 * or safe normalized match (stripping leading emoji/decorative prefixes).
 * Fails safely with an informative error if normalized matching is ambiguous.
 */
export function findChannel(guild: Guild, nameOrId: string): GuildChannel | null {
  if (!nameOrId || typeof nameOrId !== 'string') return null;
  const raw = nameOrId.trim();
  const clean = raw.startsWith('#') ? raw.slice(1).trim() : raw;
  if (!clean) return null;

  const channelCache = guild.channels?.cache;
  if (!channelCache) return null;

  // 1. Direct O(1) Snowflake ID lookup before any iteration
  const byId = channelCache.get(clean);
  if (byId) return byId as GuildChannel;

  const exactMatches: GuildChannel[] = [];
  const lowerClean = clean.toLowerCase();
  const caseInsensitiveMatches: GuildChannel[] = [];
  const targetNorm = normalizeChannelName(clean);
  const normalizedMatches: GuildChannel[] = [];

  for (const channel of channelCache.values()) {
    const ch = channel as GuildChannel;
    if (ch.name === clean) {
      exactMatches.push(ch);
    }
    if (ch.name && ch.name.toLowerCase() === lowerClean) {
      caseInsensitiveMatches.push(ch);
    }
    if (targetNorm && ch.name && normalizeChannelName(ch.name) === targetNorm) {
      normalizedMatches.push(ch);
    }
  }

  // 2. Exact channel-name match
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) {
    throw new Error(
      `Channel name "${nameOrId}" is ambiguous (matched ${exactMatches.length} channels with exact name: ${exactMatches.map(c => c.name).join(', ')}). Please specify the channel by ID.`
    );
  }

  // 3. Case-insensitive exact channel-name match
  if (caseInsensitiveMatches.length === 1) return caseInsensitiveMatches[0];
  if (caseInsensitiveMatches.length > 1) {
    throw new Error(
      `Channel name "${nameOrId}" is ambiguous (matched ${caseInsensitiveMatches.length} channels: ${caseInsensitiveMatches.map(c => c.name).join(', ')}). Please specify the channel by ID.`
    );
  }

  // 4. Safe normalized match (removing leading emoji/decorative prefixes and normalizing case)
  if (targetNorm) {
    if (normalizedMatches.length === 1) return normalizedMatches[0];
    if (normalizedMatches.length > 1) {
      throw new Error(
        `Channel name "${nameOrId}" is ambiguous (normalized to "${targetNorm}" and matched ${normalizedMatches.length} channels: ${normalizedMatches.map(c => c.name).join(', ')}). Please specify the channel by ID.`
      );
    }
  }

  return null;
}

/**
 * Find a category by Snowflake ID, exact name, case-insensitive name, or normalized name.
 * Fails safely with an informative error if matching is ambiguous.
 */
export function findCategory(guild: Guild, nameOrId: string): CategoryChannel | null {
  if (!nameOrId || typeof nameOrId !== 'string') return null;
  const raw = nameOrId.trim();
  const clean = raw.startsWith('#') ? raw.slice(1).trim() : raw;
  if (!clean) return null;

  const channelCache = guild.channels?.cache;
  if (!channelCache) return null;

  // 1. Direct O(1) Snowflake ID lookup
  const byId = channelCache.get(clean);
  if (byId && (byId.type === ChannelType.GuildCategory || String(byId.type) === 'GUILD_CATEGORY')) {
    return byId as CategoryChannel;
  }

  const exactMatches: CategoryChannel[] = [];
  const lowerClean = clean.toLowerCase();
  const caseInsensitiveMatches: CategoryChannel[] = [];
  const targetNorm = normalizeChannelName(clean);
  const normalizedMatches: CategoryChannel[] = [];

  for (const channel of channelCache.values()) {
    if (channel.type === ChannelType.GuildCategory || String(channel.type) === 'GUILD_CATEGORY') {
      const cat = channel as CategoryChannel;
      if (cat.name === clean) {
        exactMatches.push(cat);
      }
      if (cat.name && cat.name.toLowerCase() === lowerClean) {
        caseInsensitiveMatches.push(cat);
      }
      if (targetNorm && cat.name && normalizeChannelName(cat.name) === targetNorm) {
        normalizedMatches.push(cat);
      }
    }
  }

  // 2. Exact match
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) {
    throw new Error(
      `Category name "${nameOrId}" is ambiguous (matched ${exactMatches.length} categories with exact name: ${exactMatches.map(c => c.name).join(', ')}). Please specify the category by ID.`
    );
  }

  // 3. Case-insensitive exact match
  if (caseInsensitiveMatches.length === 1) return caseInsensitiveMatches[0];
  if (caseInsensitiveMatches.length > 1) {
    throw new Error(
      `Category name "${nameOrId}" is ambiguous (matched ${caseInsensitiveMatches.length} categories: ${caseInsensitiveMatches.map(c => c.name).join(', ')}). Please specify the category by ID.`
    );
  }

  // 4. Safe normalized match
  if (targetNorm) {
    if (normalizedMatches.length === 1) return normalizedMatches[0];
    if (normalizedMatches.length > 1) {
      throw new Error(
        `Category name "${nameOrId}" is ambiguous (normalized to "${targetNorm}" and matched ${normalizedMatches.length} categories: ${normalizedMatches.map(c => c.name).join(', ')}). Please specify the category by ID.`
      );
    }
  }

  return null;
}
