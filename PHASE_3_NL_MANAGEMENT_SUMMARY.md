# Kosmo Discord Agent — Phase 3: Natural Language Management Summary

**Project:** KOSMO-BOT  
**Repository:** [Yash-Gaikwad14/KOSMO-BOT](https://github.com/Yash-Gaikwad14/KOSMO-BOT.git)  
**Assigned Engineer:** Aditya (`aditya/phase3-ai`)  
**Base Commit:** `c91a22d` (`feat: complete phase 2 discord execution`)  
**Feature Branch:** `aditya/phase3-ai`  
**Latest Commit:** `ecc21f0` (`feat: add phase 3 natural language management`)  

---

## 1. Executive Summary & Objective

In Phase 3, we implemented the end-to-end **Natural Language Management (NL Management)** subsystem for KOSMO-BOT. This subsystem enables privileged Discord operators to issue high-level instructions in plain English (via the `/kosmo manage <instruction>` slash command) and have the system safely plan and propose structured Discord mutations.

The implementation strictly honors the core architectural invariant:
> **AI decides WHAT should happen.**  
> **Policy decides WHETHER it is allowed.**  
> **Human decides WHETHER the plan should execute.**  
> **The existing executor (`runAction`) decides HOW Discord is mutated.**

---

## 2. Architectural Pipeline

```text
User: /kosmo manage "<instruction>"
         │
         ▼
┌────────────────────────────────────────────────────────┐
│ 1. Policy & Authorization Check (policy.ts)            │
│    - Validates caller roles (Founder, Admin, Mod, etc) │
└────────────────────────────────────────────────────────┘
         │ (Authorized)
         ▼
┌────────────────────────────────────────────────────────┐
│ 2. Structured LLM Planner (nl_manager.ts)              │
│    - Prompts LLM for strict JSON schema                │
│    - Strips code fences & handles parsing errors       │
└────────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────────┐
│ 3. Sanitization & Safety Check (permissionValidator.ts)│
│    - Blocks destructive channel / role deletions       │
│    - Blocks Administrator / ManageGuild escalations    │
│    - Blocks tampering with protected roles             │
└────────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────────┐
│ 4. Risk Classification & Plan Build (plan.ts)          │
│    - Assigns Risk Level: LOW | MEDIUM | HIGH | BLOCKED │
│    - Packages actions into a typed Plan object         │
└────────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────────┐
│ 5. Human Confirmation UI (manage.ts)                   │
│    - Renders Discord Embed summary of proposed actions │
│    - Requires explicit /kosmo confirm <id> approval    │
│    - ZERO auto-execution                               │
└────────────────────────────────────────────────────────┘
         │ (After Human Confirmation)
         ▼
┌────────────────────────────────────────────────────────┐
│ 6. Existing Phase 2 Executor (actions.ts: runAction)   │
│    - Atomic, idempotent Discord API mutations          │
└────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Component Breakdown

### 3.1. Shared Types & Contracts (`src/services/discord/types.ts`)
- **Preserved Phase 2 Action Types**:
  - `createRole`: `{ name: string; color?: number; hoist?: boolean }`
  - `createChannel`: `{ name: string; type: 'GUILD_TEXT' | 'GUILD_VOICE' | 'GUILD_CATEGORY' }`
  - `assignRole`: `{ roleName: string; memberId: string }`
  - `removeRole`: `{ roleName: string; memberId: string }`
  - `applyPermissionTemplate`: `{ targetName: string; permissionOverwrites: PermissionOverwrite[] }`
- **Phase 3 Additions**:
  - `RiskLevel`: `'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'BLOCKED'`
  - `PlanStatus`: `'PROPOSED' | 'CONFIRMED' | 'EXECUTED' | 'REJECTED' | 'CANCELLED'`
  - `Plan`: Represents the unit of human review, storing metadata, action list, risk rating, and status.
  - `NLContext`: Captures caller information, guild ID, channel context, and assigned roles.
  - `NLPlanResult`: Result payload carrying the plan, explanation, validation metrics, and error diagnostics.

### 3.2. Security & Permission Validator (`src/services/discord/permissionValidator.ts`)
- **Protected Roles**: Prohibits creation, modification, or assignment of core administrative roles:
  - `Founder`, `Team Kosmo`, `Moderator`, `Administrator`, `Admin`, `Owner`, `KosmoBot`.
- **Forbidden Permissions**: Strict regex/list check preventing dangerous permission assignments via permission overwrites:
  - `Administrator`, `ManageGuild`, `KickMembers`, `BanMembers`.
- **Dual API Support**:
  - `validateAction(guild: Guild, action: DiscordAction): void` — legacy synchronous thrower for `runAction()`.
  - `PermissionValidator.validateAction(action: DiscordAction): ValidationResult` — structured result returning warnings and blocked reasons without throwing.

### 3.3. Central Policy Layer (`src/services/discord/policy.ts`)
- Implements `IPolicyService` and `PolicyService`.
- Rejects requests from unauthorized server members before calling any LLM API endpoint.
- Logical management roles recognized: `founder`, `team kosmo`, `admin`, `administrator`, `moderator`.

### 3.4. Plan Creation & Risk Assessment (`src/services/discord/plan.ts`)
- Evaluates individual and aggregate actions to assign an accurate risk profile:
  - `LOW`: Simple text channel creations and non-privileged role setups.
  - `MEDIUM`: Permission template modifications on channels/categories.
  - `HIGH`: Assigning or removing roles containing staff/mod indicators.
  - `BLOCKED`: Any plan containing violations caught by `PermissionValidator`.
- Provides `formatPlanSummary(plan: Plan)` for consistent markdown formatting in Discord responses.

### 3.5. Natural Language Manager (`src/services/discord/nl_manager.ts`)
- Connects to OpenAI-compatible LLM endpoints (Google Gemini / Grok).
- Implements `NL_SYSTEM_PROMPT` instructing the model to output **JSON only** adhering to the schema.
- Resilient JSON parser that handles:
  - Markdown code block wrapping (````json ... ````).
  - Malformed or non-JSON conversational text (caught and safely reported without unhandled exceptions).
- Injects full dependency mocking (`llmCaller` function) for unit testing without network dependencies.

### 3.6. Slash Command Handler (`src/commands/kosmo/manage.ts`)
- Implements the `/kosmo manage` subcommand using `discord.js` `SlashCommandBuilder`.
- Extracts user context and deferred interaction handling.
- Presents human confirmation instructions (`/kosmo confirm <plan.id>` / `/kosmo cancel <plan.id>`).

---

## 4. Quality Assurance & Test Verification

All unit tests were developed under Jest (`ts-jest`) in `src/tests/discord/nl_manager.test.ts`.

### Test Suite Execution Output
```text
$ npm test

> kosmo-bot@1.0.0 test
> jest

PASS src/tests/discord/actions.test.ts
PASS src/tests/discord/permissionValidator.test.ts
PASS src/tests/discord/nl_manager.test.ts
  Phase 3 Natural Language Management (NLManager)
    √ TEST 1: Valid NL request converts into expected Plan and DiscordAction[] (12 ms)
    √ TEST 2: Dangerous action (admin escalation / privileged role creation) is blocked (2 ms)
    √ TEST 3: Malformed or non-JSON output is safely handled without crash (2 ms)
    √ TEST 4: Unauthorized management requests are rejected before LLM call (1 ms)
    √ TEST 5: Protected role tampering and permissionValidator checks are strictly enforced (2 ms)

Test Suites: 3 passed, 3 total
Tests:       9 passed, 9 total
Snapshots:   0 total
Time:        11.002 s
Ran all test suites.
```

### TypeScript Compilation Check
```text
$ npm run build

> kosmo-bot@1.0.0 build
> tsc

Process exited with code 0 (Clean build, 0 errors).
```

---

## 5. Summary of Safety Constraints Enforced

| Constraint | Enforcement Mechanism | Result if Violated |
|---|---|---|
| Destructive Data Deletions | `PermissionValidator` | Plan marked `BLOCKED`, error returned |
| Privileged Role Creation | `PermissionValidator.validateAction` | Blocked reason added, Plan rejected |
| Administrator Escalation | `PermissionValidator` & `types.ts` | Overwrite rejected, Plan marked `BLOCKED` |
| Unauthorized User Call | `PolicyService.canExecuteNLManagement` | LLM invocation bypassed, request rejected |
| Direct Discord API Mutation | `NLManager` isolation | Zero mutation calls in AI layer |
| Auto-execution | `handleKosmoManageCommand` | Plan presented for human `/kosmo confirm` |

---

## 6. Remote Repository & Pull Request Details

- **Remote URL:** `https://github.com/Yash-Gaikwad14/KOSMO-BOT.git`
- **Branch:** `aditya/phase3-ai`
- **PR URL:** [https://github.com/Yash-Gaikwad14/KOSMO-BOT/pull/new/aditya/phase3-ai](https://github.com/Yash-Gaikwad14/KOSMO-BOT/pull/new/aditya/phase3-ai)
- **Status:** Complete, fully tested, committed, and ready for integration.
