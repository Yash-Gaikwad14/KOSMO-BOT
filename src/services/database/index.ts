import { Pool, QueryResult } from 'pg';

/** Types used by the DB service */
export type UserRecord = {
  discordId: string;
  username: string;
  createdAt: Date;
  [key: string]: unknown;
};

export type WalletRecord = {
  guildId: string;
  userId: string;
  karmaBalance: number;
  sparksBalance: number;
  compilesBalance: number;
  version: number;
};

export type LedgerEntry = {
  id: number;
  guildId: string;
  userId: string;
  currency: string; // e.g. 'karma', 'sparks', 'compiles'
  amount: number;
  reason: string;
  idempotencyKey: string;
  actorType: string;
  createdAt: Date;
};

export interface Database {
  /** Connect and verify the pool (SELECT 1) */
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // User helpers (keep the original stub signatures)
  getUser(discordId: string): Promise<UserRecord | null>;
  upsertUser(user: UserRecord): Promise<void>;

  // Economy helpers
  getWallet(guildId: string, userId: string): Promise<WalletRecord | null>;
  /**
   * Insert a ledger entry and update the wallet in a single transaction.
   * Throws if the idempotencyKey already exists.
   */
  recordLedgerEntry(entry: Omit<LedgerEntry, 'id' | 'createdAt'>): Promise<void>;
}

/** PostgreSQL implementation */
class PostgresDatabase implements Database {
  private pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not defined in .env');
    }
    this.pool = new Pool({ connectionString });
  }

  async connect(): Promise<void> {
    // Simple health‑check query
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
      console.log('✅ PostgreSQL connection established');
    } finally {
      client.release();
    }
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
    console.log('🛑 PostgreSQL pool closed');
  }

  // -----------------------------------------------------------------
  // User helpers – thin wrappers around the table "users"
  // -----------------------------------------------------------------
  async getUser(discordId: string): Promise<UserRecord | null> {
    const res: QueryResult<UserRecord> = await this.pool.query(
      'SELECT discord_id AS "discordId", username, created_at AS "createdAt" FROM users WHERE discord_id = $1',
      [discordId]
    );
    return res.rows[0] ?? null;
  }

  async upsertUser(user: UserRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO users (discord_id, username, created_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (discord_id) DO UPDATE SET username = EXCLUDED.username`,
      [user.discordId, user.username, user.createdAt]
    );
  }

  // -----------------------------------------------------------------
  // Wallet helpers – based on the "wallets" table
  // -----------------------------------------------------------------
  async getWallet(guildId: string, userId: string): Promise<WalletRecord | null> {
    const res: QueryResult<WalletRecord> = await this.pool.query(
      `SELECT guild_id AS "guildId", user_id AS "userId", karma_balance AS "karmaBalance",
              sparks_balance AS "sparksBalance", compiles_balance AS "compilesBalance", version
       FROM wallets WHERE guild_id = $1 AND user_id = $2`,
      [guildId, userId]
    );
    return res.rows[0] ?? null;
  }

  // -----------------------------------------------------------------
  // Ledger entry – single transaction that guarantees idempotency
  // -----------------------------------------------------------------
  async recordLedgerEntry(entry: Omit<LedgerEntry, 'id' | 'createdAt'>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Insert ledger entry – idempotency key is UNIQUE in the schema
      await client.query(
        `INSERT INTO economy_ledger (guild_id, user_id, currency, amount, reason, idempotency_key, actor_type, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          entry.guildId,
          entry.userId,
          entry.currency,
          entry.amount,
          entry.reason,
          entry.idempotencyKey,
          entry.actorType,
        ]
      );

      // Update (or insert) wallet row – upsert based on composite PK (guild_id, user_id)
      const balanceColumn = `${entry.currency}_balance`; // expects column name matches currency
      await client.query(
        `INSERT INTO wallets (guild_id, user_id, ${balanceColumn}, version)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET ${balanceColumn} = wallets.${balanceColumn} + EXCLUDED.${balanceColumn}, version = wallets.version + 1`,
        [entry.guildId, entry.userId, entry.amount]
      );

      await client.query('COMMIT');
    } catch (err: any) {
      await client.query('ROLLBACK');
      // Re‑throw the error for the caller to handle – duplicate key gives a clear message
      throw err;
    } finally {
      client.release();
    }
  }
}

/** Export a singleton – the application will call db.connect() on startup */
export const db: Database = new PostgresDatabase();
