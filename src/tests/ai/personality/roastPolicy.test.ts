// src/tests/ai/personality/roastPolicy.test.ts

import {
  shouldRoast,
  isRoastProhibited,
  SAFE_ROAST_TEMPLATES,
} from '../../../services/ai/personality/roastPolicy';
import { PersonalityConfig } from '../../../config/personality';

describe('Roast Policy (roastPolicy.ts)', () => {
  const enabledConfig: PersonalityConfig = {
    enabled: true,
    roastEnabled: true,
    introChannelId: '999',
  };

  const disabledConfig: PersonalityConfig = {
    enabled: true,
    roastEnabled: false,
    introChannelId: '999',
  };

  describe('isRoastProhibited', () => {
    test('prohibits roasting when user asks to stop', () => {
      expect(isRoastProhibited('stop roasting me please')).toBe(true);
      expect(isRoastProhibited('please stop teasing')).toBe(true);
      expect(isRoastProhibited('no more roast')).toBe(true);
      expect(isRoastProhibited("don't roast")).toBe(true);
    });

    test('prohibits roasting in sensitive or protected contexts', () => {
      expect(isRoastProhibited('Is religion or race important here?')).toBe(true);
      expect(isRoastProhibited('I am feeling depressed and dealing with mental health')).toBe(true);
      expect(isRoastProhibited('I need a doctor or hospital')).toBe(true);
    });

    test('prohibits roasting in billing, payment, or support dispute contexts', () => {
      expect(isRoastProhibited('I need a refund on my billing subscription')).toBe(true);
      expect(isRoastProhibited('There is a major bug outage in production')).toBe(true);
      expect(isRoastProhibited('Can a support agent help with my ticket?')).toBe(true);
    });

    test('allows harmless engineering chatter', () => {
      expect(isRoastProhibited('How do I download more ram?')).toBe(false);
      expect(isRoastProhibited('Can you roast me?')).toBe(false);
      expect(isRoastProhibited('Please do my homework for me')).toBe(false);
    });
  });

  describe('shouldRoast', () => {
    test('returns shouldRoast: false if roastEnabled is false', () => {
      const decision = shouldRoast('Roast me please', disabledConfig);
      expect(decision.shouldRoast).toBe(false);
      expect(decision.reason).toContain('disabled');
    });

    test('triggers safe roast on explicit roast requests', () => {
      const decision = shouldRoast('Hey Kosmo, roast me', enabledConfig);
      expect(decision.shouldRoast).toBe(true);
      expect(decision.category).toBe('EXPLICIT_REQUEST');
      expect(decision.template).toBe(SAFE_ROAST_TEMPLATES.EXPLICIT_REQUEST[0]);
    });

    test('triggers safe roast on homework offloading', () => {
      const decision = shouldRoast('Can you do my homework for me?', enabledConfig);
      expect(decision.shouldRoast).toBe(true);
      expect(decision.category).toBe('HOMEWORK');
      expect(decision.template).toBe(SAFE_ROAST_TEMPLATES.HOMEWORK[0]);
    });

    test('triggers safe roast on free token begging', () => {
      const decision = shouldRoast('Give me free tokens please', enabledConfig);
      expect(decision.shouldRoast).toBe(true);
      expect(decision.category).toBe('FREE_TOKENS');
      expect(decision.template).toBe(SAFE_ROAST_TEMPLATES.FREE_TOKENS[0]);
    });

    test('triggers safe roast on silly questions', () => {
      const decision = shouldRoast('Can you help me download more RAM?', enabledConfig);
      expect(decision.shouldRoast).toBe(true);
      expect(decision.category).toBe('SILLY_QUESTION');
      expect(decision.template).toBe(SAFE_ROAST_TEMPLATES.SILLY_QUESTION[0]);
    });

    test('never roasts ordinary serious questions', () => {
      const decision = shouldRoast('How do I configure Redis replication in Kubernetes?', enabledConfig);
      expect(decision.shouldRoast).toBe(false);
      expect(decision.template).toBeUndefined();
    });

    test('blocks roast if request contains sensitive topic even if user asked for a roast', () => {
      const decision = shouldRoast('Roast me about my illness and depression', enabledConfig);
      expect(decision.shouldRoast).toBe(false);
      expect(decision.reason).toContain('prohibited');
    });
  });
});
