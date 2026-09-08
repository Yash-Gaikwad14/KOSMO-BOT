// src/tests/cache/redisDistributedState.test.ts

import { InMemoryCache, LockResult } from '../../services/cache';
import { RedisProposalStorage } from '../../services/ai/proposalService';

describe('DB-2: Redis Distributed State, Locks, and Concurrency Protections', () => {
  let cache: InMemoryCache;

  beforeEach(() => {
    cache = new InMemoryCache();
  });

  describe('1. Distributed Locks & Ownership-Safe Release', () => {
    test('acquires lock and returns unique ownership token', async () => {
      const lock = await cache.acquireLock('lock:test:1', 10);
      expect(lock.acquired).toBe(true);
      expect(lock.token).toBeDefined();
      expect(typeof lock.token).toBe('string');
      expect(lock.token!.length).toBeGreaterThan(10);
    });

    test('rejects concurrent lock acquisition for the same key', async () => {
      const lock1 = await cache.acquireLock('lock:test:concurrent', 10);
      expect(lock1.acquired).toBe(true);

      const lock2 = await cache.acquireLock('lock:test:concurrent', 10);
      expect(lock2.acquired).toBe(false);
      expect(lock2.token).toBeUndefined();
    });

    test('ownership-safe release allows lock holder to release, but rejects foreign token', async () => {
      const lock1 = await cache.acquireLock('lock:test:ownership', 10);
      expect(lock1.acquired).toBe(true);

      // Attempt to release with wrong/foreign token
      const wrongRelease = await cache.releaseLock('lock:test:ownership', 'foreign-token-12345');
      expect(wrongRelease).toBe(false);

      // Lock should still be held
      const lock2 = await cache.acquireLock('lock:test:ownership', 10);
      expect(lock2.acquired).toBe(false);

      // Release with authentic token
      const authenticRelease = await cache.releaseLock('lock:test:ownership', lock1.token!);
      expect(authenticRelease).toBe(true);

      // Now another process can acquire
      const lock3 = await cache.acquireLock('lock:test:ownership', 10);
      expect(lock3.acquired).toBe(true);
    });

    test('lock expires after TTL passes', async () => {
      // Acquire 1-second lock
      const lock1 = await cache.acquireLock('lock:test:ttl', 1);
      expect(lock1.acquired).toBe(true);

      // Immediately blocked
      const immediate = await cache.acquireLock('lock:test:ttl', 1);
      expect(immediate.acquired).toBe(false);

      // Wait 1.1s for TTL expiry
      await new Promise((res) => setTimeout(res, 1100));

      // Key should now be acquirable
      const lock2 = await cache.acquireLock('lock:test:ttl', 1);
      expect(lock2.acquired).toBe(true);
    });
  });

  describe('2. Atomic Rate Limiting', () => {
    test('enforces atomic limit within window and tracks remaining calls', async () => {
      const key = 'ratelimit:test:user1';
      const limit = 3;
      const windowSec = 5;

      const call1 = await cache.checkAndIncrementRateLimit(key, limit, windowSec);
      expect(call1.allowed).toBe(true);
      expect(call1.remaining).toBe(2);

      const call2 = await cache.checkAndIncrementRateLimit(key, limit, windowSec);
      expect(call2.allowed).toBe(true);
      expect(call2.remaining).toBe(1);

      const call3 = await cache.checkAndIncrementRateLimit(key, limit, windowSec);
      expect(call3.allowed).toBe(true);
      expect(call3.remaining).toBe(0);

      const call4 = await cache.checkAndIncrementRateLimit(key, limit, windowSec);
      expect(call4.allowed).toBe(false);
      expect(call4.remaining).toBe(0);
    });
  });

  describe('3. Production Fail-Closed Behavior', () => {
    const originalEnv = process.env;

    afterEach(() => {
      process.env = originalEnv;
    });

    test('production mode strictly requires REDIS_URL for cache initialization', () => {
      process.env = { ...originalEnv, NODE_ENV: 'production', REDIS_URL: '' };
      // In production with missing REDIS_URL, RedisProposalStorage fails closed or throws
      const redisStorage = new RedisProposalStorage();
      expect(redisStorage.isAvailable()).resolves.toBe(false);
    });
  });
});
