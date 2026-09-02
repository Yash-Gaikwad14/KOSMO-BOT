# Kosmo Discord Community --- Final Technology Stack

## 1. Stack Objective

This technology stack is designed specifically for the **Kosmo Discord
Community Platform**.

The priority is to build a maintainable, production-ready system that
supports:

-   Discord automation
-   Community management
-   AI interactions
-   Economy and gamification
-   Support tickets
-   Moderation
-   Premium role synchronization
-   Kosmo web-app integration
-   Human administrative control

------------------------------------------------------------------------

## 2. Final Stack

  -----------------------------------------------------------------------
  Layer                   Technology              Decision
  ----------------------- ----------------------- -----------------------
  Discord Bot             **Discord.js +          Primary
                          TypeScript**            

  Application             **Modular TypeScript**  Primary
  Architecture                                    

  AI Service              **FastAPI + Python**    Optional, only when AI
                                                  complexity requires it

  LLM                     **Gemini / approved LLM Primary AI integration
                          provider**              

  Database                **PostgreSQL**          Primary persistent
                                                  database

  Cache / Queue           **Redis**               Primary temporary-state
                                                  system

  Containerization        **Docker**              Primary

  Hosting                 **Railway**             Initial production
                                                  platform

  CI/CD                   **GitHub Actions**      Primary

  Error Monitoring        **Sentry**              Primary

  Metrics                 **Prometheus +          Later-stage
                          Grafana**               

  Integration             **REST APIs +           Primary
                          Webhooks**              

  Version Control         **GitHub**              Primary
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 3. Discord Bot

### Discord.js + TypeScript

**Decision: Final**

Discord.js is the primary bot framework.

Reasons:

-   Strong Discord ecosystem
-   Excellent TypeScript support
-   Mature slash-command/component support
-   Suitable for roles and permissions
-   Suitable for channels and categories
-   Suitable for moderation
-   Suitable for ticket systems
-   Suitable for Discord events
-   Easy integration with REST APIs and webhooks
-   Good maintainability for a growing team

The project should **not** combine Discord.js, discord.py, Serenity, and
Discordgo.

One primary Discord framework keeps the architecture simpler.

------------------------------------------------------------------------

## 4. Application Structure

Use a modular TypeScript architecture instead of adding a framework such
as Nexcord unless a concrete requirement appears.

Recommended structure:

``` text
src/
├── commands/
│   ├── economy/
│   ├── moderation/
│   ├── support/
│   ├── premium/
│   ├── admin/
│   └── ai/
│
├── events/
│   ├── guild/
│   ├── member/
│   ├── interaction/
│   └── message/
│
├── modules/
│   ├── economy/
│   ├── tickets/
│   ├── moderation/
│   ├── referrals/
│   ├── premium/
│   ├── provisioning/
│   └── ai/
│
├── services/
│   ├── discord/
│   ├── database/
│   ├── payments/
│   ├── ai/
│   └── cache/
│
├── workers/
│   └── queues/
│
├── config/
└── index.ts
```

This keeps community, economy, support, premium, provisioning and AI
functionality separated.

------------------------------------------------------------------------

## 5. AI Layer

### Primary Bot

Discord.js handles:

-   Discord events
-   Slash commands
-   Permissions
-   User interaction
-   AI invocation
-   Rate-limit checks
-   Private threads

### Optional AI Service

Use:

**FastAPI + Python**

only if the AI system grows to require:

-   Complex prompt pipelines
-   RAG
-   ML processing
-   AI-specific background workers
-   Multiple AI providers
-   Advanced orchestration
-   Independent AI deployment

For simple LLM API calls, the Discord.js application can communicate
with the model directly without introducing another service.

### Recommended architecture

``` text
Discord
   |
   v
Discord.js
   |
   v
AI Gateway
   |
   +---- Simple AI request ---> LLM
   |
   +---- Complex AI request --> FastAPI
                                  |
                                  v
                                 LLM
```

------------------------------------------------------------------------

## 6. LLM

The architecture supports a Gemini-based implementation.

The model provider must be isolated behind an AI service/gateway so that
the application does not become tightly coupled to one provider.

Example:

``` text
Kosmo AI Gateway
      |
      +--> Gemini
      |
      +--> Future LLM Provider
```

This makes provider replacement easier.

------------------------------------------------------------------------

## 7. PostgreSQL

### Decision: Final

PostgreSQL is the primary persistent database.

Store:

-   Users
-   Discord accounts
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
-   Configuration
-   Audit logs
-   Moderation records

PostgreSQL is the **source of truth** for persistent application data.

------------------------------------------------------------------------

## 8. Redis

### Decision: Final

Redis is added as the high-speed temporary state layer.

Use it for:

-   LLM rate limits
-   Command cooldowns
-   Spam counters
-   Temporary sessions
-   Queue state
-   Caching
-   Distributed locks
-   Short-lived ticket/session state

Do not use Redis as the permanent source of truth for important
user/account data.

Architecture:

``` text
Application
   |
   +---- PostgreSQL ---> Permanent data
   |
   +---- Redis --------> Temporary/fast data
```

------------------------------------------------------------------------

## 9. Background Jobs & Queues

Background processing should be used for operations that should not
block Discord interactions.

Examples:

-   Server provisioning
-   Bulk channel creation
-   Referral calculations
-   Leaderboard updates
-   Scheduled rewards
-   Cleanup jobs
-   Analytics processing
-   Non-critical AI processing

Redis can provide the queue/state infrastructure.

Discord API operations must be rate-aware and queued where necessary.

------------------------------------------------------------------------

## 10. Server Hosting

### Railway

**Initial production recommendation: Railway**

Reasons:

-   Simple deployment
-   GitHub integration
-   Docker support
-   Suitable for continuously running Discord bots
-   Easy environment variables
-   Easy database/service deployment
-   Good fit for an MVP moving toward production

### Docker

Docker is the standard deployment unit.

``` text
GitHub
   |
   v
GitHub Actions
   |
   v
Docker Image
   |
   v
Railway
```

------------------------------------------------------------------------

## 11. Why Not Lambda as the Main Bot Host?

The Discord bot maintains a persistent connection with Discord's
gateway.

Therefore a continuously running container/service is a more natural
architecture than using AWS Lambda or Azure Functions as the primary bot
runtime.

Serverless functions can still be used for isolated webhook or auxiliary
workloads if required later.

------------------------------------------------------------------------


------------------------------------------------------------------------

## 13. Kosmo Web Integration

The Discord platform should communicate with the Kosmo web application
through:

-   REST APIs
-   Secure webhooks
-   Authenticated service-to-service requests

Potential integrations:

-   Compiles
-   Premium subscriptions
-   Account linking
-   User rewards
-   Feedback
-   Product events

------------------------------------------------------------------------

## 14. CI/CD

### GitHub Actions

Every production deployment should pass through automated checks.

Recommended pipeline:

``` text
Pull Request
     |
     v
Lint
     |
     v
Type Check
     |
     v
Unit Tests
     |
     v
Build
     |
     v
Docker Build
     |
     v
Deploy
```

Production deployment should happen from the protected production
branch.

------------------------------------------------------------------------

## 15. Testing

### TypeScript

Recommended:

-   Vitest or Jest
-   ESLint
-   TypeScript compiler

Test:

-   Economy calculations
-   Permission logic
-   Role assignment
-   Ticket workflows
-   Rate limits
-   Referral calculations
-   Premium synchronization
-   Provisioning idempotency
-   AI gateway behavior

### Python

If FastAPI is introduced:

-   Pytest
-   Ruff/formatting and linting
-   Type checking as appropriate

------------------------------------------------------------------------

## 16. Monitoring

### Sentry

Use Sentry from the beginning.

Monitor:

-   Application exceptions
-   Discord API failures
-   Command errors
-   AI failures
-   Payment webhook failures
-   Database errors
-   Queue failures

### Prometheus + Grafana

Introduce when operational metrics become important.

Track:

-   Command latency
-   API latency
-   Queue depth
-   AI usage
-   Error rates
-   Discord event processing
-   Database performance
-   Resource usage

------------------------------------------------------------------------

## 17. Security

Required controls:

-   Environment variables for secrets
-   No API keys in source control
-   Discord permission validation
-   Role hierarchy validation
-   Stripe webhook verification
-   API authentication
-   Rate limiting
-   Spam protection
-   Audit logging
-   Least-privilege service access where possible
-   Secure database credentials
-   Separate development and production environments

------------------------------------------------------------------------

## 18. Final Technology Decisions

### Use

**Core**

-   Discord.js
-   TypeScript
-   Node.js
-   PostgreSQL
-   Redis
-   Docker

**Infrastructure**

-   Railway
-   GitHub
-   GitHub Actions

**AI**

-   Gemini / approved LLM
-   FastAPI + Python only when AI complexity justifies a separate
    service

**Payments**

-   Stripe

**Monitoring**

-   Sentry
-   Prometheus + Grafana later

**Integration**

-   REST APIs
-   Webhooks

------------------------------------------------------------------------

## 19. Technologies Explicitly Not Selected as Core

These remain alternatives but are **not part of the finalized core
stack**:

-   discord.py
-   Serenity
-   Discordgo
-   Nexcord
-   VibeBot
-   YourBot
-   MongoDB
-   AWS Lambda as primary bot hosting
-   Azure Functions as primary bot hosting
-   Fly.io as the initial hosting platform

They may be reconsidered later if a concrete technical requirement
appears.

------------------------------------------------------------------------

## 20. Final Stack Summary

``` text
                    KOSMO DISCORD
                         |
                         v
                Discord.js + TypeScript
                         |
        +----------------+----------------+
        |                |                |
        v                v                v
   Community          Economy         Moderation
   Support            Rewards         AutoMod
   Premium            Referrals       Security
        |                |                |
        +----------------+----------------+
                         |
                         v
                    AI Gateway
                         |
              +----------+----------+
              |                     |
              v                     v
        Gemini / LLM         FastAPI (Optional)
              |
              v
         PostgreSQL
              +
            Redis
              |
              v
      Docker + Railway
              |
      GitHub Actions
              |
           Sentry

              |
              v
        Kosmo Web App
              |
            Stripe
```

**Final principle:**

> **Discord.js + TypeScript is the core. PostgreSQL is the source of
> truth. Redis handles fast temporary state and queues. Docker + Railway
> runs the system. GitHub Actions handles delivery. Sentry handles
> errors. Stripe handles premium subscriptions. AI remains modular and
> can use FastAPI when its complexity requires separation.**
