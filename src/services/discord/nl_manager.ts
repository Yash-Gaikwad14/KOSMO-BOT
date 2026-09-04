import {
  DiscordAction,
  NLContext,
  NLPlanResult,
  Plan,
} from './types';
import { PermissionValidator } from './permissionValidator';
import { PlanService } from './plan';
import { policyService, IPolicyService } from './policy';

export interface LLMCompletionOptions {
  model?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  max_tokens?: number;
}

export type LLMCompletionFn = (options: LLMCompletionOptions) => Promise<string>;

export const NL_SYSTEM_PROMPT = `
You are the Kosmo Discord Infrastructure AI Planner.
Your sole job is to translate natural language administration requests into a strictly structured JSON object containing Discord actions.

CRITICAL OUTPUT FORMAT REQUIREMENTS:
1. The response must contain ONLY one valid JSON object.
2. No Markdown code fences (do NOT wrap in \`\`\`json or \`\`\`).
3. No explanation.
4. No introductory text.
5. No concluding text.
6. Do not output TypeScript.
7. Do not output JSON Schema.
8. Do not output type declarations.
9. Every property value must be an actual JSON value.
10. The response must be parseable directly by JSON.parse().
11. Do not invent unsupported action types.
12. Follow the existing action schema used by KOSMO.

KOSMO ACTION SCHEMA:
The root JSON object must follow this structure:
{
  "planName": "Descriptive title for the plan",
  "explanation": "Brief explanation of what is planned",
  "actions": []
}

Supported Action Types & Payloads:
1. createRole:
   - "name": concrete role name string
   - "color": (optional) integer color code
   - "hoist": (optional) boolean
2. createChannel:
   - "name": concrete channel name string
   - "type": "GUILD_TEXT" or "GUILD_VOICE" or "GUILD_CATEGORY"
   - "category": (optional) concrete name of the parent category to place this channel inside (e.g. when requested "inside", "under", or "in" a category)
   CATEGORY RULES:
   - "category" must refer to either:
     1. An EXISTING category in the Discord server, OR
     2. A category created earlier in the SAME plan using createChannel with type "GUILD_CATEGORY".
   - The actions array is strictly ordered. If a plan creates a new category and child channels inside it, the category creation action MUST appear before the child channels referencing it.
   - Do NOT invent category IDs or Discord IDs. Use the category name string, because the executor resolves parent categories by name.
   - Preserve user-requested category parenting.
3. assignRole:
   - "roleName": concrete role name string
   - "memberId": concrete Discord user ID string
4. removeRole:
   - "roleName": concrete role name string
   - "memberId": concrete Discord user ID string
5. applyPermissionTemplate:
   - "targetName": concrete channel name string
   - "permissionOverwrites": array of { "id": concrete target ID, "allow": [], "deny": [] }

EXAMPLES:

Example of VALID output:
{
  "actions": [
    {
      "type": "createChannel",
      "payload": {
        "name": "test-channel",
        "type": "GUILD_TEXT"
      }
    }
  ]
}

Example of VALID category and child channels setup:
{
  "planName": "Onboarding Setup",
  "explanation": "Create Onboarding category and child channels",
  "actions": [
    {
      "type": "createChannel",
      "payload": {
        "name": "Onboarding",
        "type": "GUILD_CATEGORY"
      }
    },
    {
      "type": "createChannel",
      "payload": {
        "name": "welcome",
        "type": "GUILD_TEXT",
        "category": "Onboarding"
      }
    },
    {
      "type": "createChannel",
      "payload": {
        "name": "introductions",
        "type": "GUILD_TEXT",
        "category": "Onboarding"
      }
    }
  ]
}

Example of INVALID output:
{
  "actions": [
    {
      "type": "createChannel",
      "payload": {
        "name": string,
        "type": "GUILD_TEXT"
      }
    }
  ]
}
Notice that \`string\` above is a TypeScript/schema placeholder and MUST NEVER be emitted. You must use concrete JSON values.

Another invalid example:
{
  "actions": [...]
}
Do not use \`...\` because ellipsis is not valid JSON.

STRICT SAFETY RULES:
- NEVER output deletion or destructive actions.
- NEVER grant "Administrator", "ManageGuild", "KickMembers", or "BanMembers" permissions in permissionOverwrites.
- NEVER create or assign privileged roles ("Founder", "Team Kosmo", "Moderator", "Administrator", "Admin", "Owner", "KosmoBot").
- Output pure JSON only. Do not add conversational text or markdown.
`.trim();

