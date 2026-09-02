# Kosmo Discord Community Architecture (Final)

## 1. Project Goal

The goal of this project is to build a **Kosmo-specific Discord
Community Platform** that combines:

-   Community engagement
-   Kosmo product support
-   User feedback and bug reporting
-   AI-assisted support and community interaction
-   Gamification and rewards
-   Referral and reputation systems
-   Kosmo Pro/Max premium experiences
-   Human-controlled moderation and administration

The Discord bot automates repetitive operations, but **Kosmo Founder and
Team Kosmo retain full control and authority**.

This is **not a generic Discord server builder**. The server-building
capability is an automation feature used to deploy and maintain the
Kosmo community.

------------------------------------------------------------------------

## 2. Core Architecture Principle

### Human-Controlled + AI-Assisted Community

The system follows this hierarchy:

1.  **Kosmo Founder** --- Full administrative authority
2.  **Team Kosmo** --- Full operational authority
3.  **Kosmo Bot** --- Automation and AI execution layer
4.  **Moderator** --- Community moderation
5.  **Members / Premium / Dynamic Roles** --- Community participants

The bot must never replace the Founder or Team Kosmo. Human staff must
be able to intervene, override automated actions, manage users, and
resolve escalated support cases.

------------------------------------------------------------------------

## 3. Role Hierarchy

### Staff & Utility

1.  **Kosmo Founder** --- Full Admin
2.  **Team Kosmo** --- Full Admin
3.  **Kosmo Bot (The Architect)** --- Server automation, economy,
    moderation automation and AI functions
4.  **Moderator** --- Kick, ban, message management and timeout

### Premium & VIP

5.  **Kosmo VIP** --- Partners, influencers, investors
6.  **Kosmo Max** --- Highest paid tier
7.  **Kosmo Pro** --- Paid tier

### Engagement & Rewards

8.  **Feedback Champion** --- High-value feedback contributors
9.  **Top Inviter** --- Monthly referral leader
10. **High Roller / Level 50+** --- High-engagement cosmetic status

### Domain Guilds

Broad self-assigned guilds:

-   Tech & Engineering
-   Business & Strategy
-   Academia & Education
-   Law & Compliance
-   Creative & Design

The bot may additionally assign highly specific cosmetic roles such as
`React Native Developer` for profile flair and targeted community
communication.

### Base Role

**Kosmosian** --- Default member role.

------------------------------------------------------------------------

## 4. Community Channel Architecture

### INFORMATION

Read-only channels:

-   `#start-here`
-   `#announcements`
-   `#get-roles`

Only Founder and Team Kosmo can publish critical announcements.

### THE KOSMOVERSE

General community:

-   `#general-chat`
-   `#introductions`
-   `#kosmo-recipes`
-   `#showcase`

### THE ARCADE

Engagement and reward channels:

-   `#daily-rewards`
-   `#the-casino`
-   `#referral-leaderboard`
-   `#count-to-infinity`
-   `#daily-poll`

### GUILD DISCUSSIONS

Role-gated:

-   `#tech-and-engineering`
-   `#business-and-strategy`
-   `#academia-and-research`
-   `#legal-and-policy`
-   `#creatives-lounge`

### FEEDBACK & SUPPORT

-   `#feature-requests`
-   `#bug-reports`
-   `#contact-support`
-   `#champions-lounge`

### ACTIVE TICKETS

Private dynamically created ticket channels:

-   `#ticket-[username]`

Only the user, staff, and required bot functionality can access an
active ticket.

### KOSMO PRO & MAX

-   `#pro-lounge`
-   `#max-exclusive`
-   `#priority-support`

### VOICE & STAGES

-   `🎧 Lofi Study Lounge`
-   `💬 Open Watercooler`
-   `🎙️ Weekly Founder AMA`
-   `💎 Max Mastermind`

### INTERNAL

Staff-only:

-   `#team-chat`
-   `#mod-logs`

------------------------------------------------------------------------

## 5. Economy & Gamification

The community uses a three-tier economy.

### Kosmo Karma

Permanent reputation/status score.

Earned through:

-   Helpful participation
-   Community contributions
-   Positive feedback
-   Upvotes and valuable interactions

Karma cannot be gambled or lost.

Karma may influence:

-   LLM interaction limits
-   Daily Sparks allowance
-   Reputation status

### Sparks

Spendable engagement currency.

Users obtain Sparks through `/daily`, with the amount influenced by
Karma.

Sparks can be used for:

-   `/slots`
-   `/coinflip`
-   Cosmetic rewards
-   Other approved community rewards

Losing Sparks does not reduce Karma.

### Compiles

High-value Kosmo rewards.

Potential sources:

-   Accepted bug reports
-   High-value product feedback
-   Referral competitions
-   Other manually approved contributions

Compiles can be used inside the Kosmo web application.

------------------------------------------------------------------------

## 6. AI Bot Architecture

The Kosmo Bot has two major classes of functionality.

### Utility Functions

High-volume, non-LLM functions:

-   Role assignment
-   Welcome messages
-   Server setup
-   Channel creation
-   Support ticket creation
-   Moderation automation
-   Referral tracking
-   Economy commands

These should not consume LLM tokens.

### LLM Functions

Explicitly invoked AI functionality:

-   `/chat`
-   `@KosmoBot`
-   Kosmo-specific assistance
-   Community interaction
-   Approved AI workflows

LLM interactions are rate-limited by user tier and Karma.

### AI Limits

Initial limits:

-   Kosmosian: 5 interactions/hour
-   High-Karma user: up to 20/hour
-   Kosmo Pro: 50/hour
-   Kosmo Max: 200/hour

These values should remain configurable rather than hard-coded
throughout the application.

### Trigger Lock

The bot must not process normal community conversations as AI input
unless explicitly invoked.

Valid triggers include:

-   `@KosmoBot`
-   Slash commands
-   Approved interactive buttons/components

### Private AI Threads

For longer AI conversations:

1.  User invokes `/chat` or `Talk to Kosmo`
2.  Bot creates a private thread
3.  User and bot interact privately
4.  Staff/admins retain appropriate visibility
5.  Thread automatically archives after inactivity

------------------------------------------------------------------------

## 7. Support Architecture

### Level 1 --- AI Support

The bot initially attempts to resolve support requests.

### Level 2 --- Human Escalation

If the AI cannot resolve the issue, the ticket is escalated to:

-   Moderator
-   Team Kosmo
-   Founder when required

### Human Override

Staff must be able to:

-   Take over tickets
-   Close tickets
-   Reopen tickets
-   Override bot decisions
-   Apply moderation actions
-   Modify roles
-   Review logs

------------------------------------------------------------------------

## 8. Moderation & Security

### Link Policy

Allowed:

-   Kosmo creations
-   Kosmo prompts
-   Kosmo workflows
-   Approved content in `#showcase` and `#kosmo-recipes`

Restricted:

-   External links
-   Unsolicited promotion
-   Spam
-   Unsolicited DMs

### Strike System

Initial policy:

1.  First offense --- Delete + warning
2.  Second offense --- 10-minute timeout
3.  Third offense --- Permanent ban

Moderators can override or manually apply strikes.

### Raid & Spam Protection

-   Discord verification level: Medium initially
-   Spam detection
-   Economy anti-abuse controls
-   Rate limits
-   Moderation logs
-   Bot permission validation

------------------------------------------------------------------------

## 9. Server Provisioning

The Kosmo Bot acts as the automated server architect.

It can provision:

-   Roles
-   Categories
-   Channels
-   Permissions
-   Default configuration
-   Economy configuration
-   Moderation configuration

### Safe Provisioning

The setup system must:

-   Queue Discord API operations
-   Respect rate limits
-   Validate role hierarchy
-   Avoid duplicate resources
-   Resume safely after failure

### Idempotency

Running setup multiple times must only create missing resources and must
not duplicate existing channels or roles.

------------------------------------------------------------------------

## 10. System Architecture

``` text
                         KOSMO DISCORD
                              |
                              v
                  Discord.js + TypeScript
                              |
          +-------------------+-------------------+
          |                   |                   |
          v                   v                   v
     Community             Economy           Moderation
          |                   |                   |
      Roles/Channels      Karma/Sparks       AutoMod
      Guilds              Rewards            Strikes
      Referrals           Leaderboards       Raid Protection
          |                   |                   |
          +-------------------+-------------------+
                              |
                              v
                         AI Gateway
                              |
                              v
                     AI Service (Optional)
                         FastAPI/Python
                              |
                              v
                         Gemini / LLM
                              |
             +----------------+----------------+
             |                                 |
             v                                 v
        PostgreSQL                            Redis
     Source of Truth                 Cache / Rate Limits /
                                     Cooldowns / Queues

             |
             v
       Kosmo Web Backend
             |
       +-----+------+
       |            |
       v            v
    Stripe       Kosmo Account
       |
       v
 Discord Role Sync

             |
             v
      Docker + Railway
             |
      GitHub Actions
             |
        Sentry
```

------------------------------------------------------------------------

## 11. Data Ownership

### PostgreSQL

Primary persistent data:

-   Discord users
-   Karma
-   Sparks
-   Compiles
-   Roles
-   Guild memberships
-   Referrals
-   Tickets
-   Feedback
-   Bug reports
-   Premium subscriptions
-   Audit records
-   Configuration

### Redis

Temporary/high-speed data:

-   Rate limits
-   Cooldowns
-   Spam counters
-   Temporary sessions
-   Queue state
-   Short-lived cache
-   Distributed locks where required

------------------------------------------------------------------------

## 12. Premium Architecture

Premium membership is synchronized between Kosmo's payment system and
Discord.

``` text
User
 |
 v
Kosmo / Stripe
 |
 v
Payment Webhook
 |
 v
Kosmo Backend
 |
 v
Subscription Verification
 |
 v
Discord Bot
 |
 v
Assign / Remove Discord Role
 |
 +--> Kosmo Pro
 |
 +--> Kosmo Max
```

Discord roles must reflect verified subscription state rather than
trusting client-side requests.

------------------------------------------------------------------------

## 13. Observability

### Sentry

Track:

-   Bot crashes
-   Exceptions
-   Failed commands
-   AI errors
-   Integration failures
-   Ticket failures

### Metrics

Prometheus/Grafana can be introduced as the system grows for:

-   Command latency
-   API latency
-   Queue depth
-   AI usage
-   Error rate
-   Server activity
-   Resource usage

------------------------------------------------------------------------

## 14. Final Architectural Decision

The project is a **Kosmo-specific Discord Community Platform powered by
an automation and AI bot**.

The bot is an operational layer, not the owner of the community.

**Founder + Team Kosmo = human authority**

**Kosmo Bot = automation + AI assistant**

**PostgreSQL = persistent source of truth**

**Redis = fast temporary state**

**Kosmo Web App = product/premium integration**

**Discord = community interface**
