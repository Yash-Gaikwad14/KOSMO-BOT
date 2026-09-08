// src/tests/discord/introduction/introductionRepository.test.ts

import {
  InMemoryIntroductionRepository,
  PostgresIntroductionRepository,
  getIntroductionWelcomeMessage,
} from '../../../services/engagement/introductionRepository';
import { cache } from '../../../services/cache';

describe('Introduction Repository & State (introductionRepository.ts)', () => {
  describe('Welcome Message Template', () => {
    test('formats the approved icebreaker message with user mention', () => {
      const msg = getIntroductionWelcomeMessage('user-12345');
      expect(msg).toBe(
        'Welcome to the Kosmoverse, <@user-12345>. Enough with the formalities. What are you building, learning, or currently trying to compile?'
      );
    });
  });

  describe('InMemoryIntroductionRepository', () => {
    let repo: InMemoryIntroductionRepository;

    beforeEach(() => {
      repo = new InMemoryIntroductionRepository();
    });

    test('claims first welcome successfully and rejects duplicate claims', async () => {
      const firstClaim = await repo.claimWelcome('guild-1', 'user-1');
      expect(firstClaim).toBe(true);

      const secondClaim = await repo.claimWelcome('guild-1', 'user-1');
      expect(secondClaim).toBe(false);

      expect(await repo.hasBeenWelcomed('guild-1', 'user-1')).toBe(true);
    });

    test('allows welcome claim for different users in same guild or same user in different guilds', async () => {
      expect(await repo.claimWelcome('guild-1', 'user-1')).toBe(true);
      expect(await repo.claimWelcome('guild-1', 'user-2')).toBe(true);
      expect(await repo.claimWelcome('guild-2', 'user-1')).toBe(true);
    });

    test('clears state on reset', async () => {
      await repo.claimWelcome('guild-1', 'user-1');
      await repo.clear();
      expect(await repo.hasBeenWelcomed('guild-1', 'user-1')).toBe(false);
      expect(await repo.claimWelcome('guild-1', 'user-1')).toBe(true);
    });
  });

  describe('PostgresIntroductionRepository', () => {
    let mockPool: any;
    let repo: PostgresIntroductionRepository;

    beforeEach(() => {
      mockPool = {
        query: jest.fn(),
      };
      repo = new PostgresIntroductionRepository(mockPool);
    });

    test('ensureTable creates introduction_welcomes table and index', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await repo.ensureTable();

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS introduction_welcomes')
      );
    });

    test('claimWelcome returns true on successful unique insertion (rowCount = 1)', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // ensureTable
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 }); // insert ON CONFLICT DO NOTHING

      const claimed = await repo.claimWelcome('guild-100', 'user-200');

      expect(claimed).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (guild_id, user_id) DO NOTHING'),
        ['guild-100', 'user-200']
      );
    });

    test('claimWelcome returns false if conflict occurred (rowCount = 0)', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // ensureTable
      mockPool.query.mockResolvedValueOnce({ rowCount: 0 }); // duplicate

      const claimed = await repo.claimWelcome('guild-100', 'user-200');

      expect(claimed).toBe(false);
    });

    test('hasBeenWelcomed correctly queries the table', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // ensureTable
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

      const welcomed = await repo.hasBeenWelcomed('guild-100', 'user-200');
      expect(welcomed).toBe(true);
    });

    test('falls through to PostgreSQL authority when Redis lock errors', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // ensureTable
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 }); // insert succeeds

      jest.spyOn(cache, 'acquireLock').mockResolvedValueOnce({
        acquired: false,
        error: 'Redis service is unavailable.',
      });

      const claimed = await repo.claimWelcome('guild-100', 'user-200');
      expect(claimed).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO introduction_welcomes'),
        ['guild-100', 'user-200']
      );
    });
  });
});
