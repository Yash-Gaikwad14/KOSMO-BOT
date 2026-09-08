// src/tests/ai/personality/intentRouter.test.ts

import { classifyUserIntent } from '../../../services/ai/personality/intentRouter';

describe('Intent Router (intentRouter.ts)', () => {
  describe('Homework / Offloading Intent', () => {
    test('routes homework requests to sharp roast and AskKosmo redirect', () => {
      const decision = classifyUserIntent('write my homework');
      expect(decision.intent).toBe('HOMEWORK_OFFLOADING');
      expect(decision.responseStyle).toBe('ROAST_AND_REDIRECT');
      expect(decision.staticResponse).toBeDefined();
      expect(decision.staticResponse?.length).toBeGreaterThan(20);
    });

    test('detects assignment and coursework offloading', () => {
      const decision = classifyUserIntent('Please do my assignment for class');
      expect(decision.intent).toBe('HOMEWORK_OFFLOADING');
    });

    test('detects college report requests', () => {
      const decision = classifyUserIntent('write my college report for physics');
      expect(decision.intent).toBe('HOMEWORK_OFFLOADING');
    });
  });

  describe('Free Token Begging Intent', () => {
    test('routes free token requests to playful roast', () => {
      const decision = classifyUserIntent('Can I get free tokens?');
      expect(decision.intent).toBe('FREE_TOKENS');
      expect(decision.responseStyle).toBe('ROAST');
      expect(decision.staticResponse).toBeDefined();
    });

    test('detects free API key requests for Claude and OpenAI', () => {
      expect(classifyUserIntent('give me free api keys').intent).toBe('FREE_TOKENS');
      expect(classifyUserIntent('give me an OpenAI key').intent).toBe('FREE_TOKENS');
      expect(classifyUserIntent('give me Gemini API keys').intent).toBe('FREE_TOKENS');
      expect(classifyUserIntent('free Claude API').intent).toBe('FREE_TOKENS');
    });
  });

  describe('Silly Question Intent', () => {
    test('routes absurd questions to playful roast', () => {
      const decision = classifyUserIntent('How do I download more RAM?');
      expect(decision.intent).toBe('SILLY_QUESTION');
      expect(decision.responseStyle).toBe('ROAST');
      expect(decision.staticResponse).toBeDefined();
    });

    test.each([
      ['can I download more RAM?'],
      ['can I make my laptop faster by deleting System32?'],
      ["can AI fix my broken code if I don't show it the code?"],
      ['Can you run linux on a toaster?'],
      ['is javascript a database'],
    ])('classifies silly question "%s" as SILLY_QUESTION', (input) => {
      const decision = classifyUserIntent(input);
      expect(decision.intent).toBe('SILLY_QUESTION');
      expect(decision.responseStyle).toBe('ROAST');
    });
  });

  describe('Code Vending / Massive Code Request Intent', () => {
    test.each([
      ['can you write all my code for me?'],
      ['write all my code'],
      ['write my entire application'],
      ['build my whole project'],
      ['make the entire website for me'],
    ])('classifies massive code request "%s" as CODE_VENDING', (input) => {
      const decision = classifyUserIntent(input);
      expect(decision.intent).toBe('CODE_VENDING');
      expect(decision.responseStyle).toBe('ROAST');
      expect(decision.staticResponse).toBeDefined();
      expect(decision.staticResponse).not.toContain('idiot');
    });
  });

  describe('Generic Low-Effort Begging Intent', () => {
    test.each([
      ['do everything for me'],
      ['just give me the answer'],
      ['make it perfect'],
      ["I don't want to think"],
      ['just do all the work for me'],
    ])('classifies low-effort request "%s" as GENERIC_BEGGING', (input) => {
      const decision = classifyUserIntent(input);
      expect(decision.intent).toBe('GENERIC_BEGGING');
      expect(decision.responseStyle).toBe('ROAST');
      expect(decision.staticResponse).toBeDefined();
    });
  });

  describe('Serious Support & Billing Intent', () => {
    test('routes billing and subscription issues to serious response with zero roast', () => {
      const decision = classifyUserIntent('I have a billing issue with my subscription charge');
      expect(decision.intent).toBe('SERIOUS_SUPPORT');
      expect(decision.responseStyle).toBe('SERIOUS');
      expect(decision.staticResponse).toContain('support ticket');
      expect(decision.staticResponse).not.toContain('roast');
      expect(decision.staticResponse).not.toContain('collapsed');
    });

    test('routes outages and critical bug reports to serious response', () => {
      const decision = classifyUserIntent('There is a critical bug outage in production');
      expect(decision.intent).toBe('SERIOUS_SUPPORT');
    });

    test.each([
      ['my payment failed'],
      ['payment failed and I need help'],
      ["I was charged but Pro isn't active"],
      ['billing issue'],
      ['subscription problem'],
      ['I need help with my payment'],
    ])('classifies realistic support wording "%s" as SERIOUS_SUPPORT with static ticket direction', (input) => {
      const decision = classifyUserIntent(input);
      expect(decision.intent).toBe('SERIOUS_SUPPORT');
      expect(decision.responseStyle).toBe('SERIOUS');
      expect(decision.staticResponse).toContain('support ticket');
      expect(decision.staticResponse).not.toContain('Push cleaner code');
      expect(decision.staticResponse).not.toContain('roast');
    });
  });

  describe('Discord Action Intent', () => {
    test('routes channel creation request to ACTION_PIPELINE', () => {
      const decision = classifyUserIntent('create channel tech-talk');
      expect(decision.intent).toBe('DISCORD_ACTION');
      expect(decision.responseStyle).toBe('ACTION_PIPELINE');
    });

    test('routes role assignment request to ACTION_PIPELINE', () => {
      const decision = classifyUserIntent('assign role Developer to <@123456789>');
      expect(decision.intent).toBe('DISCORD_ACTION');
      expect(decision.responseStyle).toBe('ACTION_PIPELINE');
    });

    test('routes moderation ban/kick request to ACTION_PIPELINE', () => {
      const decision = classifyUserIntent('ban <@123456789> for spamming');
      expect(decision.intent).toBe('DISCORD_ACTION');
      expect(decision.responseStyle).toBe('ACTION_PIPELINE');
    });
  });

  describe('Genuine Project & Technical Queries', () => {
    test('routes startup and workflow design queries to GENUINE_PROJECT', () => {
      const decision = classifyUserIntent('I have a project idea to optimize a workflow with multi-agent orchestration');
      expect(decision.intent).toBe('GENUINE_PROJECT');
      expect(decision.responseStyle).toBe('PROJECT_GUIDANCE');
      expect(decision.systemPromptModifier).toContain('askkosmo.com');
    });

    test('routes genuine algorithmic and coding queries to GENUINE_TECHNICAL', () => {
      const decision = classifyUserIntent('How does the Raft consensus algorithm handle split-brain scenarios?');
      expect(decision.intent).toBe('GENUINE_TECHNICAL');
      expect(decision.responseStyle).toBe('INTELLIGENT_ANSWER');
    });

    test.each([
      ['explain RAG'],
      ['what is RAG'],
      ['How do I implement payment retry logic in TypeScript?'],
      ['How does Stripe handle webhook signature verification?'],
      ['How does PostgreSQL implement MVCC and write-ahead logging?'],
    ])('preserves GENUINE_TECHNICAL classification for technical question "%s"', (input) => {
      const decision = classifyUserIntent(input);
      expect(decision.intent).toBe('GENUINE_TECHNICAL');
      expect(decision.responseStyle).toBe('INTELLIGENT_ANSWER');
    });
  });

  describe('Strict Intent Precedence Hierarchy', () => {
    test('DISCORD_ACTION precedes SERIOUS_SUPPORT and roasts (e.g. ban this user)', () => {
      const decision = classifyUserIntent('ban <@123456789> for payment scam');
      expect(decision.intent).toBe('DISCORD_ACTION');
      expect(decision.responseStyle).toBe('ACTION_PIPELINE');
    });

    test('SERIOUS_SUPPORT precedes roasts even if message mentions code or homework', () => {
      const decision = classifyUserIntent('my payment failed for pro subscription while doing homework');
      expect(decision.intent).toBe('SERIOUS_SUPPORT');
      expect(decision.responseStyle).toBe('SERIOUS');
      expect(decision.staticResponse).toContain('support ticket');
      expect(decision.staticResponse).not.toContain('roast');
    });

    test('HOMEWORK_OFFLOADING precedes generic code vending', () => {
      const decision = classifyUserIntent('write all my homework code for me');
      expect(decision.intent).toBe('HOMEWORK_OFFLOADING');
      expect(decision.responseStyle).toBe('ROAST_AND_REDIRECT');
    });

    test('CODE_VENDING routes to ROAST with witty architecture response', () => {
      const decision = classifyUserIntent('can you write all my code for me?');
      expect(decision.intent).toBe('CODE_VENDING');
      expect(decision.responseStyle).toBe('ROAST');
      expect(decision.staticResponse).toBeDefined();
    });

    test('GENERIC_BEGGING routes to ROAST with dry engineering sarcasm', () => {
      const decision = classifyUserIntent('I do not want to think, just give me the answer');
      expect(decision.intent).toBe('GENERIC_BEGGING');
      expect(decision.responseStyle).toBe('ROAST');
      expect(decision.staticResponse).toBeDefined();
    });
  });
});
