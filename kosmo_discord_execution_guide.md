# KOSMO DISCORD EXECUTION GUIDE
## Custom KosmoBot — Server Setup & Discord Execution Specification

**Purpose:** Implementation/execution guide for the custom KosmoBot.

**Audience:** Antigravity / Person B / KosmoBot developer.

**Goal:** KosmoBot must inspect, create, configure, repair, and verify the Discord server according to the approved Kosmo project structure and rules.

---

# 1. ARCHITECTURE DECISION

The Team Leader's clarified requirement is:

> The team integrates the external services, while the custom KosmoBot performs the remaining Discord execution work.

External integrations:

- **Arcane** → XP / leveling / Karma
- **UnbelievaBoat** → Sparks / economy / casino
- **Ticket Tool** → ticket creation/workflow
- **InviteTracker** → invite/referral tracking
- **KosmoBot** → Discord server execution, orchestration, configuration, verification, and project rules

KosmoBot is therefore the **controlled Discord execution agent**.

---

# 2. OPERATING PRINCIPLE

KosmoBot should work in:

```text
INSPECT → PLAN → CONFIRM (when required) → EXECUTE → VERIFY → REPORT
```

It must not blindly execute a large natural-language request without checking the current server state.

---

# 3. CORE EXECUTION RULE

Before changing the server:

1. Read the requested action.
2. Inspect the existing server.
3. Determine what already exists.
4. Compare current state with this specification.
5. Build a minimal change plan.
6. Execute only required changes.
7. Verify the result.
8. Report exactly what changed.

The bot must be **idempotent**.

Running setup twice must not create duplicates.

---

# 4. PERMISSION MODEL

Recommended initial execution policy:

```text
Kosmo Founder → FULL EXECUTION
Team Kosmo    → FULL EXECUTION if explicitly enabled
Moderator     → LIMITED moderation actions only
High-Karma    → NO server-management execution
Kosmosian     → NO server-management execution
@everyone     → NO server-management execution
```

KosmoBot must obey Discord's real permission hierarchy.

It must never:

- Grant itself permissions.
- Move its own role above the server owner.
- Give Administrator merely because someone asks.
- Grant Founder/Team privileges through AI interpretation.
- Grant Moderator automatically from ordinary conversation.
- Bypass Discord permission checks.
- Remove the owner's permissions.
- Expose private channel content to unauthorized users.

---

# 5. SERVER INSPECTION

Provide an inspection layer for:

- Server ID/name
- Categories
- Channels
- Channel types
- Channel positions
- Roles
- Role hierarchy
- Role permissions
- Channel permission overwrites
- Bot permissions
- Available integrations

Implementation command names are up to the developer.

---

# 6. ROLE MANAGEMENT

Approved core roles:

```text
Kosmo Founder
Team Kosmo
KosmoBot
Moderator

Kosmo VIP
Kosmo Pro
Kosmo Max

Kosmosian
High-Karma User

Feedback Champion
Top Inviter
High Roller

Tech & Engineering
Business & Strategy
Academia & Education
Law & Compliance
Creative & Design
```

## Role safety

Never create/assign sensitive permission roles purely from AI inference.

Sensitive roles include:

- Kosmo Founder
- Team Kosmo
- Moderator
- Administrator-equivalent roles

## Dynamic professional roles

Kosmo may assign an approved cosmetic/professional role when a user explicitly states their profession/field.

Example:

> "I'm a React Native developer."

Map this to an approved role from a controlled role registry.

Do not create unlimited roles automatically.

---

# 7. HIGH-KARMA RULE

**High-Karma is earned through activity / leveling. It is not purchasable.**

Arcane is responsible for:

```text
XP → Level → High-Karma progression
```

KosmoBot must not:

- Sell High-Karma.
- Grant it for Sparks.
- Grant it merely because someone requests it.
- Use referral rewards to grant it.

---

# 8. CHANNEL / CATEGORY ARCHITECTURE

## INFORMATION

```text
#start-here
#announcements
#get-roles
```

Rules:

- `#start-here` → read-only for regular members
- `#announcements` → read-only for regular members
- `#get-roles` → onboarding/role selection

