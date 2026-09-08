// src/tests/ai/jsonParser.test.ts

import {
  extractAndParseJSON,
  sanitizeParsedJSON,
  stripReasoningTags,
  cleanTrailingCommas,
  MAX_JSON_INPUT_LENGTH,
  MAX_JSON_DEPTH,
} from '../../services/ai/jsonParser';

describe('H-10: JSON Parser Hardening & Fuzz/Regression Testing', () => {
  afterEach(() => {
    // Ensure no prototype pollution leaks between tests
    delete (Object.prototype as any).polluted;
    delete (Object.prototype as any).injected;
    delete (Object.prototype as any).isAdmin;
  });

  describe('1. Prototype Pollution Hardening', () => {
    test('1a: Drops __proto__ properties and does not pollute Object.prototype', () => {
      const maliciousPayload = JSON.stringify({
        planName: 'Malicious Plan',
        __proto__: {
          polluted: true,
          isAdmin: true,
        },
        actions: [],
      });

      const parsed = extractAndParseJSON(maliciousPayload);

      expect(parsed.planName).toBe('Malicious Plan');
      expect((parsed as any).polluted).toBeUndefined();
      expect((Object.prototype as any).polluted).toBeUndefined();
      expect((Object.prototype as any).isAdmin).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'isAdmin')).toBe(false);
    });

    test('1b: Drops constructor and prototype keys in nested objects', () => {
      const payload = JSON.stringify({
        actions: [
          {
            type: 'createRole',
            payload: {
              name: 'TestRole',
              constructor: {
                prototype: {
                  polluted: 'yes',
                },
              },
            },
          },
        ],
      });

      const parsed = extractAndParseJSON(payload);

      expect(parsed.actions[0].payload.name).toBe('TestRole');
      expect(parsed.actions[0].payload.constructor).toBe(Object); // Standard Object.constructor, NOT overridden
      expect((Object.prototype as any).polluted).toBeUndefined();
    });

    test('1c: sanitizeParsedJSON cleans deeply nested prototype pollution attempts in arrays and objects', () => {
      const dirty = {
        nested: [
          {
            __proto__: { leaked: true },
            safeKey: 123,
            sub: {
              constructor: { prototype: { hack: true } },
              prototype: { evil: true },
              valid: 'ok',
            },
          },
        ],
      };

      const cleaned = sanitizeParsedJSON(dirty);

      expect((Object.prototype as any).leaked).toBeUndefined();
      expect((Object.prototype as any).hack).toBeUndefined();
      expect((Object.prototype as any).evil).toBeUndefined();
      expect(cleaned.nested[0].safeKey).toBe(123);
      expect(cleaned.nested[0].sub.valid).toBe('ok');
      expect(cleaned.nested[0].sub.prototype).toBeUndefined();
    });

    test('1d: Downstream Object.assign or spread with parsed payload never pollutes Object.prototype', () => {
      const payload = '{"__proto__": {"polluted": true}, "actions": []}';
      const parsed = extractAndParseJSON(payload);

      // Downstream code copying objects
      const merged = Object.assign({}, parsed);
      const cloned = { ...parsed };

      expect((Object.prototype as any).polluted).toBeUndefined();
      expect((merged as any).polluted).toBeUndefined();
      expect((cloned as any).polluted).toBeUndefined();
    });
  });

  describe('2. Malformed JSON Handling', () => {
    test('2a: Incomplete / truncated JSON fails safely without crash', () => {
      expect(() => extractAndParseJSON('{"foo":')).toThrow();
      expect(() => extractAndParseJSON('{"actions": [{"type": "createRole"')).toThrow();
      expect(() => extractAndParseJSON('{"planName": "Incomplete')).toThrow();
    });

    test('2b: Missing quotes or invalid keys fail safely', () => {
      expect(() => extractAndParseJSON('{foo: "bar"}')).toThrow();
      expect(() => extractAndParseJSON('{actions: []}')).toThrow();
    });

    test('2c: Completely non-JSON conversational text throws informative error', () => {
      expect(() =>
        extractAndParseJSON('I am an AI assistant and I cannot perform this action.')
      ).toThrow('conversational or non-JSON');
    });

    test('2d: Empty, whitespace-only, or invalid non-string inputs fail safely', () => {
      expect(() => extractAndParseJSON('')).toThrow('Empty or invalid LLM response string.');
      expect(() => extractAndParseJSON('   \n\t  ')).toThrow('Empty or invalid LLM response string.');
      expect(() => extractAndParseJSON(null as any)).toThrow('Empty or invalid LLM response string.');
      expect(() => extractAndParseJSON(undefined as any)).toThrow('Empty or invalid LLM response string.');
      expect(() => extractAndParseJSON(12345 as any)).toThrow('Empty or invalid LLM response string.');
    });

    test('2e: Inverted or dangling braces fail safely', () => {
      expect(() => extractAndParseJSON('}{')).toThrow('conversational or non-JSON');
      expect(() => extractAndParseJSON('][')).toThrow('conversational or non-JSON');
      expect(() => extractAndParseJSON('}{foo: 1}{')).toThrow(/Failed to parse extracted JSON block/);
    });
  });

  describe('3. Code Fences & Surrounding Prose', () => {
    test('3a: Correctly parses fenced JSON with json tag', () => {
      const raw = '```json\n{"planName": "Fenced", "actions": []}\n```';
      const parsed = extractAndParseJSON(raw);
      expect(parsed.planName).toBe('Fenced');
      expect(parsed.actions).toEqual([]);
    });

    test('3b: Correctly parses fenced JSON without json tag', () => {
      const raw = '```\n{"planName": "Untagged Fence", "actions": []}\n```';
      const parsed = extractAndParseJSON(raw);
      expect(parsed.planName).toBe('Untagged Fence');
    });

    test('3c: Correctly extracts JSON when surrounded by conversational prose', () => {
      const raw = `Here is the requested Discord plan:
      {
        "planName": "Prose Plan",
        "actions": [{ "type": "createChannel", "payload": { "name": "prose-chan" } }]
      }
      Hope this helps your server!`;

      const parsed = extractAndParseJSON(raw);
      expect(parsed.planName).toBe('Prose Plan');
      expect(parsed.actions).toHaveLength(1);
      expect(parsed.actions[0].payload.name).toBe('prose-chan');
    });

    test('3d: Strips <think> and <thought> reasoning tags before extraction', () => {
      const raw = `<think>
      The user wants to add a new VIP role.
      I need to construct a valid plan.
      </think>
      <thought>Double checking guidelines.</thought>
      {"planName": "Post-Reasoning", "actions": []}`;

      const parsed = extractAndParseJSON(raw);
      expect(parsed.planName).toBe('Post-Reasoning');
    });
  });

  describe('4. Trailing Commas & Bare Arrays', () => {
    test('4a: Cleans trailing commas in objects and arrays', () => {
      const raw = `
      {
        "planName": "Trailing Comma Test",
        "actions": [
          { "type": "createRole", "payload": { "name": "Role1", }, },
        ],
      }`;

      const parsed = extractAndParseJSON(raw);
      expect(parsed.planName).toBe('Trailing Comma Test');
      expect(parsed.actions).toHaveLength(1);
      expect(parsed.actions[0].payload.name).toBe('Role1');
    });

    test('4b: Wraps bare array in { actions: [...] } when wrapBareArray is true (default)', () => {
      const raw = '[{ "type": "createRole", "payload": { "name": "Wrapped" } }]';
      const parsed = extractAndParseJSON(raw);
      expect(parsed.actions).toBeDefined();
      expect(Array.isArray(parsed.actions)).toBe(true);
      expect(parsed.actions[0].payload.name).toBe('Wrapped');
    });

    test('4c: Preserves bare array when wrapBareArray is false', () => {
      const raw = '[{ "type": "createRole", "payload": { "name": "Unwrapped" } }]';
      const parsed = extractAndParseJSON(raw, { wrapBareArray: false });
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].payload.name).toBe('Unwrapped');
    });
  });

  describe('5. Nested Structures & Resource Limits', () => {
    test('5a: Parses legitimate nested structures up to depth limit', () => {
      const nested: any = { level0: true };
      let current = nested;
      for (let i = 1; i <= 15; i++) {
        current[`level${i}`] = { val: i };
        current = current[`level${i}`];
      }

      const raw = JSON.stringify({ planName: 'Deep Plan', data: nested, actions: [] });
      const parsed = extractAndParseJSON(raw);
      expect(parsed.planName).toBe('Deep Plan');
      expect(parsed.data.level0).toBe(true);
    });

    test('5b: Rejects structures exceeding MAX_JSON_DEPTH', () => {
      let current: any = { end: true };
      for (let i = 0; i < MAX_JSON_DEPTH + 5; i++) {
        current = { child: current };
      }

      const raw = JSON.stringify(current);
      expect(() => extractAndParseJSON(raw)).toThrow(
        `JSON structure exceeds maximum allowed nesting depth of ${MAX_JSON_DEPTH}`
      );
    });

    test('5c: Rejects inputs exceeding MAX_JSON_INPUT_LENGTH (64KB)', () => {
      const hugeString = 'a'.repeat(MAX_JSON_INPUT_LENGTH + 100);
      expect(() => extractAndParseJSON(hugeString)).toThrow(
        `LLM response exceeds maximum allowed size (${MAX_JSON_INPUT_LENGTH} bytes).`
      );
    });
  });

  describe('6. Unicode, Special Characters & Numeric Values', () => {
    test('6a: Preserves Unicode characters, emojis, and escaped characters', () => {
      const raw = JSON.stringify({
        planName: 'Unicode Test 🚀 🔥',
        rationale: 'He said "Hello" and \\path\\to\\dir',
        multiline: 'Line 1\nLine 2\tTabbed',
        actions: [{ type: 'createChannel', payload: { name: '💬-chat' } }],
      });

      const parsed = extractAndParseJSON(raw);
      expect(parsed.planName).toBe('Unicode Test 🚀 🔥');
      expect(parsed.rationale).toBe('He said "Hello" and \\path\\to\\dir');
      expect(parsed.actions[0].payload.name).toBe('💬-chat');
    });

    test('6b: Handles valid numbers and rejects NaN / Infinity', () => {
      const validNumbers = JSON.stringify({
        zero: 0,
        negative: -42,
        float: 3.14159,
        scientific: 1e6,
        actions: [],
      });

      const parsed = extractAndParseJSON(validNumbers);
      expect(parsed.zero).toBe(0);
      expect(parsed.negative).toBe(-42);
      expect(parsed.float).toBeCloseTo(3.14159);
      expect(parsed.scientific).toBe(1000000);

      // Invalid numeric values in JSON (NaN / Infinity are not valid JSON tokens)
      expect(() => extractAndParseJSON('{"val": NaN}')).toThrow();
      expect(() => extractAndParseJSON('{"val": Infinity}')).toThrow();
    });
  });

  describe('7. Deterministic Fuzz / Property Testing Harness', () => {
    // Deterministic pseudo-random number generator (PRNG - Mulberry32)
    function mulberry32(seed: number) {
      return function () {
        let t = (seed += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    test('7a: Invariant — Arbitrary generated inputs never crash process or pollute Object.prototype', () => {
      const random = mulberry32(1337); // Fixed seed for 100% deterministic reproducibility

      const tokens = [
        '{', '}', '[', ']', ':', ',', '"', "'", '`', '\\', '/',
        'true', 'false', 'null', '0', '1', '-1', '1e5',
        '__proto__', 'constructor', 'prototype', 'polluted', 'isAdmin',
        '```json', '```', '<think>', '</think>', '<thought>', '</thought>',
        'actions', 'type', 'createRole', 'payload', 'name', 'foo', 'bar',
        ' ', '\n', '\t', '🚀', '⚠️', 'abc', 'def'
      ];

      const NUM_ITERATIONS = 150;

      for (let i = 0; i < NUM_ITERATIONS; i++) {
        // Generate random sequence of tokens
        const tokenCount = Math.floor(random() * 25) + 1;
        let generated = '';
        for (let j = 0; j < tokenCount; j++) {
          const idx = Math.floor(random() * tokens.length);
          generated += tokens[idx];
          if (random() > 0.7) generated += ' ';
        }

        try {
          const result = extractAndParseJSON(generated);
          // If it succeeded, result must be a safe non-null object/array
          expect(result).toBeDefined();
        } catch {
          // Failure is expected and completely valid for malformed fuzz inputs
        }

        // CRITICAL INVARIANT: Object.prototype must NEVER be polluted
        expect((Object.prototype as any).polluted).toBeUndefined();
        expect((Object.prototype as any).isAdmin).toBeUndefined();
        expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
      }
    });

    test('7b: Deterministic Fuzz — Mutated valid plans either succeed safely or throw without crash', () => {
      const random = mulberry32(4242);
      const basePlan = JSON.stringify({
        planName: 'Fuzz Base Plan',
        actions: [
          {
            type: 'createRole',
            payload: { name: 'Member', color: 0xff0000 },
          },
        ],
      });

      const mutations = 100;
      for (let i = 0; i < mutations; i++) {
        let mutated = basePlan;
        const op = Math.floor(random() * 5);

        if (op === 0) {
          // Truncate at random point
          const cut = Math.floor(random() * mutated.length);
          mutated = mutated.substring(0, cut);
        } else if (op === 1) {
          // Insert random character
          const pos = Math.floor(random() * mutated.length);
          mutated = mutated.slice(0, pos) + '`~!@#$%^&*()_+' + mutated.slice(pos);
        } else if (op === 2) {
          // Insert malicious prototype keys
          const pos = Math.floor(random() * mutated.length);
          mutated = mutated.slice(0, pos) + '"__proto__": {"polluted": true},' + mutated.slice(pos);
        } else if (op === 3) {
          // Wrap with random reasoning or prose
          mutated = `<think>${'x'.repeat(Math.floor(random() * 50))}</think> Here is JSON: ` + mutated;
        } else {
          // Add trailing commas
          mutated = mutated.replace(/}/g, ',}');
        }

        try {
          const parsed = extractAndParseJSON(mutated);
          if (parsed && typeof parsed === 'object') {
            expect((parsed as any).polluted).toBeUndefined();
          }
        } catch {
          // Expected safe failure
        }

        // Invariant holds
        expect((Object.prototype as any).polluted).toBeUndefined();
        expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
      }
    });
  });
});
