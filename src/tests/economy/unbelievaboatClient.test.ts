import { UnbelievaBoatClient } from '../../services/economy/unbelievaboatClient';

describe('UnbelievaBoatClient', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('fails if API key is not configured', async () => {
    delete process.env.UNBELIEVABOAT_API_KEY;
    const client = new UnbelievaBoatClient({ apiKey: '' });

    const result = await client.grantSparks('guild-1', 'user-1', 500, 'Test reason');
    expect(result.success).toBe(false);
    expect(result.error).toContain('API key is not configured');
  });

  test('fails if guildId or userId is missing', async () => {
    const client = new UnbelievaBoatClient({ apiKey: 'secret-key-xyz' });

    const res1 = await client.grantSparks('', 'user-1', 500, 'Test reason');
    expect(res1.success).toBe(false);
    expect(res1.error).toContain('Guild ID and User ID are required');

    const res2 = await client.grantSparks('guild-1', '', 500, 'Test reason');
    expect(res2.success).toBe(false);
    expect(res2.error).toContain('Guild ID and User ID are required');
  });

  test('fails if amount is zero, negative, or non-integer', async () => {
    const client = new UnbelievaBoatClient({ apiKey: 'secret-key-xyz' });

    const res1 = await client.grantSparks('guild-1', 'user-1', 0, 'Zero amount');
    expect(res1.success).toBe(false);
    expect(res1.error).toContain('Amount must be a positive integer');

    const res2 = await client.grantSparks('guild-1', 'user-1', -100, 'Negative amount');
    expect(res2.success).toBe(false);

    const res3 = await client.grantSparks('guild-1', 'user-1', 50.5, 'Decimal amount');
    expect(res3.success).toBe(false);
  });

  test('successfully executes PATCH request with correct headers, URL, and body', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        total: 1500,
        cash: 500,
        bank: 1000,
      }),
    });

    const client = new UnbelievaBoatClient({
      apiKey: 'secret-test-key-12345',
      fetchFn: mockFetch as any,
    });

    const result = await client.grantSparks('guild-123', 'user-456', 500, 'Daily Sparks Allowance');

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ total: 1500, cash: 500, bank: 1000 });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://unbelievaboat.com/api/v1/guilds/guild-123/users/user-456',
      {
        method: 'PATCH',
        headers: {
          Authorization: 'secret-test-key-12345',
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          cash: 500,
          reason: 'Daily Sparks Allowance',
        }),
      }
    );
  });

  test('handles HTTP 429 Rate Limiting safely', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: jest.fn().mockResolvedValue({ message: 'Too Many Requests', retry_after: 5000 }),
    });

    const client = new UnbelievaBoatClient({
      apiKey: 'key',
      fetchFn: mockFetch as any,
    });

    const result = await client.grantSparks('g1', 'u1', 500, 'Rate limit test');
    expect(result.success).toBe(false);
    expect(result.status).toBe(429);
    expect(result.error).toMatch(/rate limit/i);
  });

  test('handles HTTP 401/403 Authentication/Authorization failure without leaking key', async () => {
    const secretKey = 'super-secret-key-that-must-never-leak';
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: jest.fn().mockResolvedValue({ message: 'Unauthorized' }),
    });

    const client = new UnbelievaBoatClient({
      apiKey: secretKey,
      fetchFn: mockFetch as any,
    });

    const result = await client.grantSparks('g1', 'u1', 500, 'Auth fail test');
    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).not.toContain(secretKey);
    expect(result.error).toMatch(/authorization failed/i);
  });

  test('handles HTTP 404 User or Guild not found', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: jest.fn().mockResolvedValue({ message: 'User not found' }),
    });

    const client = new UnbelievaBoatClient({
      apiKey: 'key',
      fetchFn: mockFetch as any,
    });

    const result = await client.grantSparks('g1', 'u1', 500, 'Not found test');
    expect(result.success).toBe(false);
    expect(result.status).toBe(404);
    expect(result.error).toMatch(/not found/i);
  });

  test('handles HTTP 500 Upstream Server Error', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: jest.fn().mockResolvedValue({ message: 'Internal Server Error' }),
    });

    const client = new UnbelievaBoatClient({
      apiKey: 'key',
      fetchFn: mockFetch as any,
    });

    const result = await client.grantSparks('g1', 'u1', 500, 'Server error test');
    expect(result.success).toBe(false);
    expect(result.status).toBe(500);
    expect(result.error).toMatch(/server error/i);
  });

  test('handles network fetch rejection / timeout gracefully', async () => {
    const mockFetch = jest.fn().mockRejectedValue(new Error('ETIMEDOUT: Connection timed out'));

    const client = new UnbelievaBoatClient({
      apiKey: 'key',
      fetchFn: mockFetch as any,
    });

    const result = await client.grantSparks('g1', 'u1', 500, 'Timeout test');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to connect to economy service');
    expect(result.error).toContain('ETIMEDOUT');
  });
});