## THE KOSMOVERSE

```text
#general-chat
#introductions
#kosmo-recipes
#showcase
```

## THE ARCADE

```text
#daily-rewards
#the-casino
#referral-leaderboard
#count-to-infinity
#daily-poll
```

## GUILD DISCUSSIONS

```text
#tech-and-engineering
#business-and-strategy
#academia-and-research
#legal-and-policy
#creatives-lounge
```

Use appropriate guild-role restrictions.

## FEEDBACK & SUPPORT

```text
#feature-requests
#bug-reports
#contact-support
#champions-lounge
```

`#contact-support` contains the Ticket Tool entry point.

## KOSMO PRO & MAX

```text
#pro-lounge
#max-exclusive
#priority-support
```

## VOICE & STAGES

```text
Lofi Study Lounge
Open Watercooler
Weekly Founder AMA
Max Mastermind
```

## INTERNAL

```text
#team-chat
#mod-logs
```

These are staff-restricted.

## ACTIVE TICKETS

Hidden/private category for dynamic ticket channels:

```text
#ticket-username
```

---

# 9. CHANNEL PERMISSION TEMPLATES

Use deterministic templates rather than improvising permissions.

```text
PUBLIC
PUBLIC_READONLY
GUILD_ROLE_GATED
STAFF_ONLY
PREMIUM_ONLY
TICKET_PRIVATE
BOT_SYSTEM
```

### PUBLIC
Normal community access.

### PUBLIC_READONLY
Members can read but cannot send.

Used for:

- `#start-here`
- `#announcements`

### GUILD_ROLE_GATED
Requires the appropriate guild role.

### STAFF_ONLY
Used for:

- `#team-chat`
- `#mod-logs`

### PREMIUM_ONLY
Used for Pro/Max areas.

### TICKET_PRIVATE
Only the ticket requester, Ticket Tool/KosmoBot and authorized staff can access.

---

# 10. NATURAL-LANGUAGE SERVER MANAGEMENT

Authorized users should be able to say:

> "Create a text channel called project-ideas under THE KOSMOVERSE."

> "Create a private staff channel called event-planning."

> "Make this channel read-only for regular members."

> "Show me the permission configuration for #the-casino."

Natural language must always be converted into a validated structured action before Discord execution.

---

# 11. CONFIRMATION POLICY

## Low-risk actions

May execute immediately if the requester is authorized:

- Create an approved missing channel
- Create an approved missing category
- Apply an existing permission template
- Verify configuration
- Repair a missing non-sensitive configuration

## High-risk actions

Require explicit confirmation:

- Delete channel/category/role
- Change staff permissions
- Change premium permissions
- Bulk channel changes
- Rename existing channels
- Move large groups of channels
- Modify sensitive permission overwrites
- Kick/ban users
- Change bot/security configuration

Example:

```text
You are requesting:

DELETE #old-project

This action cannot be automatically undone.

Confirm? [Yes] [Cancel]
```

---

# 12. CHANNEL CREATION SAFETY

When creating a channel:

1. Check requester authorization.
2. Check whether it already exists.
3. Check target category.
4. Create the category only if authorized and required.
5. Apply the correct permission template.
6. Verify permissions.
7. Log the action.
8. Report completion.

Never create duplicates.

---

# 13. ROLE CREATION SAFETY

Before creating a role:

1. Search existing roles.
2. Match approved role name.
3. Check for equivalent roles.
4. Check required permissions.
5. Create only approved roles.
6. Position safely in the role hierarchy.
7. Verify permissions.

Never create Administrator permission through natural-language inference.

---

# 14. ECONOMY RULES

## Sparks

UnbelievaBoat handles Sparks/economy/casino.

KosmoBot must not create a second competing Sparks ledger.

## `/daily`

```text
Normal user → 500 Sparks/day
High-Karma → 2,000 Sparks/day
```

`/daily` is separate from UnbelievaBoat `/work`.

## High-Karma Role Income

A separate UnbelievaBoat setting was observed:

```text
High-Karma → 100 currency/hour
```

