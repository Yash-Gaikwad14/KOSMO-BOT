// src/services/cache/index.ts
/**
 * Redis-backed cache and distributed state management service.
 * Supports:
 * - Distributed locking with unique ownership tokens and atomic Lua release
 * - Atomic rate-limiting via Lua script
 * - Ephemeral key caching with explicit TTL
 * - Hermetic in-memory fallback strictly for offline/test environments
 */

import Redis from 'ioredis';
import crypto from 'crypto';

export interface LockResult {
  acquired: boolean;
  token?: string;
  error?: string;
}

export interface Cache {
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  get<T>(key: string): Promise<T | null>;
  del(key: string): Promise<void>;
  flush(): Promise<void>;
  ttl(key: string): Promise<number>; // returns remaining TTL in seconds (-2 if not found, -1 if no TTL)
  checkAndIncrementRateLimit(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number }>;
  acquireLock(key: string, ttlSeconds: number): Promise<LockResult>;
  releaseLock(key: string, token: string): Promise<boolean>;
  isAvailable(): Promise<boolean>;
  disconnect(): Promise<void>;
}

/**
 * Production Redis-backed Cache & Lock Implementation.
 */
export class RedisCache implements Cache {
  private client: Redis | null = null;
  private isConnected = false;

  // Lua script for atomic increment + expire + check
  private static readonly rateLimitScript = `
    local current = redis.call('INCR', KEYS[1])
    if tonumber(current) == 1 then
      redis.call('EXPIRE', KEYS[1], ARGV[2])
    end
    local allowed = current <= tonumber(ARGV[1])
    return { allowed and 1 or 0, current }
  `;

  // Lua script for safe ownership-aware lock release
  private static readonly releaseLockScript = `
    if redis.call('get', KEYS[1]) == ARGV[1] then
      return redis.call('del', KEYS[1])
    else
      return 0
    end
  `;

  constructor(clientOrUrl?: Redis | string) {
    if (clientOrUrl && typeof clientOrUrl === 'object') {
      this.client = clientOrUrl;
      this.isConnected = true;
    } else {
      const url = (typeof clientOrUrl === 'string' ? clientOrUrl : null) || process.env.REDIS_URL;
      if (!url) {
        throw new Error('REDIS_URL is not defined in environment variables.');
      }
      this.client = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 5000,
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        console.error('Redis connection error:', err);
      });

      this.client.on('connect', () => {
        this.isConnected = true;
      });
    }
  }

  public getRawClient(): Redis | null {
    return this.client;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const ping = await this.client.ping();
      return ping === 'PONG';
    } catch {
      return false;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    if (!this.client) throw new Error('Redis client unavailable.');
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await this.client.set(key, serialized, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, serialized);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.client) throw new Error('Redis client unavailable.');
    const raw = await this.client.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async del(key: string): Promise<void> {
    if (!this.client) throw new Error('Redis client unavailable.');
    await this.client.del(key);
  }

  async flush(): Promise<void> {
    if (!this.client) throw new Error('Redis client unavailable.');
    await this.client.flushdb();
  }

  async ttl(key: string): Promise<number> {
    if (!this.client) throw new Error('Redis client unavailable.');
    return this.client.ttl(key);
  }

  async checkAndIncrementRateLimit(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number }> {
    if (!this.client) throw new Error('Redis client unavailable.');
    const result = (await this.client.eval(
      RedisCache.rateLimitScript,
      1,
      key,
      limit.toString(),
      windowSeconds.toString()
    )) as [number, number];
    const [allowedNum, current] = result;
    return { allowed: allowedNum === 1, remaining: Math.max(0, limit - current) };
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<LockResult> {
    if (!this.client) return { acquired: false, error: 'Redis client unavailable.' };
    const available = await this.isAvailable();
    if (!available) {
      return { acquired: false, error: 'Redis service is unavailable.' };
    }

    const token = crypto.randomUUID();
    const res = await this.client.set(key, token, 'EX', ttlSeconds, 'NX');
    if (res === 'OK') {
      return { acquired: true, token };
    }
    return { acquired: false };
  }

  async releaseLock(key: string, token: string): Promise<boolean> {
    if (!this.client) return false;
    try {
      const res = await this.client.eval(
        RedisCache.releaseLockScript,
        1,
        key,
        token
      );
      return res === 1;
    } catch (err) {
      console.warn(`Failed to release lock on ${key}:`, err);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit().catch(() => {});
      this.client = null;
      this.isConnected = false;
    }
  }
}

