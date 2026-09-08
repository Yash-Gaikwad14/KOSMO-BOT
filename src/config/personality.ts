// src/config/personality.ts
/**
 * Configuration for KosmoBot personality, roasting, and community engagement.
 * Values are loaded from environment variables with safe production defaults.
 */

export interface PersonalityConfig {
  /** Whether personality-driven conversational responses and icebreakers are enabled */
  enabled: boolean;
  /** Whether playful roasting is permitted */
  roastEnabled: boolean;
  /** Discord Channel ID designated for newcomer introductions */
  introChannelId: string;
}

/**
 * Returns the current personality configuration parsed from environment variables.
 */
export function getPersonalityConfig(): PersonalityConfig {
  const enabledEnv = process.env.PERSONALITY_ENABLED;
  const roastEnv = process.env.ROAST_ENABLED;
  const introChannelId = process.env.INTRO_CHANNEL_ID ? process.env.INTRO_CHANNEL_ID.trim() : '';

  return {
    enabled: enabledEnv === undefined || enabledEnv.trim() === '' ? true : enabledEnv.trim().toLowerCase() !== 'false',
    roastEnabled: roastEnv === undefined || roastEnv.trim() === '' ? true : roastEnv.trim().toLowerCase() !== 'false',
    introChannelId,
  };
}