This is **not a required project rule**.

Do not rely on it for `/daily`.

If Person B confirms `/daily` is independent, the unnecessary Role Income entry can be removed.

---

# 15. CASINO ACCESS

Casino uses Sparks and does not affect Karma.

Expected access:

```text
@everyone       → DENY
High-Karma User → ALLOW
Team Kosmo      → ALLOW
Kosmo Founder   → ALLOW
```

Casino channel:

```text
#the-casino
```

KosmoBot should verify channel and relevant permissions.

---

# 16. KARMA / CASINO SEPARATION

Always preserve:

```text
Arcane
  ↓
XP / Level / Karma

UnbelievaBoat
  ↓
Sparks / Casino
```

Casino losses must never modify Karma.

---

# 17. MODERATION

## Link policy

Promotional/community links should use appropriate channels such as:

- `#showcase`
- `#kosmo-recipes`

Blind external-link dropping in protected community channels should be restricted according to the configured moderation policy.

## Strike system

```text
1st offense → Delete + warning/DM
2nd offense → 10-minute timeout
3rd offense → Permanent ban
```

Moderators may override where appropriate.

KosmoBot must not perform high-impact moderation from uncertain AI interpretation alone.

---

# 18. ONBOARDING

```text
New Member
   ↓
#start-here
   ↓
#introductions
   ↓
#get-roles
   ↓
Kosmosian / Guild role
   ↓
Community participation
   ↓
XP / Karma progression
```

## Icebreaker

When a new user introduces themselves in `#introductions`, KosmoBot may provide a concise welcome/icebreaker.

Do not repeatedly respond to the same introduction.

---

# 19. TICKETING

Ticket Tool remains responsible for ticket creation/workflow.

KosmoBot is the AI support layer:

```text
#contact-support
       ↓
Ticket Tool
       ↓
Private Ticket
       ↓
Kosmo Level-1 Support
       ↓
Human Staff Escalation
```

Kosmo must:

- Respect ticket privacy.
- Answer basic support questions.
- Escalate uncertain/complex/sensitive issues.
- Allow human escalation.
- Never expose ticket content elsewhere.

---

# 20. INVITETRACKER / REFERRALS

InviteTracker remains responsible for invite/referral tracking.

KosmoBot may orchestrate/display:

- Referral statistics
- Referral leaderboard
- Monthly leaderboard information

Rules:

- Do not double-count.
- Handle invalid/self-referrals.
- Keep referrals separate from Karma.
- Do not award High-Karma through referrals.

---

# 21. LLM RATE LIMITING

Recommended project limits:

```text
Kosmosian  → 5 interactions/hour
High-Karma → 20/hour
Kosmo Pro  → 50/hour
Kosmo Max  → 200/hour
```

When the limit is reached:

- Use a hardcoded response.
- Do not call the LLM again.
- Do not allow alternate triggers to bypass the limit.

---

# 22. DISCORD API RATE LIMITING

For bulk setup:

```text
Create category
  ↓
Queue
  ↓
Create channels
  ↓
Apply permissions
  ↓
Verify
```

Use safe queueing/retry/backoff behavior and avoid firing large numbers of requests simultaneously.

---

# 23. DRY-RUN MODE

Support:

> "Kosmo, audit the server against the execution guide."

Example:

```text
DRY RUN

Missing:
- #daily-rewards
- #referral-leaderboard

Incorrect:
- #announcements allows member messages

Correct:
- #general-chat
- #introductions
- #the-casino

Proposed changes:
1. Create #daily-rewards
2. Create #referral-leaderboard
3. Make #announcements read-only
```

Only execute high-impact changes after confirmation.

---

# 24. AUDIT MODE

KosmoBot should compare live Discord state against this guide.

Classify every item as:

```text
CORRECT
MISSING
INCORRECT
UNKNOWN
```

Example:

```text
KOSMO SERVER AUDIT

Categories:
✓ INFORMATION
✓ THE KOSMOVERSE
✗ THE ARCADE — missing #daily-rewards

Permissions:
✓ #announcements read-only
✗ #the-casino — @everyone still has access

Roles:
✓ High-Karma User
✓ Team Kosmo
✗ Missing Feedback Champion
```

