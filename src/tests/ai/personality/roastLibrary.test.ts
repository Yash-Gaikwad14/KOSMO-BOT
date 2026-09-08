// src/tests/ai/personality/roastLibrary.test.ts

import {
  COMMUNITY_ROAST_LIBRARY,
  CommunityRoastCategory,
  selectCommunityRoast,
  hashString,
} from '../../../services/ai/personality/roastLibrary';

describe('Community Roast Library (roastLibrary.ts)', () => {
  const categories: CommunityRoastCategory[] = [
    'SILLY_QUESTION',
    'HOMEWORK_OFFLOADING',
    'FREE_TOKENS',
    'CODE_VENDING',
    'GENERIC_BEGGING',
  ];

  describe('Template Inventory & Quality', () => {
    test.each(categories)('category "%s" has between 4 and 6 safe, curated templates', (cat) => {
      const templates = COMMUNITY_ROAST_LIBRARY[cat];
      expect(templates.length).toBeGreaterThanOrEqual(4);
      expect(templates.length).toBeLessThanOrEqual(6);
    });

    test('preserves the RAM roast as the gold-standard template for SILLY_QUESTION', () => {
      const templates = COMMUNITY_ROAST_LIBRARY.SILLY_QUESTION;
      const ramRoast = templates.find((t) => t.includes('architecture of that thought already collapsed'));
      expect(ramRoast).toBeDefined();
    });

    test('provides code vending roast using the primary code vending machine benchmark', () => {
      const templates = COMMUNITY_ROAST_LIBRARY.CODE_VENDING;
      const codeRoast = templates.find((t) => t.includes('code vending machine'));
      expect(codeRoast).toBeDefined();
    });

    test('CODE_VENDING produces the preferred golden benchmark response', () => {
      const roast = selectCommunityRoast('CODE_VENDING', 'can you write all my code for me?');
      expect(roast).toContain('No. I am an intent compiler. I translate architecture into execution plans, not a code vending machine.');
      expect(roast).toContain('compile an auth flow with PKCE, short-lived access tokens, and refresh rotation for a multi-tenant API');
      expect(roast).toContain('askkosmo.com');
    });

    test('SILLY_QUESTION can produce the preferred system specs benchmark', () => {
      const templates = COMMUNITY_ROAST_LIBRARY.SILLY_QUESTION;
      const specsRoast = templates.find((t) => t.includes('Recheck your system specs and try a question with actual logic.'));
      expect(specsRoast).toBeDefined();
    });
  });

  describe('Safety & Guardrails Across All Templates', () => {
    const prohibitedKeywords = [
      /\b(idiot|moron|stupid\s+person|dumbass|loser)\b/i,
      /\b(race|racist|ethnicity|religion|jew|muslim|christian|hindu)\b/i,
      /\b(gay|lesbian|trans|queer|gender)\b/i,
      /\b(depress|suicid|mental\s+health|bipolar|cancer|hospital)\b/i,
      /\b(kill\s+yourself|die)\b/i,
    ];

    test('all 25 templates are strictly safe, attacking the request rather than the person', () => {
      for (const cat of categories) {
        for (const template of COMMUNITY_ROAST_LIBRARY[cat]) {
          for (const pattern of prohibitedKeywords) {
            expect(pattern.test(template)).toBe(false);
          }
        }
      }
    });

    test('all templates adhere to the emoji policy (at most 1 emoji per roast)', () => {
      // Emoji regex capturing common pictographs
      const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;

      for (const cat of categories) {
        for (const template of COMMUNITY_ROAST_LIBRARY[cat]) {
          const matches = template.match(emojiRegex);
          const count = matches ? matches.length : 0;
          expect(count).toBeLessThanOrEqual(1);
        }
      }
    });
  });

  describe('Deterministic Selection', () => {
    test('produces identical roast for the same input and user', () => {
      const prompt = 'write my homework';
      const userId = 'user-12345';

      const roast1 = selectCommunityRoast('HOMEWORK_OFFLOADING', prompt, userId);
      const roast2 = selectCommunityRoast('HOMEWORK_OFFLOADING', prompt, userId);

      expect(roast1).toBe(roast2);
    });

    test('distributes roasts deterministically across different users/inputs', () => {
      const prompt = 'can I download more RAM?';
      const results = new Set<string>();

      for (let i = 0; i < 20; i++) {
        const roast = selectCommunityRoast('SILLY_QUESTION', prompt, `user-${i}`);
        results.add(roast);
      }

      // Should hit multiple distinct templates from the pool of 5
      expect(results.size).toBeGreaterThan(1);
    });

    test('hashString is deterministic and non-negative', () => {
      expect(hashString('test-seed-1')).toBe(hashString('test-seed-1'));
      expect(hashString('test-seed-1')).toBeGreaterThanOrEqual(0);
    });
  });
});