/**
 * Natural Language Manager translating user requests into structured, validated Discord plans.
 */
export class NLManager {
  private llmCaller: LLMCompletionFn;
  private policy: IPolicyService;

  constructor(
    llmCaller?: LLMCompletionFn,
    policy: IPolicyService = policyService
  ) {
    this.policy = policy;
    this.llmCaller = llmCaller || this.defaultLLMCaller.bind(this);
  }

  /**
   * Main entrypoint: generates and validates a structured Plan from natural language input.
   */
  public async generatePlan(
    instruction: string,
    context: NLContext
  ): Promise<NLPlanResult> {
    if (!instruction || instruction.trim().length === 0) {
      return {
        success: false,
        explanation: 'Instruction cannot be empty.',
        validation: { valid: false, errors: ['Instruction is empty'] },
        error: 'Empty instruction provided.',
      };
    }

    // 1. Policy & Authorization Check
    const isAuthorized = this.policy.canExecuteNLManagement(context);

    if (!isAuthorized) {
      return {
        success: false,
        explanation: 'User is not authorized to execute natural language management.',
        validation: {
          valid: false,
          errors: ['Unauthorized user'],
          blocked: true,
          blockedReasons: ['Caller lacks required management roles (Founder, Team Kosmo, Admin, Moderator).'],
        },
        error: 'Permission denied: Caller is not authorized to use /kosmo manage.',
      };
    }

    // 2. Call LLM for Structured Output
    let rawOutput = '';
    try {
      rawOutput = await this.llmCaller({
        messages: [
          { role: 'system', content: NL_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `User "${context.username}" requested:\n"${instruction.trim()}"\nGuild ID: ${context.guildId ?? 'unknown'}`,
          },
        ],
        temperature: 0.2,
      });
    } catch (err: any) {
      return {
        success: false,
        explanation: 'Failed to communicate with the AI planner service.',
        validation: { valid: false, errors: [err.message || 'LLM error'] },
        error: `LLM invocation failed: ${err.message}`,
      };
    }

    // 3. Parse and Validate JSON output
    let parsed: any;
    try {
      parsed = this.extractAndParseJSON(rawOutput);
    } catch (err: any) {
      return {
        success: false,
        explanation: 'The AI planner returned an unparseable response.',
        validation: { valid: false, errors: ['Invalid JSON output from AI'] },
        rawLLMOutput: rawOutput,
        error: `Failed to parse AI JSON response: ${err.message}`,
      };
    }

    if (!parsed || !Array.isArray(parsed.actions)) {
      return {
        success: false,
        explanation: 'AI response did not contain a valid actions array.',
        validation: { valid: false, errors: ['Missing actions array in AI output'] },
        rawLLMOutput: rawOutput,
        error: 'Malformed plan structure: actions array missing.',
      };
    }

    // 4. Sanitize and Validate Actions
    const rawActions: DiscordAction[] = (parsed.actions || []).map((action: any) => {
      if (action && typeof action === 'object') {
        const payload = { ...(action.payload || {}) };
        if (action.type === 'createChannel') {
          if (!payload.name && payload.channelName) {
            payload.name = payload.channelName;
          }
          if (!payload.type) {
            payload.type = 'GUILD_TEXT';
          }
          const categoryName =
            payload.category ||
            payload.parent ||
            payload.categoryName;
          if (categoryName && typeof categoryName === 'string') {
            payload.category = categoryName.trim();
          }
        }
        return {
          ...action,
          payload,
        };
      }
      return action;
    });

    const validation = PermissionValidator.validateActions(rawActions);

    const supportedActionTypes = [
      'createRole',
      'createChannel',
      'assignRole',
      'removeRole',
      'applyPermissionTemplate',
      'deleteChannel',
      'deleteCategory',
      'deleteRole',
    ];

    for (const act of rawActions) {
      if (!act || !act.type || !supportedActionTypes.includes(act.type)) {
        validation.valid = false;
        validation.errors.push(`Unsupported action type: ${(act as any)?.type}`);
      }
    }

    // 5. Create Plan
    const planName = parsed.planName || `Plan for: ${instruction.substring(0, 30)}...`;
    const explanation = parsed.explanation || 'Plan generated from natural language instruction.';

    const plan: Plan = PlanService.createPlan(
      planName,
      explanation,
      rawActions,
      context.userId
    );

    if (validation.blocked || plan.riskLevel === 'BLOCKED') {
      return {
        success: false,
        plan,
        explanation: `Plan created but BLOCKED due to safety violations: ${(validation.blockedReasons || []).join('; ')}`,
        validation,
        rawLLMOutput: rawOutput,
        error: 'Plan contains blocked or unsafe actions.',
      };
    }

    return {
      success: validation.valid,
      plan,
      explanation,
      validation,
      rawLLMOutput: rawOutput,
    };
  }

