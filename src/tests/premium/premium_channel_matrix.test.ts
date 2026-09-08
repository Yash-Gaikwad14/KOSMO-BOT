// src/tests/premium/premium_channel_matrix.test.ts

import { PermissionFlagsBits } from 'discord.js';

interface Overwrite {
  id: string;
  allow: string[];
  deny: string[];
}

interface ChannelDef {
  name: string;
  overwrites: Overwrite[];
}

/**
 * Standard Discord channel access evaluator following Discord's permission hierarchy:
 * 1. If member has Administrator role -> ALLOW
 * 2. Channel @everyone deny -> defaults to DENY
 * 3. Channel role allows -> overrides @everyone deny
 * 4. Channel role denies -> explicitly denies
 */
function evaluateChannelAccess(
  channel: ChannelDef,
  memberRoleIds: string[],
  everyoneId: string = 'role-everyone'
): boolean {
  // Check if member possesses Administrator
  if (memberRoleIds.includes('role-founder')) {
    return true; // Founder has Administrator
  }

  const everyoneOw = channel.overwrites.find((ow) => ow.id === everyoneId);
  let hasView = everyoneOw ? !everyoneOw.deny.includes('ViewChannel') : true;

  // Apply role overwrites: allows and denies
  let roleAllowsView = false;
  let roleDeniesView = false;

  for (const rId of memberRoleIds) {
    const rOw = channel.overwrites.find((ow) => ow.id === rId);
    if (rOw) {
      if (rOw.allow.includes('ViewChannel')) {
        roleAllowsView = true;
      }
      if (rOw.deny.includes('ViewChannel')) {
        roleDeniesView = true;
      }
    }
  }

  if (roleAllowsView) {
    hasView = true;
  } else if (roleDeniesView) {
    hasView = false;
  }

  return hasView;
}

