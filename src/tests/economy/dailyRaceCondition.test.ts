// src/tests/economy/dailyRaceCondition.test.ts

import { claimDaily, _resetDailyCooldowns } from '../../services/economy/dailyService';
import { IUnbelievaBoatClient } from '../../services/economy/unbelievaboatClient';
import { getDailyClaimRepository, InMemoryDailyClaimRepository, setDailyClaimRepository } from '../../services/database/dailyClaimRepository';
import { cache } from '../../services/cache';

describe('DB-2: Daily Claim Race Condition & Multi-Process Double-Claim Safeguards', () => {
  let mockClient: IUnbelievaBoatClient;
  let inMemoryRepo: InMemoryDailyClaimRepository;

  beforeEach(() => {
    inMemoryRepo = new InMemoryDailyClaimRepository();
    setDailyClaimRepository(inMemoryRepo);
    _resetDailyCooldowns();

    mockClient = {
      grantSparks: jest.fn().mockResolvedValue({
        success: true,
        status: 200,
        data: { cash: 500 },
      }),
      getUserBalance: jest.fn(),
      getGuildLeaderboard: jest.fn(),
    };
  });

  afterEach(() => {
    setDailyClaimRepository(null);
  });

  test('concurrent claims for the exact same user execute atomically and only award Sparks once', async () => {
    // Delay the UBB call slightly to allow concurrent request to arrive while first is in-flight
    (mockClient.grantSparks as jest.Mock).mockImplementation(async () => {
      await new Promise((res) => setTimeout(res, 50));
      return { success: true, status: 200, data: { cash: 500 } };
    });

    // Fire 5 concurrent requests from the exact same user
    const promises = [
      claimDaily('user-race-1', 'guild-1', [], mockClient),
      claimDaily('user-race-1', 'guild-1', [], mockClient),
      claimDaily('user-race-1', 'guild-1', [], mockClient),
      claimDaily('user-race-1', 'guild-1', [], mockClient),
      claimDaily('user-race-1', 'guild-1', [], mockClient),
    ];

    const results = await Promise.all(promises);

    const successfulClaims = results.filter((r) => r.success);
    const rejectedClaims = results.filter((r) => !r.success);

    // Exactly 1 claim must succeed
    expect(successfulClaims).toHaveLength(1);
    expect(rejectedClaims).toHaveLength(4);

    // UBB grantSparks must be called exactly once
    expect(mockClient.grantSparks).toHaveBeenCalledTimes(1);

    // Repositories must record exactly 1 claim
    expect(await inMemoryRepo.getClaimCount('user-race-1')).toBe(1);
  });

  test('double-claim is prevented across bot restart / Redis cache flush via PostgreSQL recovery fallback', async () => {
    // 1. Initial claim succeeds
    const firstClaim = await claimDaily('user-restart-test', 'guild-1', [], mockClient);
    expect(firstClaim.success).toBe(true);
    expect(mockClient.grantSparks).toHaveBeenCalledTimes(1);

    // 2. Simulate bot restart / Redis wipe: flush Redis keys completely
    await cache.del('cooldown:daily:user-restart-test');
    await cache.del('lock:user:user-restart-test:daily_claim');

    // 3. User immediately attempts a second claim after "restart"
    const secondClaim = await claimDaily('user-restart-test', 'guild-1', [], mockClient);

    // Durable PostgreSQL ledger caught the prior claim within 24h!
    expect(secondClaim.success).toBe(false);
    expect(secondClaim.onCooldown).toBe(true);
    expect(secondClaim.sparksAwarded).toBe(0);
    expect(secondClaim.message).toContain('already claimed');

    // UBB grantSparks was NOT called a second time
    expect(mockClient.grantSparks).toHaveBeenCalledTimes(1);
  });
});
