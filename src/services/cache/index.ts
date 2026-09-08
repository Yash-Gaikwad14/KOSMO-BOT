// src/services/cache/index.ts
/**
 * Redis‑backed cache implementation adhering to the existing Cache interface.
 * Uses ioredis. Connection string is taken from the REDIS_URL environment variable.
 */
import Redis from 'ioredis';

export interface Cache {
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  get<T>(key: string): Promise<T | null>;
  del(key: string): Promise<void>;
  flush(): Promise<void>;
  /**
   * Rate‑limit helper.
   * Increments the counter for `key` and returns whether the caller is still under the limit.
   * Implements an atomic operation using a Lua script to avoid race conditions.
   */
  checkAndIncrementRateLimit(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number }>;
}

class RedisCache implements Cache {
  private client: Redis;

  constructor() {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error('REDIS_URL is not defined in .env');
    }
    this.client = new Redis(url);
    this.client.on('error', (err: any) => console.error('Redis error:', err));
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await this.client.set(key, serialized, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, serialized);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async flush(): Promise<void> {
    await this.client.flushdb();
  }

  // Lua script for atomic increment+expire+check
  private static readonly rateLimitScript = `
    local current = redis.call('INCR', KEYS[1])
    if tonumber(current) == 1 then
      redis.call('EXPIRE', KEYS[1], ARGV[2])
    end
    local allowed = current <= tonumber(ARGV[1])
    return { allowed and 1 or 0, current }
  `;

  async checkAndIncrementRateLimit(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number }> {
    const result = (await this.client.eval(
      RedisCache.rateLimitScript,
      1,
      key,
      limit.toString(),
      windowSeconds.toString()
    )) as [number, number];
    const [allowedNum, current] = result;
    return { allowed: allowedNum === 1, remaining: limit - current };
  }
}

/** Export a singleton for the whole application */
export const cache: Cache = new RedisCache();
