// src/services/ai/jsonParser.ts

/**
 * Hardened JSON extraction and parsing utility for untrusted LLM output.
 *
 * Design Invariants:
 * 1. Prototype Pollution Defense: Strips/neutralizes dangerous prototype keys
 *    ('__proto__', 'constructor', 'prototype') recursively so parsed objects
 *    cannot pollute Object.prototype when processed downstream.
 * 2. Resource & Size Bounds: Rejects oversized inputs (>64KB) and caps object recursion
 *    depth (max 20 levels) to prevent ReDoS or call stack exhaustion.
 * 3. Preserves Existing Contract: Strips <think>/<thought> reasoning tags, extracts markdown
 *    code fences, locates outermost JSON objects/arrays, handles trailing commas, wraps bare arrays
 *    if requested, and rejects conversational non-JSON text.
 * 4. Fails Safely: Throws informative, predictable errors without logging raw LLM output.
 */

export const MAX_JSON_INPUT_LENGTH = 65536; // 64 KB
export const MAX_JSON_DEPTH = 20;

export interface ExtractAndParseJSONOptions {
  wrapBareArray?: boolean;
}

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Recursively sanitizes a parsed JSON structure to prevent prototype pollution
 * and bounded recursion depth.
 *
 * Drops any properties with keys matching '__proto__', 'constructor', or 'prototype'.
 * Creates plain objects without prototype pollution vulnerabilities.
 */
export function sanitizeParsedJSON(value: any, depth = 0): any {
  if (depth > MAX_JSON_DEPTH) {
    throw new Error(`JSON structure exceeds maximum allowed nesting depth of ${MAX_JSON_DEPTH}.`);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeParsedJSON(item, depth + 1));
  }

  const cleanObject: Record<string, any> = {};
  for (const key of Object.keys(value)) {
    if (DANGEROUS_KEYS.has(key)) {
      continue; // Strip prototype pollution keys
    }
    cleanObject[key] = sanitizeParsedJSON(value[key], depth + 1);
  }

  return cleanObject;
}

/**
 * Strips reasoning / thought tags from raw LLM output.
 */
export function stripReasoningTags(input: string): string {
  let text = input;
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  text = text.replace(/<thought>[\s\S]*?<\/thought>/gi, '');
  return text.trim();
}

/**
 * Cleans trailing commas before closing braces/brackets in candidate JSON.
 */
export function cleanTrailingCommas(candidate: string): string {
  return candidate.replace(/,\s*([}\]])/g, '$1');
}

/**
 * Core hardened JSON extraction and parsing function.
 */
export function extractAndParseJSON(raw: string, options: ExtractAndParseJSONOptions = {}): any {
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    throw new Error('Empty or invalid LLM response string.');
  }

  if (raw.length > MAX_JSON_INPUT_LENGTH) {
    throw new Error(`LLM response exceeds maximum allowed size (${MAX_JSON_INPUT_LENGTH} bytes).`);
  }

  const { wrapBareArray = true } = options;

  let text = raw.trim();

  // 1. Strip reasoning / thinking tags (e.g. <think>...</think> or <thought>...</thought>)
  text = stripReasoningTags(text);

  // 2. Check for markdown code fences first (```json ... ``` or ``` ... ```)
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    const fenceContent = codeBlockMatch[1].trim();
    try {
      const parsed = JSON.parse(fenceContent);
      const sanitized = sanitizeParsedJSON(parsed);
      if (Array.isArray(sanitized) && wrapBareArray) {
        return { actions: sanitized };
      }
      return sanitized;
    } catch {
      // If direct parse fails (e.g. trailing commas), continue to extractor using fenceContent
      text = fenceContent;
    }
  }

  // 3. Locate outermost JSON object `{ ... }` or array `[ ... ]`
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');

  let startIndex = -1;
  let endIndex = -1;

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIndex = firstBrace;
    endIndex = text.lastIndexOf('}');
  } else if (firstBracket !== -1) {
    startIndex = firstBracket;
    endIndex = text.lastIndexOf(']');
  }

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    const candidate = text.substring(startIndex, endIndex + 1).trim();
    try {
      const parsed = JSON.parse(candidate);
      const sanitized = sanitizeParsedJSON(parsed);
      if (Array.isArray(sanitized) && wrapBareArray) {
        return { actions: sanitized };
      }
      return sanitized;
    } catch (err: any) {
      // Attempt to clean trailing commas before closing braces/brackets
      try {
        const cleaned = cleanTrailingCommas(candidate);
        const parsed = JSON.parse(cleaned);
        const sanitized = sanitizeParsedJSON(parsed);
        if (Array.isArray(sanitized) && wrapBareArray) {
          return { actions: sanitized };
        }
        return sanitized;
      } catch {
        throw new Error(`Failed to parse extracted JSON block: ${err.message}`);
      }
    }
  }

  // 4. If no JSON structure was found, fail safely with an informative error
  throw new Error('AI planner returned a conversational or non-JSON text response instead of a structured plan.');
}
