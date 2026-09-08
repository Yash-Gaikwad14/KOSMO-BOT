// src/tests/database/pool.test.ts

import {
  getPool,
  setPool,
  getPoolConfig,
  checkDatabaseHealth,
  closeDatabasePool,
} from '../../services/database/pool';

describe('Centralized Database Pool & Lifecycle (pool.ts)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    setPool(null);
  });

  afterAll(async () => {
    process.env = originalEnv;
    await closeDatabasePool();
  });

  test('getPoolConfig throws error when DATABASE_URL is missing', () => {
    delete process.env.DATABASE_URL;
    expect(() => getPoolConfig()).toThrow('DATABASE_URL is not defined');
  });

  test('getPoolConfig correctly parses standard connection options', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/kosmodb';
    process.env.DATABASE_POOL_MAX = '15';
    process.env.DATABASE_IDLE_TIMEOUT_MS = '20000';
    process.env.DATABASE_CONN_TIMEOUT_MS = '3000';

    const config = getPoolConfig();
    expect(config.connectionString).toBe('postgres://user:pass@localhost:5432/kosmodb');
    expect(config.max).toBe(15);
    expect(config.idleTimeoutMillis).toBe(20000);
    expect(config.connectionTimeoutMillis).toBe(3000);
    expect(config.ssl).toBeUndefined();
  });

  test('getPoolConfig enables secure SSL when DATABASE_SSL is true', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/kosmodb';
    process.env.DATABASE_SSL = 'true';
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = 'true';

    const config = getPoolConfig();
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
  });

  test('checkDatabaseHealth returns healthy: true when SELECT 1 succeeds', async () => {
    const mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      release: jest.fn(),
    };
    const mockPool: any = {
      connect: jest.fn().mockResolvedValue(mockClient),
    };

    setPool(mockPool);
    const result = await checkDatabaseHealth();

    expect(result.healthy).toBe(true);
    expect(typeof result.latencyMs).toBe('number');
    expect(mockClient.query).toHaveBeenCalledWith('SELECT 1');
    expect(mockClient.release).toHaveBeenCalled();
  });

  test('checkDatabaseHealth returns healthy: false when connection fails', async () => {
    const mockPool: any = {
      connect: jest.fn().mockRejectedValue(new Error('Connection refused')),
    };

    setPool(mockPool);
    const result = await checkDatabaseHealth();

    expect(result.healthy).toBe(false);
    expect(result.error).toContain('Connection refused');
  });

  test('closeDatabasePool drains pool and resets active instance', async () => {
    const mockEnd = jest.fn().mockResolvedValue(undefined);
    const mockPool: any = { end: mockEnd };

    setPool(mockPool);
    await closeDatabasePool();

    expect(mockEnd).toHaveBeenCalled();
  });
});
