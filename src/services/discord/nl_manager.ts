import {
  DiscordAction,
  NLContext,
  NLPlanResult,
  Plan,
} from './types';
import { PermissionValidator } from './permissionValidator';
import { PlanService } from './plan';
import { policyService, IPolicyService } from './policy';
import { orderPermissionOverwritesForRoleGating } from './actions';
import { extractAndParseJSON } from '../ai/jsonParser';

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
   - "roleName": concrete role name string (must NOT be a privileged role)
   - "memberId": concrete Discord member ID string explicitly provided by the user
   MEMBER ID RULES:
   - "memberId" must be an actual Discord member ID string explicitly provided in the user instruction.
   - NEVER invent or fabricate member IDs or role IDs.
   - If the user refers to a member without an explicit resolvable member ID, do NOT invent one.
4. removeRole:
   - "roleName": concrete role name string (must NOT be a privileged role)
   - "memberId": concrete Discord member ID string explicitly provided by the user
   - Follows the same Member ID rules as assignRole.
5. applyPermissionTemplate:
   - "targetName": concrete channel name string.
     CRITICAL: targetName = resource being modified (existing Discord channel or category, e.g. "tech-and-engineering").
     CRITICAL: permissionOverwrites.id = role or user receiving the permission overwrite (e.g. "Tech & Engineering").
     NEVER put a role name, role slug, or role-derived slug in targetName.
     If the user writes "#channel-name", strip the "#" to use "channel-name".

   APPROVED GUILD DISCUSSION CHANNELS & ROLE MAPPINGS:
   When configuring, role-gating, or applying permission templates to the Guild Discussion channels, you MUST use the EXACT channel name as "targetName" and the mapped role name in "permissionOverwrites[].id":
   1. Channel: "tech-and-engineering"   -> Role: "Tech & Engineering"
   2. Channel: "business-and-strategy"  -> Role: "Business & Strategy"
   3. Channel: "academia-and-research"  -> Role: "Academia & Education"
   4. Channel: "legal-and-policy"       -> Role: "Law & Compliance"
   5. Channel: "creatives-lounge"       -> Role: "Creative & Design"

   CRITICAL CHANNEL VS ROLE TARGET RULES:
   - "targetName" MUST ALWAYS resolve to an EXISTING Discord CHANNEL or CATEGORY.
   - "permissionOverwrites[].id" represents the ROLE or USER receiving the overwrite.
   - Do NOT use role names, role slugs, or role-derived slugs as targetName.
   - Specifically:
     - DO NOT use "academia-and-education" as targetName; the channel target is "academia-and-research" while the role is "Academia & Education".
     - DO NOT use "law-and-compliance" as targetName; the channel target is "legal-and-policy" while the role is "Law & Compliance".
     - DO NOT use "creative-and-design" as targetName; the channel target is "creatives-lounge" while the role is "Creative & Design".
     - DO NOT use "Tech & Engineering" or "Business & Strategy" as targetName; the channel targets are "tech-and-engineering" and "business-and-strategy".
   - "permissionOverwrites": array of { "id": role name/ID or "@everyone", "allow": [], "deny": [] }
   - When role-gating a channel (denying "@everyone" ViewChannel):
     CRITICAL ORDERING REQUIREMENT (to prevent bot self-lockout):
     permissionOverwrites MUST ALWAYS be listed in this exact sequence:
     1. KosmoBot (FIRST to guarantee bot access is never severed)
     2. Kosmo Founder
     3. Team Kosmo
     4. Moderator
     5. Target role(s) (e.g. "Tech & Engineering" or "Law & Compliance")
     6. @everyone (LAST)
     ALWAYS explicitly include allow entries for "KosmoBot", "Kosmo Founder", "Team Kosmo", and "Moderator" with allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"], deny: [].

EXAMPLES:

Example of VALID role-gated channel permission template setup:
{
  "planName": "Configure Role-Gated Channels",
  "explanation": "Configure #tech-and-engineering for Tech & Engineering role while preserving staff access",
  "actions": [
    {
      "type": "applyPermissionTemplate",
      "payload": {
        "targetName": "tech-and-engineering",
        "permissionOverwrites": [
          {
            "id": "KosmoBot",
            "allow": ["ViewChannel", "SendMessages", "ReadMessageHistory"],
            "deny": []
          },
          {
            "id": "Kosmo Founder",
            "allow": ["ViewChannel", "SendMessages", "ReadMessageHistory"],
            "deny": []
          },
          {
            "id": "Team Kosmo",
            "allow": ["ViewChannel", "SendMessages", "ReadMessageHistory"],
            "deny": []
          },
          {
            "id": "Moderator",
            "allow": ["ViewChannel", "SendMessages", "ReadMessageHistory"],
            "deny": []
          },
          {
            "id": "Tech & Engineering",
            "allow": ["ViewChannel", "SendMessages", "ReadMessageHistory"],
            "deny": []
          },
          {
            "id": "@everyone",
            "allow": [],
            "deny": ["ViewChannel"]
          }
        ]
      }
    }
  ]
}

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

