// src/tests/database/repositories.test.ts

import {
  InMemoryAuditRepository,
  PostgresAuditRepository,
  generateEventId,
} from '../../services/database/auditRepository';
import {
  InMemoryGuildConfigRepository,
  PostgresGuildConfigRepository,
} from '../../services/database/guildConfigRepository';
import {
  InMemoryDailyClaimRepository,
  PostgresDailyClaimRepository,
} from '../../services/database/dailyClaimRepository';

describe('Database Repositories (Foundation Layer)', () => {
  describe('AuditRepository', () => {
    test('generateEventId creates standard AUDIT-YYYYMMDD-XXXX identifier', () => {
      const id = generateEventId();
      expect(id).toMatch(/^AUDIT-\d{8}-[A-F0-9]{6}$/);
    });

    test('InMemoryAuditRepository records and filters events by guild and action', async () => {
      const repo = new InMemoryAuditRepository();

      await repo.recordEvent({
        guildId: 'guild-1',
        actionType: 'MOD_TIMEOUT',
        actorId: 'mod-1',
        targetId: 'user-1',
        status: 'SUCCESS',
        metadata: { duration: 10 },
      });

      await repo.recordEvent({
        guildId: 'guild-1',
        actionType: 'COMMUNITY_PROPOSAL_CONFIRMED',
        actorId: 'founder-1',
        status: 'SUCCESS',
        metadata: { planId: 'plan-123' },
      });

      await repo.recordEvent({
        guildId: 'guild-2',
        actionType: 'MOD_TIMEOUT',
        actorId: 'mod-2',
        status: 'SUCCESS',
      });

      const guild1Events = await repo.listRecentEvents('guild-1');
      expect(guild1Events.length).toBe(2);

      const timeoutEvents = await repo.listEventsByAction('guild-1', 'MOD_TIMEOUT');
      expect(timeoutEvents.length).toBe(1);
      expect(timeoutEvents[0].targetId).toBe('user-1');
      expect(timeoutEvents[0].metadata).toEqual({ duration: 10 });
    });

    test('PostgresAuditRepository maps SQL rows and parameters correctly', async () => {
      const mockQuery = jest.fn().mockImplementation((sql: string, params: any[]) => {
        if (sql.includes('INSERT INTO audit_events')) {
          return {
            rows: [
              {
                id: 1,
                event_id: params[0],
                guild_id: params[1],
                action_type: params[2],
                actor_id: params[3],
                target_id: params[4],
                status: params[5],
                metadata: params[6],
                created_at: new Date().toISOString(),
              },
            ],
          };
        }
        return { rows: [] };
      });

      const mockPool: any = { query: mockQuery };
      const repo = new PostgresAuditRepository(mockPool);

      const created = await repo.recordEvent({
        guildId: 'guild-pg',
        actionType: 'REPAIR_STATE',
        actorId: 'owner-pg',
        status: 'SUCCESS',
        metadata: { repairedChannels: 2 },
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_events'),
        expect.arrayContaining(['guild-pg', 'REPAIR_STATE', 'owner-pg', 'SUCCESS'])
      );
      expect(created.actionType).toBe('REPAIR_STATE');
      expect(created.metadata).toEqual({ repairedChannels: 2 });
    });
  });

  describe('GuildConfigRepository', () => {
    test('InMemoryGuildConfigRepository upserts and preserves partial fields', async () => {
      const repo = new InMemoryGuildConfigRepository();

      await repo.upsertConfig({
        guildId: 'guild-100',
        modLogsChannelId: 'chan-mod-logs',
        highKarmaRoleId: 'role-karma',
      });

      let cfg = await repo.getConfig('guild-100');
      expect(cfg).not.toBeNull();
      expect(cfg?.modLogsChannelId).toBe('chan-mod-logs');
      expect(cfg?.highKarmaRoleId).toBe('role-karma');

      // Partial update
      await repo.upsertConfig({
        guildId: 'guild-100',
        supportTicketsCategoryId: 'cat-tickets',
      });

      cfg = await repo.getConfig('guild-100');
      expect(cfg?.supportTicketsCategoryId).toBe('cat-tickets');
      expect(cfg?.modLogsChannelId).toBe('chan-mod-logs'); // Preserved!
      expect(cfg?.highKarmaRoleId).toBe('role-karma'); // Preserved!
    });

    test('PostgresGuildConfigRepository queries and returns mapped configuration', async () => {
      const mockQuery = jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('SELECT * FROM guild_configs WHERE guild_id = $1')) {
          return {
            rows: [
              {
                guild_id: 'guild-200',
                mod_logs_channel_id: 'mod-123',
                support_tickets_category_id: 'cat-123',
                priority_tickets_category_id: null,
                high_karma_role_id: 'karma-123',
                desired_state_json: JSON.stringify({ roles: [] }),
                roles_config_json: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
          };
        }
        return { rows: [] };
      });

      const mockPool: any = { query: mockQuery };
      const repo = new PostgresGuildConfigRepository(mockPool);

      const cfg = await repo.getConfig('guild-200');
      expect(cfg?.guildId).toBe('guild-200');
      expect(cfg?.modLogsChannelId).toBe('mod-123');
      expect(cfg?.desiredStateJson).toEqual({ roles: [] });
    });
  });

  describe('DailyClaimRepository', () => {
    test('InMemoryDailyClaimRepository tracks claims, count, and latest claim', async () => {
      const repo = new InMemoryDailyClaimRepository();

      const earlier = new Date(Date.now() - 48 * 3600 * 1000);
      const recent = new Date(Date.now() - 2 * 3600 * 1000);

      await repo.recordClaim({
        userId: 'user-economy',
        guildId: 'guild-eco',
        sparksAwarded: 500,
        isHighKarma: false,
        claimedAt: earlier,
      });

      await repo.recordClaim({
        userId: 'user-economy',
        guildId: 'guild-eco',
        sparksAwarded: 2000,
        isHighKarma: true,
        claimedAt: recent,
      });

      const count = await repo.getClaimCount('user-economy');
      expect(count).toBe(2);

      const lastClaim = await repo.getLastClaim('user-economy');
      expect(lastClaim).not.toBeNull();
      expect(lastClaim?.sparksAwarded).toBe(2000);
      expect(lastClaim?.isHighKarma).toBe(true);
      expect(lastClaim?.claimedAt).toEqual(recent);
    });

    test('PostgresDailyClaimRepository runs SQL insert and count queries', async () => {
      const mockQuery = jest.fn().mockImplementation((sql: string, params: any[]) => {
        if (sql.includes('INSERT INTO daily_claims')) {
          return {
            rows: [
              {
                id: 1,
                user_id: params[0],
                guild_id: params[1],
                sparks_awarded: params[2],
                is_high_karma: params[3],
                claimed_at: new Date().toISOString(),
              },
            ],
          };
        }
        if (sql.includes('COUNT(*)::int AS count')) {
          return { rows: [{ count: 3 }] };
        }
        return { rows: [] };
      });

      const mockPool: any = { query: mockQuery };
      const repo = new PostgresDailyClaimRepository(mockPool);

      const claim = await repo.recordClaim({
        userId: 'user-pg',
        guildId: 'guild-pg',
        sparksAwarded: 500,
        isHighKarma: false,
      });

      expect(claim.userId).toBe('user-pg');
      expect(claim.sparksAwarded).toBe(500);

      const count = await repo.getClaimCount('user-pg');
      expect(count).toBe(3);
    });
  });
});