describe('Phase 8 — Premium Channel Permission Matrix', () => {
  // Configured channel definitions matching live Discord server overwrites
  const proLounge: ChannelDef = {
    name: 'pro-lounge',
    overwrites: [
      { id: 'role-everyone', allow: [], deny: ['ViewChannel'] },
      { id: 'role-pro', allow: ['ViewChannel'], deny: [] },
      { id: 'role-max', allow: ['ViewChannel'], deny: [] },
      { id: 'role-team', allow: ['ViewChannel'], deny: [] },
      { id: 'role-moderator', allow: ['ViewChannel'], deny: [] },
      { id: 'role-bot', allow: ['ViewChannel'], deny: [] },
    ],
  };

  const maxExclusive: ChannelDef = {
    name: 'max-exclusive',
    overwrites: [
      { id: 'role-everyone', allow: [], deny: ['ViewChannel'] },
      { id: 'role-max', allow: ['ViewChannel'], deny: [] },
      { id: 'role-team', allow: ['ViewChannel'], deny: [] },
      { id: 'role-moderator', allow: ['ViewChannel'], deny: [] },
      { id: 'role-bot', allow: ['ViewChannel'], deny: [] },
    ],
  };

  const prioritySupport: ChannelDef = {
    name: 'priority-support',
    overwrites: [
      { id: 'role-everyone', allow: [], deny: ['ViewChannel'] },
      { id: 'role-pro', allow: ['ViewChannel'], deny: [] },
      { id: 'role-max', allow: ['ViewChannel'], deny: [] },
      { id: 'role-team', allow: ['ViewChannel'], deny: [] },
      { id: 'role-moderator', allow: ['ViewChannel'], deny: [] },
      { id: 'role-bot', allow: ['ViewChannel'], deny: [] },
    ],
  };

  describe('#pro-lounge Permission Matrix', () => {
    test('Regular member (Kosmosian) -> DENY', () => {
      expect(evaluateChannelAccess(proLounge, ['role-kosmosian'])).toBe(false);
    });

    test('VIP only -> DENY (cannot access without Pro or Max)', () => {
      expect(evaluateChannelAccess(proLounge, ['role-vip'])).toBe(false);
    });

    test('Kosmo Pro -> ALLOW', () => {
      expect(evaluateChannelAccess(proLounge, ['role-pro'])).toBe(true);
    });

    test('Kosmo Max -> ALLOW', () => {
      expect(evaluateChannelAccess(proLounge, ['role-max'])).toBe(true);
    });

    test('VIP + Pro -> ALLOW', () => {
      expect(evaluateChannelAccess(proLounge, ['role-vip', 'role-pro'])).toBe(true);
    });

    test('VIP + Max -> ALLOW', () => {
      expect(evaluateChannelAccess(proLounge, ['role-vip', 'role-max'])).toBe(true);
    });

    test('Founder -> ALLOW', () => {
      expect(evaluateChannelAccess(proLounge, ['role-founder'])).toBe(true);
    });

    test('Team Kosmo -> ALLOW', () => {
      expect(evaluateChannelAccess(proLounge, ['role-team'])).toBe(true);
    });

    test('Moderator -> ALLOW', () => {
      expect(evaluateChannelAccess(proLounge, ['role-moderator'])).toBe(true);
    });

    test('KosmoBot -> ALLOW', () => {
      expect(evaluateChannelAccess(proLounge, ['role-bot'])).toBe(true);
    });
  });

  describe('#max-exclusive Permission Matrix', () => {
    test('Regular member -> DENY', () => {
      expect(evaluateChannelAccess(maxExclusive, ['role-kosmosian'])).toBe(false);
    });

    test('VIP only -> DENY', () => {
      expect(evaluateChannelAccess(maxExclusive, ['role-vip'])).toBe(false);
    });

    test('Kosmo Pro -> DENY (cannot access Max Exclusive)', () => {
      expect(evaluateChannelAccess(maxExclusive, ['role-pro'])).toBe(false);
    });

    test('Kosmo Max -> ALLOW', () => {
      expect(evaluateChannelAccess(maxExclusive, ['role-max'])).toBe(true);
    });

    test('VIP + Pro -> DENY (Pro still denied Max Exclusive)', () => {
      expect(evaluateChannelAccess(maxExclusive, ['role-vip', 'role-pro'])).toBe(false);
    });

    test('VIP + Max -> ALLOW', () => {
      expect(evaluateChannelAccess(maxExclusive, ['role-vip', 'role-max'])).toBe(true);
    });

    test('Founder -> ALLOW', () => {
      expect(evaluateChannelAccess(maxExclusive, ['role-founder'])).toBe(true);
    });

    test('Team Kosmo -> ALLOW', () => {
      expect(evaluateChannelAccess(maxExclusive, ['role-team'])).toBe(true);
    });

    test('Moderator -> ALLOW', () => {
      expect(evaluateChannelAccess(maxExclusive, ['role-moderator'])).toBe(true);
    });

    test('KosmoBot -> ALLOW', () => {
      expect(evaluateChannelAccess(maxExclusive, ['role-bot'])).toBe(true);
    });
  });

  describe('#priority-support Permission Matrix', () => {
    test('Regular member -> DENY', () => {
      expect(evaluateChannelAccess(prioritySupport, ['role-kosmosian'])).toBe(false);
    });

    test('VIP only -> DENY', () => {
      expect(evaluateChannelAccess(prioritySupport, ['role-vip'])).toBe(false);
    });

    test('Kosmo Pro -> ALLOW', () => {
      expect(evaluateChannelAccess(prioritySupport, ['role-pro'])).toBe(true);
    });

    test('Kosmo Max -> ALLOW', () => {
      expect(evaluateChannelAccess(prioritySupport, ['role-max'])).toBe(true);
    });

    test('VIP + Pro -> ALLOW', () => {
      expect(evaluateChannelAccess(prioritySupport, ['role-vip', 'role-pro'])).toBe(true);
    });

    test('VIP + Max -> ALLOW', () => {
      expect(evaluateChannelAccess(prioritySupport, ['role-vip', 'role-max'])).toBe(true);
    });

    test('Founder -> ALLOW', () => {
      expect(evaluateChannelAccess(prioritySupport, ['role-founder'])).toBe(true);
    });

    test('Team Kosmo -> ALLOW', () => {
      expect(evaluateChannelAccess(prioritySupport, ['role-team'])).toBe(true);
    });

    test('Moderator -> ALLOW', () => {
      expect(evaluateChannelAccess(prioritySupport, ['role-moderator'])).toBe(true);
    });

    test('KosmoBot -> ALLOW', () => {
      expect(evaluateChannelAccess(prioritySupport, ['role-bot'])).toBe(true);
    });
  });
});
