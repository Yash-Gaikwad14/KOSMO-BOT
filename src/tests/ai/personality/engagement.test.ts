// src/tests/ai/personality/engagement.test.ts

import {
  shouldPromoteAskKosmo,
  maybePromoteAskKosmo,
  ASKKOSMO_PROMOTION_TAG,
} from '../../../services/ai/personality/engagement';
import { PersonalityConfig } from '../../../config/personality';

describe('Engagement & AskKosmo Promotion (engagement.ts)', () => {
  const cfg: PersonalityConfig = {
    enabled: true,
    roastEnabled: true,
    introChannelId: '999',
  };

  test('promotes AskKosmo when user asks about building complex AI workflows', () => {
    const userPrompt = 'How do I build an AI workflow with multi-agent orchestration?';
    expect(shouldPromoteAskKosmo(userPrompt, false, cfg)).toBe(true);

    const botResponse = 'You should separate planner agents from execution workers.';
    const finalResponse = maybePromoteAskKosmo(userPrompt, botResponse, cfg, false);
    expect(finalResponse).toContain(ASKKOSMO_PROMOTION_TAG);
  });

  test('promotes AskKosmo when user asks for prompt engineering or prompt optimizer', () => {
    const userPrompt = 'Where can I find a good prompt engineering tool?';
    expect(shouldPromoteAskKosmo(userPrompt, false, cfg)).toBe(true);
  });

  test('does NOT promote AskKosmo on unrelated general chat', () => {
    const userPrompt = 'What is the time complexity of quicksort?';
    expect(shouldPromoteAskKosmo(userPrompt, false, cfg)).toBe(false);

    const botResponse = 'O(n log n) on average, O(n^2) worst case.';
    const finalResponse = maybePromoteAskKosmo(userPrompt, botResponse, cfg, false);
    expect(finalResponse).toBe(botResponse);
    expect(finalResponse).not.toContain('askkosmo.com');
  });

  test('does NOT promote AskKosmo on operational, moderation, or support queries', () => {
    const operationalPrompt = 'Can you ban this user and update role permissions?';
    expect(shouldPromoteAskKosmo(operationalPrompt, false, cfg)).toBe(false);
    expect(shouldPromoteAskKosmo(operationalPrompt, true, cfg)).toBe(false);
  });

  test('does NOT duplicate AskKosmo link if already present in bot response', () => {
    const userPrompt = 'How do I build an AI app?';
    const responseWithLink = 'Check out askkosmo.com for orchestrating workflows.';
    const result = maybePromoteAskKosmo(userPrompt, responseWithLink, cfg, false);

    expect(result).toBe(responseWithLink);
  });

  test('returns empty string if bot response is empty', () => {
    expect(maybePromoteAskKosmo('How to build AI app?', '', cfg, false)).toBe('');
  });
});