---

# 25. REPAIR MODE

Authorized user:

> "Kosmo, repair the missing project configuration."

Workflow:

1. Audit.
2. Show proposed changes.
3. Confirm high-impact changes.
4. Execute.
5. Verify.
6. Report.

Never delete unrelated server content merely because it is not listed here.

---

# 26. LOGGING

Every server-management action should log:

```text
Timestamp
Requester
Action
Target
Old state
New state
Result
Error (if any)
```

Recommended destination:

```text
#mod-logs
```

Never log sensitive private ticket content.

---

# 27. ERROR HANDLING

If an operation fails:

1. Do not pretend it succeeded.
2. Record the error.
3. Explain what failed.
4. Preserve existing state where possible.
5. Retry only when safe.
6. Tell the requester what manual action is required.

Example:

> "I could not create #project-ideas because my bot role cannot manage channels in this category. No changes were made."

---

# 28. IDEMPOTENCY

If the bot receives:

> "Set up the Kosmo server."

multiple times, it must not create duplicate channels.

Instead:

```text
Existing → verify
Missing  → create
Correct  → leave unchanged
Incorrect → repair
```

---

# 29. COMMAND / ACTION DESIGN

Possible developer-facing commands:

```text
/kosmo setup
/kosmo audit
/kosmo repair
/kosmo inspect
/kosmo create-channel
/kosmo create-role
/kosmo configure
/kosmo verify
```

Exact command names are implementation details.

Natural-language requests should use the same safe action layer.

---

# 30. STRUCTURED ACTION MODEL

Internally, convert a natural-language request into something like:

```text
ACTION:
  type: CREATE_CHANNEL
  name: project-ideas
  category: THE KOSMOVERSE
  channel_type: text
  permission_template: PUBLIC
  requester: <authorized user>
  confirmation_required: false
```

Then the deterministic execution layer performs the Discord API action.

The LLM must **not directly control Discord APIs without validation**.

---

# 31. SECURITY BOUNDARY

The LLM decides intent.

The execution layer decides whether that intent is allowed.

```text
User request
    ↓
LLM interpretation
    ↓
Structured action
    ↓
Permission validator
    ↓
Policy validator
    ↓
Confirmation validator
    ↓
Discord execution
    ↓
Verification
```

This separation is mandatory.

---

# 32. TESTING CHECKLIST

## Server Setup
- [ ] Partial server setup works.
- [ ] No duplicate channels.
- [ ] No duplicate roles.
- [ ] Missing channels are created.
- [ ] Missing categories are created.
- [ ] Permissions apply correctly.
- [ ] Re-running setup is safe.

## Permissions
- [ ] Normal users cannot execute admin actions.
- [ ] High-Karma users cannot execute admin actions merely because of Karma.
- [ ] Authorized Founder can execute.
- [ ] Team Kosmo behavior matches configuration.
- [ ] Bot role hierarchy is sufficient.
- [ ] Sensitive roles cannot be granted by AI inference.

## Economy
- [ ] `/daily` gives 500 to normal users.
- [ ] `/daily` gives 2,000 to High-Karma.
- [ ] Casino uses Sparks.
- [ ] Casino does not modify Karma.
- [ ] Normal users cannot access restricted casino commands.
- [ ] High-Karma users can access casino.

## Ticketing
- [ ] Ticket remains private.
- [ ] Kosmo provides Level-1 support.
- [ ] Human escalation works.
- [ ] Private ticket content is not leaked.

## Referrals
- [ ] Invite attribution works.
- [ ] Leaderboard works.
- [ ] Duplicate events are handled.
- [ ] Referrals do not grant High-Karma.

## AI
- [ ] Trigger lock works.
- [ ] Rate limits work.
- [ ] Rate-limit response does not call the LLM.
- [ ] Context is limited appropriately.
- [ ] Errors are handled.

---

# 33. PRODUCTION SECURITY CHECKLIST

