# KOSMO-BOT Production Operations Runbook

This document is the authoritative operations guide for deploying, running, and maintaining KOSMO-BOT in production environments.

---

## 1. Production Prerequisites

- **Node.js**: `v20.x` or `v22.x` LTS
- **Package Manager**: `npm v10.x+`
- **PostgreSQL**: `v15+` (with connection pooling and SSL enabled)
- **Redis**: `v7+` (configured with `maxmemory-policy noeviction`)
- **Process Manager**: Docker / Kubernetes / systemd / PM2

---

## 2. Environment Configuration

Copy `.env.example` to `.env` and supply environment-specific credentials:

```bash
cp .env.example .env
```

### Environment Variables Reference

| Variable | Type | Required | Default | Description |
|---|---|---|---|---|
| `NODE_ENV` | String | Yes | `development` | Set to `production` in live environments to enforce fail-closed checks. |
| `DISCORD_BOT_TOKEN` | Secret | Yes | - | Discord Bot Authentication Token. |
| `DISCORD_APP_ID` | String | Yes | - | Discord Application (Client) ID. |
| `DISCORD_GUILD_ID` | String | Yes | - | Primary Discord Guild (Server) ID. |
| `DATABASE_URL` | Secret | Yes | - | PostgreSQL connection URI (`postgres://user:pass@host:5432/dbname`). |
| `DATABASE_POOL_MAX` | Integer | No | `20` | Maximum connections in the centralized PostgreSQL pool. |
| `DATABASE_IDLE_TIMEOUT_MS` | Integer | No | `30000` | Idle client timeout in milliseconds. |
| `DATABASE_CONN_TIMEOUT_MS` | Integer | No | `5000` | Connection acquisition timeout in milliseconds. |
| `DATABASE_SSL` | Boolean | No | `false` | Enable SSL (`require` or `true`). |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | Boolean | No | `true` | Reject unauthorized SSL certificates in production. |
| `REDIS_URL` | Secret | Yes | - | Redis connection URI (`redis://:pass@host:6379`). |
| `OPENROUTER_API_KEY` | Secret | Yes | - | OpenRouter API Key for AI operations. |
| `OPENROUTER_MODEL` | String | No | `meta-llama/llama-3.3-70b-instruct` | Upstream model identifier. |
| `UNBELIEVABOAT_API_KEY` | Secret | Optional | - | UnbelievaBoat API key for economy balance operations. |
| `HIGH_KARMA_ROLE_ID` | String | Optional | - | Role ID representing high-karma Discord members. |
| `PERSONALITY_ENABLED` | Boolean | No | `true` | Enables/disables conversational personality & icebreakers. |
| `ROAST_ENABLED` | Boolean | No | `true` | Enables/disables playful roasting for silly/homework requests. |
| `INTRO_CHANNEL_ID` | String | No | `""` | Dedicated Discord channel ID for newcomer introduction icebreakers. |

> **Security Note**: Never commit the `.env` file or paste production credentials into source control.

---

## 3. Discord Developer Portal Configuration

### Gateway Intents
In the Discord Developer Portal under **Bot -> Privileged Gateway Intents**, configure:
- **Server Members Intent (`GuildMembers`)**: **REQUIRED** (Role hierarchy, member lookup, karma checks)
- **Message Content Intent**: Optional for mention-driven interactions (Discord delivers content on direct bot mentions natively). If enabled, ensures complete channel-wide visibility.

### Client Options & Cache Sweepers
KOSMO-BOT automatically configures conservative native cache limits under H-05:
- `MessageManager`: Capped at 100 messages per text channel.
- `Message Sweeper`: Sweeps every 3,600s (1h), evicting messages older than 1,800s (30m).
- Category A caches (`roles`, `channels`, `guilds`, `members`) are **never swept** to preserve O(1) hierarchy validation.

### Required Discord Bot Permissions
When generating the bot OAuth2 invite URL, request the following permissions:
- **Manage Roles** (`MANAGE_ROLES`)
- **Manage Channels** (`MANAGE_CHANNELS`)
- **View Channels** (`VIEW_CHANNEL`)
- **Send Messages** (`SEND_MESSAGES`)
- **Read Message History** (`READ_MESSAGE_HISTORY`)
- **Embed Links** (`EMBED_LINKS`)
- **Use External Emojis** (`USE_EXTERNAL_EMOJIS`)
- **Add Reactions** (`ADD_REACTIONS`)

---

## 4. PostgreSQL Setup & Migrations

### Architecture
PostgreSQL is the durable source of truth for:
- Audit events (`audit_events`)
- Guild configuration (`guild_configs`)
- Daily claims history (`daily_claims`)
- Introduction welcomes (`introduction_welcomes`)
- Moderation cases and strikes (`moderation_cases`, `moderation_strikes`)
- Premium entitlements (`premium_entitlements`)

