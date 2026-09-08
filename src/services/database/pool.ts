// src/services/database/pool.ts

import { Pool, PoolConfig } from 'pg';

let activePool: Pool | null = null;

/**
 * Parses connection configuration from environment variables.
 * Enforces production-ready connection limits, timeouts, and SSL support.
 */
export function getPoolConfig(): PoolConfig {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not defined in environment variables.');
  }

  const config: PoolConfig = {
    connectionString,
    max: parseInt(process.env.DATABASE_POOL_MAX || '20', 10),
    idleTimeoutMillis: parseInt(process.env.DATABASE_IDLE_TIMEOUT_MS || '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.DATABASE_CONN_TIMEOUT_MS || '5000', 10),
  };

  // Secure SSL configuration
  const sslMode = process.env.DATABASE_SSL?.toLowerCase();
  if (sslMode === 'true' || sslMode === 'require') {
    config.ssl = {
      rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
    };
  }

  return config;
}

/**
 * Returns the centralized singleton PostgreSQL pool.
 * Initializes the pool lazily on first access if not explicitly provided.
 */
export function getPool(): Pool {
  if (activePool) {
    return activePool;
  }

  const config = getPoolConfig();
  activePool = new Pool(config);

  activePool.on('error', (err) => {
    console.error('Unexpected idle client error on centralized PostgreSQL pool:', err);
  });

  return activePool;
}

/**
 * Overrides or injects a custom pool instance (crucial for unit testing and mocks).
 */
export function setPool(pool: Pool | null): void {
  activePool = pool;
}

/**
 * Checks the connectivity and responsiveness of the PostgreSQL database.
 * Executes a lightweight `SELECT 1` query.
 */
export async function checkDatabaseHealth(): Promise<{
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}> {
  const start = Date.now();
  let client;
  try {
    const pool = getPool();
    client = await pool.connect();
    await client.query('SELECT 1');
    const latencyMs = Date.now() - start;
    return { healthy: true, latencyMs };
  } catch (err: any) {
    return {
      healthy: false,
      error: err?.message || 'Database health check failed.',
    };
  } finally {
    if (client) {
      client.release();
    }
  }
}

/**
 * Gracefully shuts down the centralized database pool.
 */
export async function closeDatabasePool(): Promise<void> {
  if (activePool) {
    const poolToClose = activePool;
    activePool = null;
    await poolToClose.end();
    console.log('🛑 Centralized PostgreSQL pool closed.');
  }
}
