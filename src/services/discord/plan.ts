import { DiscordAction, Plan, RiskLevel, PlanStatus } from './types';
import { PermissionValidator } from './permissionValidator';
import { cache, redisKeys, REDIS_TTL } from '../cache';

/**
 * Plan evaluation and formatting service.
 */
export class PlanService {
  /**
   * Calculates overall risk level for an array of Discord actions.
   */
  public static calculateRiskLevel(actions: DiscordAction[]): {
    riskLevel: RiskLevel;
    blockedReasons: string[];
  } {
    const validation = PermissionValidator.validateActions(actions);
    if (validation.blocked) {
      return {
        riskLevel: 'BLOCKED',
        blockedReasons: validation.blockedReasons || ['Action is blocked by safety policy.'],
      };
    }

    let highestRisk: RiskLevel = 'LOW';

    for (const action of actions) {
      switch (action.type) {
        case 'applyPermissionTemplate':
          if (highestRisk === 'LOW') highestRisk = 'MEDIUM';
          break;

        case 'assignRole':
        case 'removeRole': {
          const roleLower = action.payload.roleName.toLowerCase();
          if (roleLower.includes('mod') || roleLower.includes('staff')) {
            highestRisk = 'HIGH';
          } else if (highestRisk === 'LOW') {
            highestRisk = 'MEDIUM';
          }
          break;
        }

        case 'deleteChannel':
        case 'deleteCategory':
        case 'deleteRole':
          highestRisk = 'HIGH';
          break;

        case 'createChannel':
        case 'createRole':
        default:
          break;
      }
    }

    return {
      riskLevel: highestRisk,
      blockedReasons: [],
    };
  }

  /**
   * Builds a Plan object from a list of actions and metadata.
   */
  /**
   * Builds a Plan object from a list of actions and metadata.
   */
  public static createPlan(
    name: string,
    description: string,
    actions: DiscordAction[],
    createdBy?: string,
    guildId?: string,
    ttlMs: number = 15 * 60 * 1000 // 15-minute default TTL
  ): Plan {
    const { riskLevel, blockedReasons } = this.calculateRiskLevel(actions);
    const now = new Date();

    return {
      id: `plan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      name,
      description,
      actions,
      riskLevel,
      blockedReasons: blockedReasons.length > 0 ? blockedReasons : undefined,
      status: (riskLevel === 'BLOCKED' ? 'REJECTED' : 'PROPOSED') as PlanStatus,
      createdAt: now,
      createdBy,
      guildId,
      expiresAt: new Date(now.getTime() + ttlMs),
    };
  }

  /**
   * Formats a plan into human-readable text for Discord Embeds or markdown preview.
   */
  public static formatPlanSummary(plan: Plan): string {
    const lines: string[] = [];
    lines.push(`📋 **Plan: ${plan.name}** (ID: \`${plan.id}\`)`);
    lines.push(`*${plan.description}*`);
    lines.push(`\n**Risk Level:** \`${plan.riskLevel}\` | **Status:** \`${plan.status}\``);

    if (plan.blockedReasons && plan.blockedReasons.length > 0) {
      lines.push(`\n⚠️ **BLOCKED REASONS:**`);
      plan.blockedReasons.forEach((r) => lines.push(`- 🚫 ${r}`));
    }

    lines.push(`\n**Proposed Actions (${plan.actions.length}):**`);
    plan.actions.forEach((act, idx) => {
      lines.push(`${idx + 1}. **[${act.type}]** ${JSON.stringify(act.payload)}`);
    });

    return lines.join('\n');
  }

  // In-memory test mirror for pending plans awaiting human confirmation
  private static pendingPlans = new Map<string, Plan>();

  public static storePlan(plan: Plan): void {
    this.pendingPlans.set(plan.id, plan);
    const ttlSec = plan.expiresAt
      ? Math.max(1, Math.ceil((plan.expiresAt.getTime() - Date.now()) / 1000))
      : REDIS_TTL.PLAN;
    cache.set(redisKeys.plan(plan.id), plan, ttlSec).catch((err) => {
      console.warn(`Failed to store plan:${plan.id} in Redis:`, err);
    });
  }

  public static getPlan(planId: string): Plan | undefined {
    const plan = this.pendingPlans.get(planId);
    if (!plan) return undefined;

    // Check expiration
    if (
      plan.expiresAt &&
      Date.now() > plan.expiresAt.getTime() &&
      (plan.status === 'PROPOSED' || plan.status === 'PENDING')
    ) {
      plan.status = 'EXPIRED';
      cache.set(redisKeys.plan(planId), plan, REDIS_TTL.PLAN_TERMINAL).catch(() => {});
    }

    return plan;
  }

  public static async getPlanAsync(planId: string): Promise<Plan | null> {
    const raw = await cache.get<Plan>(redisKeys.plan(planId));
    if (raw) {
      const plan: Plan = {
        ...raw,
        createdAt: new Date(raw.createdAt),
        expiresAt: raw.expiresAt ? new Date(raw.expiresAt) : undefined,
      };
      if (
        plan.expiresAt &&
        Date.now() > plan.expiresAt.getTime() &&
        (plan.status === 'PROPOSED' || plan.status === 'PENDING')
      ) {
        plan.status = 'EXPIRED';
        await cache.set(redisKeys.plan(planId), plan, REDIS_TTL.PLAN_TERMINAL);
      }
      return plan;
    }
    const local = this.getPlan(planId);
    return local || null;
  }

  public static getPendingPlansForGuild(guildId: string): Plan[] {
    const results: Plan[] = [];
    for (const plan of this.pendingPlans.values()) {
      if (plan.guildId === guildId) {
        // Evaluate expiry
        if (
          plan.expiresAt &&
          Date.now() > plan.expiresAt.getTime() &&
          (plan.status === 'PROPOSED' || plan.status === 'PENDING')
        ) {
          plan.status = 'EXPIRED';
        }
        if (plan.status === 'PROPOSED' || plan.status === 'PENDING') {
          results.push(plan);
        }
      }
    }
    return results;
  }

  public static removePlan(planId: string): void {
    this.pendingPlans.delete(planId);
    cache.del(redisKeys.plan(planId)).catch(() => {});
  }

  public static clearPendingPlans(): void {
    this.pendingPlans.clear();
  }

  public static cleanupExpiredPlans(): void {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const [id, plan] of this.pendingPlans.entries()) {
      if (plan.createdAt.getTime() < oneHourAgo) {
        this.pendingPlans.delete(id);
      }
    }
  }
}