### Startup Migrations
Migrations run automatically on application startup via `db.migrate()`.
- Migration tracking table: `schema_migrations (version PRIMARY KEY, applied_at TIMESTAMPTZ)`.
- All migrations execute inside transactional boundaries (`BEGIN ... COMMIT / ROLLBACK`).
- In `NODE_ENV=production`, any migration or database startup failure triggers immediate fail-closed termination (`process.exit(1)`).

### Manual Migration Verification
To verify database migration status directly:
```sql
SELECT version, applied_at FROM schema_migrations ORDER BY applied_at ASC;
```

---

## 5. Redis Setup & Configuration

### Critical Server Policy
In `/etc/redis/redis.conf` or cloud provider settings, configure:
```text
maxmemory 512mb
maxmemory-policy noeviction
```
> **CRITICAL**: The eviction policy must be `noeviction` (or fail on out-of-memory). Never use `allkeys-lru` or `volatile-lru` as it would prematurely evict distributed concurrency locks or user rate-limit buckets.

### Distributed State Responsibilities
- **Distributed Locks**: 15s TTL for claims, strikes, and premium syncs; 60s TTL for proposal executions; 10s TTL for introduction claims.
- **Rate Limit Buckets**: Atomic Lua increment with TTL expiry.
- **Pending Plans**: Ephemeral state with 15m (900s) human confirmation window.

---

## 6. Startup Verification

1. Install dependencies:
   ```bash
   npm ci --omit=dev
   ```
2. Build the TypeScript production bundle:
   ```bash
   npm run build
   ```
3. Start the bot process:
   ```bash
   NODE_ENV=production node dist/index.js
   ```
4. Verify startup log sequence:
   ```text
   Connecting to PostgreSQL and verifying health...
   ✅ Database initialized and migrations verified.
   Logged in as KosmoBot#0001
   Command registration succeeded
   ```

---

## 7. Graceful Shutdown & Process Lifecycle

KOSMO-BOT traps `SIGINT` and `SIGTERM` signals for controlled zero-downtime restarts:

```text
Received SIGTERM. Starting graceful shutdown...
Discord client destroyed.
Database connections closed.
Redis cache connections closed.
Process exited with code 0.
```

- In-flight database transactions complete before the pool terminates (`db.disconnect()`).
- Redis connection closes cleanly (`cache.disconnect()`), preventing hanging socket descriptors.
- Discord Gateway WebSocket disconnects gracefully (`client.destroy()`).

---

## 8. Health Verification & Observability

### Health Check Utility
The database layer exposes `checkDatabaseHealth()` executing a lightweight `SELECT 1`:
```typescript
import { db } from './services/database';
const health = await db.health();
// { healthy: true, latencyMs: 3 }
```

### Logging Rules
- **Metadata Only**: Audit logs capture timestamps, user IDs, action types, and status.
- **Strict Privacy**: Raw conversational chat, private ticket transcripts, user passwords, and provider API keys are **never** logged to stdout or the database.
- **Provider Errors**: Upstream OpenRouter or Discord API failures are sanitized to avoid leaking authentication headers.

---

## 9. Common Failure Scenarios & Recovery

### Scenario A: PostgreSQL Database Unavailable
- **Startup**: In `NODE_ENV=production`, process halts immediately (`exit 1`) to prevent running in an un-audited state.
- **Runtime**: High-risk actions (role mutations, moderation strikes, daily claims) fail closed. Newcomer introduction welcome claims fail closed (no duplicate spam).
- **Recovery**: Restore PostgreSQL service. Restart KOSMO-BOT.

### Scenario B: Redis Unavailable
- **Startup**: In `NODE_ENV=production`, throws a critical initialization error and halts.
- **Runtime**: Distributed locks cannot be acquired; state mutations fail closed to prevent race conditions. Conversational chat fails open to allow casual reading.
- **Recovery**: Restart Redis. In-flight confirmation buttons that expired during downtime will gracefully show "Plan expired".

### Scenario C: OpenRouter AI Provider Unavailable / 5xx Outage
- **Conversational Chat**: Returns a safe, friendly Discord fallback:
  *"My cognitive uplink hit a transient hiccup. Try asking again in a moment."*
- **Action Planner (`/kosmo manage`)**: Retries once on 5xx errors; if persistent, returns an explicit rejection embed explaining the AI service was unreachable. Zero Discord state is mutated.

---

## 10. Backup, Rollback & Disaster Recovery

### PostgreSQL Daily Backup
Schedule automated daily logical backups using `pg_dump`:
```bash
pg_dump -Fc "$DATABASE_URL" -f "kosmobot_backup_$(date +%Y%m%d_%H%M%S).dump"
```

### PostgreSQL Restoration
```bash
pg_restore --clean --no-acl --no-owner -d "$DATABASE_URL" "kosmobot_backup_YYYYMMDD_HHMMSS.dump"
```

### Emergency Shutdown
If anomalous activity is detected, terminate the process immediately:
```bash
# PM2
pm2 stop kosmo-bot

# Docker
docker stop -t 10 kosmo-bot-container

# systemd
systemctl stop kosmo-bot
```
Killing the process immediately severs the Discord Gateway connection, preventing further event ingestion or command execution.