/**
 * In-memory Cache & Lock Implementation.
 * Strictly used in hermetic test suites or local development without Redis.
 * PROHIBITED in production for distributed coordination.
 */
export class InMemoryCache implements Cache {
  private store = new Map<string, { value: string; expiresAt?: number }>();
  private rateLimits = new Map<string, { count: number; expiresAt: number }>();

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
    this.store.set(key, { value: JSON.stringify(value), expiresAt });
  }

  async get<T>(key: string): Promise<T | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    try {
      return JSON.parse(item.value) as T;
    } catch {
      return null;
    }
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async flush(): Promise<void> {
    this.store.clear();
    this.rateLimits.clear();
  }

  async ttl(key: string): Promise<number> {
    const item = this.store.get(key);
    if (!item) return -2;
    if (!item.expiresAt) return -1;
    const remaining = Math.floor((item.expiresAt - Date.now()) / 1000);
    if (remaining <= 0) {
      this.store.delete(key);
      return -2;
    }
    return remaining;
  }

  async checkAndIncrementRateLimit(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number }> {
    const now = Date.now();
    const entry = this.rateLimits.get(key);

    if (!entry || now > entry.expiresAt) {
      this.rateLimits.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
      return { allowed: true, remaining: limit - 1 };
    }

    entry.count += 1;
    const allowed = entry.count <= limit;
    return { allowed, remaining: Math.max(0, limit - entry.count) };
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<LockResult> {
    const now = Date.now();
    const existing = this.store.get(key);
    if (existing && (!existing.expiresAt || existing.expiresAt > now)) {
      return { acquired: false };
    }

    const token = crypto.randomUUID();
    const expiresAt = now + ttlSeconds * 1000;
    this.store.set(key, { value: JSON.stringify(token), expiresAt });
    return { acquired: true, token };
  }

  async releaseLock(key: string, token: string): Promise<boolean> {
    const existing = this.store.get(key);
    if (!existing) return false;
    try {
      const storedToken = JSON.parse(existing.value);
      if (storedToken === token) {
        this.store.delete(key);
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  async disconnect(): Promise<void> {
    this.store.clear();
    this.rateLimits.clear();
  }
}

let activeCache: Cache | null = null;

/**
 * Returns the active Cache instance.
 * In production: Redis is required and authoritative.
 * In development/test: falls back to InMemoryCache if REDIS_URL is not set.
 */
export function getCache(): Cache {
  if (activeCache) {
    return activeCache;
  }

  if (process.env.REDIS_URL && process.env.REDIS_URL.trim().length > 0) {
    try {
      activeCache = new RedisCache(process.env.REDIS_URL);
      return activeCache;
    } catch (err) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`CRITICAL: Production Redis failed to initialize: ${err}`);
      }
      console.warn('Failed to connect to Redis, using in-memory fallback for non-production:', err);
    }
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error('CRITICAL: REDIS_URL must be defined in production environment.');
  }

  activeCache = new InMemoryCache();
  return activeCache;
}

export function setCache(customCache: Cache | null): void {
  activeCache = customCache;
}

/**
 * Default singleton instance exported for backward compatibility.
 */
export const cache: Cache = {
  set: (k, v, ttl) => getCache().set(k, v, ttl),
  get: (k) => getCache().get(k),
  del: (k) => getCache().del(k),
  flush: () => getCache().flush(),
  ttl: (k) => getCache().ttl(k),
  checkAndIncrementRateLimit: (k, l, w) => getCache().checkAndIncrementRateLimit(k, l, w),
  acquireLock: (k, ttl) => getCache().acquireLock(k, ttl),
  releaseLock: (k, t) => getCache().releaseLock(k, t),
  isAvailable: () => getCache().isAvailable(),
  disconnect: () => getCache().disconnect(),
};

export * from './redisKeys';