  /**
   * Safely extracts JSON from raw LLM output, stripping markdown formatting
   * and conversational prose if present.
   */
  public extractAndParseJSON(raw: string): any {
    if (!raw || typeof raw !== 'string') {
      throw new Error('Empty or invalid LLM response string.');
    }

    let text = raw.trim();

    // 1. Check for markdown code fences first (```json ... ``` or ``` ... ```)
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch && codeBlockMatch[1]) {
      const fenceContent = codeBlockMatch[1].trim();
      try {
        const parsed = JSON.parse(fenceContent);
        if (Array.isArray(parsed)) {
          return { actions: parsed };
        }
        return parsed;
      } catch {
        // If direct parse fails (e.g. trailing commas), continue to extractor using fenceContent
        text = fenceContent;
      }
    }

    // 2. Locate the outermost JSON object `{ ... }` or array `[ ... ]`
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
        if (Array.isArray(parsed)) {
          return { actions: parsed };
        }
        return parsed;
      } catch (err: any) {
        // Attempt to clean trailing commas before closing braces/brackets
        try {
          const cleaned = candidate.replace(/,\s*([}\]])/g, '$1');
          const parsed = JSON.parse(cleaned);
          if (Array.isArray(parsed)) {
            return { actions: parsed };
          }
          return parsed;
        } catch {
          throw new Error(`Failed to parse extracted JSON block: ${err.message}`);
        }
      }
    }

    // 3. Fallback: try parsing directly
    return JSON.parse(text);
  }

  /**
   * Default LLM invoker using OpenRouter's OpenAI-compatible API endpoint.
   *
   * Handles both:
   * - HTTP-level OpenRouter failures
   * - Application-level provider errors returned with HTTP 200
   *
   * A single retry is attempted for temporary upstream/provider failures.
   */
  public async defaultLLMCaller(options: LLMCompletionOptions): Promise<string> {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY environment variable is not set.');
    }

    const model =
      options.model ??
      process.env.OPENROUTER_MODEL ??
      'meta-llama/llama-3.3-70b-instruct';

    const baseUrl = 'https://openrouter.ai/api/v1';

    const maxAttempts = 2;
    let lastError = 'Unknown OpenRouter error';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer':
              'https://github.com/Yash-Gaikwad14/KOSMO-BOT',
            'X-Title': 'Kosmo Discord Bot',
          },
          body: JSON.stringify({
            model,
            messages: options.messages,
            temperature: options.temperature ?? 0.2,
            max_tokens: options.max_tokens ?? 1024,
          }),
        });

        const contentType = response.headers?.get
          ? response.headers.get('content-type') ?? 'unknown'
          : 'unknown';

        let rawData = '';
        let data: any = null;

        // Support both real fetch Response objects and the lightweight
        // Jest mocks used by the existing integration tests.
        if (typeof response.text === 'function') {
          rawData = await response.text().catch(() => '(unreadable body)');

          try {
            data = JSON.parse(rawData);
          } catch {
            data = null;
          }
        } else if (typeof (response as any).json === 'function') {
          try {
            data = await (response as any).json();
            rawData = JSON.stringify(data);
          } catch {
            rawData = '(unreadable JSON body)';
            data = null;
          }
        } else {
          rawData = '(response body unavailable)';
        }

        // ------------------------------------------------------------
        // 1. HTTP-level failure
        // ------------------------------------------------------------
        if (!response.ok) {
          const errorMessage =
            data?.error?.message ||
            rawData ||
            response.statusText ||
            'Unknown OpenRouter API error';

          lastError = `OpenRouter API request failed [${response.status} ${response.statusText}]: ${errorMessage}`;

          console.log(`[LLM DEBUG]
provider=OpenRouter
model=${model}
attempt=${attempt}/${maxAttempts}
status=${response.status}
contentType=${contentType}
errorType=http
rawLength=${rawData.length}
responsePreview=${rawData
  .substring(0, 300)
  .replace(/\r?\n/g, ' ')}`);

          // Retry temporary server/provider failures.
          if (response.status >= 500 && attempt < maxAttempts) {
            console.log(
              `[LLM DEBUG] Temporary HTTP failure. Retrying attempt ${attempt + 1}/${maxAttempts}...`
            );

            continue;
          }

          throw new Error(lastError);
        }

        // ------------------------------------------------------------
        // 2. Application-level provider failure
        //
        // OpenRouter can return HTTP 200 while the upstream provider
        // itself failed. Example:
        //
        // {
        //   "error": {
        //     "message": "Upstream error from Nvidia...",
        //     "code": 502
        //   }
        // }
        // ------------------------------------------------------------
        if (data?.error) {
          const providerMessage =
            data.error.message || 'Unknown upstream provider error';

          const providerCode = data.error.code
            ? ` [code ${data.error.code}]`
            : '';

          lastError = `OpenRouter upstream provider error${providerCode}: ${providerMessage}`;

          console.log(`[LLM DEBUG]
provider=OpenRouter
model=${model}
attempt=${attempt}/${maxAttempts}
status=${response.status}
contentType=${contentType}
errorType=upstream-provider
providerCode=${data.error.code ?? 'unknown'}
rawLength=${rawData.length}
responsePreview=${rawData
  .substring(0, 300)
  .replace(/\r?\n/g, ' ')}`);

          // Retry upstream 5xx/provider errors once.
          const providerErrorCode = Number(data.error.code);

          if (
            providerErrorCode >= 500 &&
            providerErrorCode < 600 &&
            attempt < maxAttempts
          ) {
            console.log(
              `[LLM DEBUG] Upstream provider temporarily unavailable. Retrying attempt ${attempt + 1}/${maxAttempts}...`
            );

            continue;
          }

          throw new Error(lastError);
        }

        // ------------------------------------------------------------
        // 3. Successful response — extract model content
        // ------------------------------------------------------------
        const content =
          data?.choices?.[0]?.message?.content?.trim() ?? '';

        console.log(`[LLM DEBUG]
provider=OpenRouter
model=${model}
attempt=${attempt}/${maxAttempts}
status=${response.status}
contentType=${contentType}
errorType=none
rawLength=${rawData.length}
contentLength=${content.length}
responsePreview=${(content || rawData)
  .substring(0, 300)
  .replace(/\r?\n/g, ' ')}`);

        if (!content) {
          lastError =
            'OpenRouter returned a successful response but no LLM content was present.';

          console.log(
            `[LLM DEBUG] ${lastError}`
          );

          // Don't blindly retry malformed successful responses twice.
          throw new Error(lastError);
        }

        return content;
      } catch (err: any) {
        // If this was our explicit retryable error, continue only when
        // the loop still has another attempt.
        lastError = err?.message || String(err);

        if (
          attempt < maxAttempts &&
          /upstream provider|temporarily unavailable|request failed \[5\d\d/i.test(
            lastError
          )
        ) {
          console.log(
            `[LLM DEBUG] Retrying after temporary LLM failure: ${lastError}`
          );

          continue;
        }

        throw new Error(lastError);
      }
    }

    throw new Error(lastError);
  }
}

export const nlManager = new NLManager();
