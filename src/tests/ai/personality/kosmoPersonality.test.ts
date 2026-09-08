// src/tests/ai/personality/kosmoPersonality.test.ts

import {
  KOSMO_PERSONALITY_SYSTEM_PROMPT,
  sanitizeConversationalResponse,
  buildPersonalityPrompt,
} from '../../../services/ai/personality/kosmoPersonality';
import { PersonalityConfig } from '../../../config/personality';

describe('Kosmo Personality Core (kosmoPersonality.ts)', () => {
  describe('KOSMO_PERSONALITY_SYSTEM_PROMPT', () => {
    test('contains direct, confident, and no-em-dash constraints', () => {
      expect(KOSMO_PERSONALITY_SYSTEM_PROMPT).toContain('KosmoBot');
      expect(KOSMO_PERSONALITY_SYSTEM_PROMPT).toContain('NO EM DASHES');
      expect(KOSMO_PERSONALITY_SYSTEM_PROMPT).toContain('Untrusted Output Boundary');
      expect(KOSMO_PERSONALITY_SYSTEM_PROMPT).toContain('Discord-Native & Concise');
    });
  });

  describe('sanitizeConversationalResponse', () => {
    test('strips em dash (—) and en dash (–) characters', () => {
      const inputWithEmDash = 'Interesting idea — the weak part is the assumption — start with the workflow.';
      const sanitized = sanitizeConversationalResponse(inputWithEmDash);

      expect(sanitized).not.toContain('—');
      expect(sanitized).not.toContain('–');
      expect(sanitized).toBe('Interesting idea - the weak part is the assumption - start with the workflow.');
    });

    test('normalizes extra whitespace while preserving meaningful newlines', () => {
      const input = '  First sentence.   \n\n   Second sentence with   spaces.   ';
      const sanitized = sanitizeConversationalResponse(input);

      expect(sanitized).toBe('First sentence.\n\nSecond sentence with spaces.');
    });

    test('handles empty or falsy inputs safely', () => {
      expect(sanitizeConversationalResponse('')).toBe('');
      expect(sanitizeConversationalResponse(null as any)).toBe('');
      expect(sanitizeConversationalResponse(undefined as any)).toBe('');
    });
  });

  describe('buildPersonalityPrompt', () => {
    test('returns base prompt when personality is disabled', () => {
      const cfg: PersonalityConfig = {
        enabled: false,
        roastEnabled: false,
        introChannelId: '123',
      };

      const result = buildPersonalityPrompt('Custom base prompt', cfg);
      expect(result).toBe('Custom base prompt');
    });

    test('combines system persona and base prompt when personality is enabled', () => {
      const cfg: PersonalityConfig = {
        enabled: true,
        roastEnabled: true,
        introChannelId: '123',
      };

      const result = buildPersonalityPrompt('Custom operational guidelines', cfg);
      expect(result).toContain(KOSMO_PERSONALITY_SYSTEM_PROMPT);
      expect(result).toContain('ADDITIONAL INSTRUCTIONS:\nCustom operational guidelines');
    });

    test('returns pure persona prompt if base prompt is not provided', () => {
      const cfg: PersonalityConfig = {
        enabled: true,
        roastEnabled: true,
        introChannelId: '',
      };

      const result = buildPersonalityPrompt(undefined, cfg);
      expect(result).toBe(KOSMO_PERSONALITY_SYSTEM_PROMPT);
    });
  });
});