- [ ] No tokens/API keys in source control.
- [ ] Secrets use environment variables.
- [ ] Bot permissions are minimized.
- [ ] Founder/Team roles protected.
- [ ] Admin permission protected.
- [ ] Natural-language actions validated.
- [ ] Destructive actions confirmed.
- [ ] Audit logging enabled.
- [ ] Private tickets protected.
- [ ] LLM rate limiting enabled.
- [ ] Discord API queueing enabled.
- [ ] Idempotent setup verified.

---

# 34. FINAL EXECUTION WORKFLOW

Authorized request:

> "Kosmo, configure the server according to the execution guide."

KosmoBot should:

```text
1. Inspect
2. Audit
3. Generate change plan
4. Show high-impact changes
5. Request confirmation when necessary
6. Execute safe changes
7. Queue API operations
8. Verify every change
9. Report results
```

Example:

```text
KOSMO SERVER SETUP COMPLETE

Created:
✓ #daily-rewards
✓ #referral-leaderboard

Updated:
✓ #announcements → read-only
✓ #the-casino → restricted

Already correct:
✓ Arcane integration
✓ UnbelievaBoat integration
✓ Ticket Tool integration
✓ InviteTracker integration

Warnings:
⚠ Ticket Tool permissions require manual verification.

No destructive changes were made.
```

---

# 35. IMPORTANT BOUNDARY

This is the **execution specification**, not permission to destroy or redesign the server.

KosmoBot must:

- Preserve valid existing configuration.
- Change only what the project requires.
- Ask before destructive changes.
- Never invent business rules.
- Never invent sensitive permissions.
- Never replace Arcane, UnbelievaBoat, Ticket Tool, or InviteTracker with competing systems.
- Never treat AI inference as authorization.

---

# 36. IMPLEMENTATION PRIORITY

### Phase 1 — Foundation
- [ ] Discord inspection layer
- [ ] Permission validator
- [ ] Role/channel lookup
- [ ] Structured action system
- [ ] Idempotent creation

### Phase 2 — Execution
- [ ] Category creation
- [ ] Channel creation
- [ ] Permission templates
- [ ] Role management
- [ ] Verification

### Phase 3 — Automation
- [ ] Audit
- [ ] Repair
- [ ] Dry-run
- [ ] Natural-language management
- [ ] Confirmation system

### Phase 4 — Integrations
- [ ] Arcane status/verification
- [ ] UnbelievaBoat status/verification
- [ ] Ticket Tool workflow
- [ ] InviteTracker workflow

### Phase 5 — Production
- [ ] Rate limiting
- [ ] Discord API queue
- [ ] Logging
- [ ] Error recovery
- [ ] Security testing
- [ ] Full end-to-end test

---

# 37. DEFINITION OF DONE

KosmoBot is ready when an authorized project owner can ask it to configure the server and it can:

- Inspect the existing server.
- Compare it with this guide.
- Identify missing/incorrect configuration.
- Create missing categories/channels safely.
- Configure approved permissions.
- Create/assign approved non-sensitive roles.
- Protect sensitive roles.
- Verify integrations.
- Respect Arcane for Karma.
- Respect UnbelievaBoat for Sparks/casino.
- Respect Ticket Tool for tickets.
- Respect InviteTracker for referrals.
- Enforce LLM limits.
- Respect Discord API limits.
- Run repeatedly without duplicates.
- Ask for confirmation before destructive/high-impact actions.
- Log actions.
- Report success/failure accurately.

---

# 38. FUTURE EXTENSIONS

After the core execution layer is stable:

- Natural-language channel creation
- Channel renaming
- Channel archiving
- Permission-template switching
- Server health reports
- Automated configuration drift detection
- Scheduled server audits
- Guided onboarding configuration
- Automated project-environment setup

All extensions must use the same validated action layer and permission system.

---

# FINAL PRINCIPLE

**KosmoBot is the execution agent, not the owner of the server.**

The server owner/team defines the rules.

KosmoBot:

```text
UNDERSTANDS
   ↓
VALIDATES
   ↓
EXECUTES
   ↓
VERIFIES
   ↓
REPORTS
```

It must always remain within Discord permissions, project policy, and explicit authorization.