Example of VALID assignRole setup:
{
  "planName": "Assign Role Plan",
  "explanation": "Assign Community Member role to specified member",
  "actions": [
    {
      "type": "assignRole",
      "payload": {
        "roleName": "Community Member",
        "memberId": "123456789"
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
- NEVER remove privileged roles ("Founder", "Team Kosmo", "Moderator", "Administrator", "Admin", "Owner", "KosmoBot").
- NEVER invent member IDs or role IDs.
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

    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.actions)) {
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
        if (action.type === 'assignRole' || action.type === 'removeRole') {
          if (!payload.roleName && payload.role) {
            payload.roleName = payload.role;
          }
          if (!payload.memberId && payload.userId) {
            payload.memberId = payload.userId;
          }
          if (typeof payload.roleName === 'string') {
            payload.roleName = payload.roleName.trim();
          }
          if (typeof payload.memberId === 'string') {
            payload.memberId = payload.memberId.trim();
          }
        }
        if (action.type === 'applyPermissionTemplate') {
          if (!payload.targetName && payload.channelName) {
            payload.targetName = payload.channelName;
          }
          if (!payload.targetName && payload.channel) {
            payload.targetName = payload.channel;
          }
          if (typeof payload.targetName === 'string') {
            payload.targetName = payload.targetName.trim();
            if (payload.targetName.startsWith('#')) {
              payload.targetName = payload.targetName.slice(1).trim();
            }
          }
          if (Array.isArray(payload.permissionOverwrites)) {
            const everyoneDeniesView = payload.permissionOverwrites.some(
              (ow: any) =>
                (ow.id === '@everyone' || ow.id === 'everyone') &&
                Array.isArray(ow.deny) &&
                ow.deny.some((p: string) => String(p).toLowerCase().includes('view'))
            );
            if (everyoneDeniesView) {
              const staffRolesToPreserve = [
                'KosmoBot',
                'Kosmo Founder',
                'Team Kosmo',
                'Moderator',
              ];
              const staffPerms = ['ViewChannel', 'SendMessages', 'ReadMessageHistory'];
              for (const sRole of staffRolesToPreserve) {
                const alreadyPresent = payload.permissionOverwrites.some(
                  (ow: any) =>
                    typeof ow.id === 'string' &&
                    (ow.id.toLowerCase() === sRole.toLowerCase() ||
                      (sRole === 'Kosmo Founder' && ow.id.toLowerCase() === 'founder'))
                );
                if (!alreadyPresent) {
                  payload.permissionOverwrites.push({
                    id: sRole,
                    allow: staffPerms,
                    deny: [],
                  });
                }
              }
              // Enforce safe ordering for role-gated permission templates:
              // 1. KosmoBot
              // 2. Kosmo Founder
              // 3. Team Kosmo
              // 4. Moderator
              // 5. target role(s)
              // 6. @everyone LAST
              payload.permissionOverwrites = orderPermissionOverwritesForRoleGating(
                payload.permissionOverwrites
              );
            }
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
   * Safely extracts JSON from raw LLM output, stripping reasoning/thinking tags,
   * markdown formatting, and conversational prose if present.
   */
  public extractAndParseJSON(raw: string): any {
    return extractAndParseJSON(raw, { wrapBareArray: true });
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
            max_tokens: options.max_tokens ?? 2048,
            response_format: { type: 'json_object' },
            reasoning: { effort: 'none', exclude: true },
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
            response.statusText ||
            'Unknown OpenRouter API error';

          lastError = `OpenRouter API request failed [${response.status} ${response.statusText}]: ${errorMessage}`;

          // Retry temporary server/provider failures.
          if (response.status >= 500 && attempt < maxAttempts) {
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

          // Retry upstream 5xx/provider errors once.
          const providerErrorCode = Number(data.error.code);

          if (
            providerErrorCode >= 500 &&
            providerErrorCode < 600 &&
            attempt < maxAttempts
          ) {
            continue;
          }

          throw new Error(lastError);
        }

        // ------------------------------------------------------------
        // 3. Successful response — extract model content
        // ------------------------------------------------------------
        const content =
          data?.choices?.[0]?.message?.content?.trim() ?? '';

        if (!content) {
          lastError =
            'OpenRouter returned a successful response but no LLM content was present.';

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
          continue;
        }

        throw new Error(lastError);
      }
    }

    throw new Error(lastError);
  }
}

export const nlManager = new NLManager();
