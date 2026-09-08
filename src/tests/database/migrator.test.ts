// src/tests/database/migrator.test.ts

import {
  runMigrations,
  ensureMigrationTable,
  getAppliedMigrations,
  KNOWN_MIGRATIONS,
} from '../../services/database/migrator';

describe('Database Migrator (migrator.ts)', () => {
  test('ensureMigrationTable executes CREATE TABLE IF NOT EXISTS schema_migrations', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
    const mockPool: any = { query: mockQuery };

    await ensureMigrationTable(mockPool);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS schema_migrations')
    );
  });

  test('getAppliedMigrations returns set of applied migration versions', async () => {
    const mockQuery = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('SELECT version FROM schema_migrations')) {
        return { rows: [{ version: '001' }] };
      }
      return { rows: [] };
    });
    const mockPool: any = { query: mockQuery };

    const applied = await getAppliedMigrations(mockPool);
    expect(applied.has('001')).toBe(true);
    expect(applied.size).toBe(1);
  });

  test('runMigrations applies pending migrations within a transaction on fresh database', async () => {
    const executedQueries: string[] = [];
    const mockClient = {
      query: jest.fn().mockImplementation(async (sql: string) => {
        executedQueries.push(sql);
        return { rows: [] };
      }),
      release: jest.fn(),
    };

    const mockPool: any = {
      query: jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT version FROM schema_migrations')) {
          return { rows: [] }; // Fresh database: no migrations applied yet
        }
        return { rows: [] };
      }),
      connect: jest.fn().mockResolvedValue(mockClient),
    };

    const results = await runMigrations(mockPool);

    expect(results.length).toBe(KNOWN_MIGRATIONS.length);
    expect(results[0].applied).toBe(true);
    expect(results[0].version).toBe('001');

    // Verify transaction boundaries
    expect(executedQueries).toContain('BEGIN');
    expect(executedQueries.some((q) => q.includes('CREATE TABLE IF NOT EXISTS guild_configs'))).toBe(true);
    expect(executedQueries.some((q) => q.includes('CREATE TABLE IF NOT EXISTS moderation_cases'))).toBe(true);
    expect(executedQueries.some((q) => q.includes('CREATE TABLE IF NOT EXISTS moderation_strikes'))).toBe(true);
    expect(executedQueries.some((q) => q.includes('CREATE TABLE IF NOT EXISTS audit_events'))).toBe(true);
    expect(executedQueries.some((q) => q.includes('CREATE TABLE IF NOT EXISTS daily_claims'))).toBe(true);
    expect(executedQueries.some((q) => q.includes('CREATE TABLE IF NOT EXISTS premium_entitlements'))).toBe(true);
    expect(executedQueries.some((q) => q.includes('INSERT INTO schema_migrations'))).toBe(true);
    expect(executedQueries).toContain('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });

  test('runMigrations is safely rerunnable and skips already applied migrations', async () => {
    const mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };

    const mockPool: any = {
      query: jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT version FROM schema_migrations')) {
          return { rows: [{ version: '001' }] }; // Already applied
        }
        return { rows: [] };
      }),
      connect: jest.fn().mockResolvedValue(mockClient),
    };

    const results = await runMigrations(mockPool);

    expect(results.length).toBe(1);
    expect(results[0].applied).toBe(false);
    expect(results[0].version).toBe('001');
    // Connect should not even be called if all migrations are already applied
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  test('runMigrations executes ROLLBACK if a migration query fails', async () => {
    const executedQueries: string[] = [];
    const mockClient = {
      query: jest.fn().mockImplementation(async (sql: string) => {
        executedQueries.push(sql);
        if (sql.includes('CREATE TABLE IF NOT EXISTS guild_configs')) {
          throw new Error('Disk full or syntax error');
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };

    const mockPool: any = {
      query: jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT version FROM schema_migrations')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
      connect: jest.fn().mockResolvedValue(mockClient),
    };

    await expect(runMigrations(mockPool)).rejects.toThrow('Database migration failed');

    expect(executedQueries).toContain('BEGIN');
    expect(executedQueries).toContain('ROLLBACK');
    expect(executedQueries).not.toContain('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });
});
