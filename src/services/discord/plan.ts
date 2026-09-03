import { DiscordAction, Plan, RiskLevel, PlanStatus } from './types';
import { PermissionValidator } from './permissionValidator';

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
        case 'removeRole':
          const roleLower = action.payload.roleName.toLowerCase();
          if (roleLower.includes('mod') || roleLower.includes('staff')) {
            highestRisk = 'HIGH';
          } else if (highestRisk === 'LOW') {
            highestRisk = 'MEDIUM';
          }
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
  public static createPlan(
    name: string,
    description: string,
    actions: DiscordAction[],
    createdBy?: string
  ): Plan {
    const { riskLevel, blockedReasons } = this.calculateRiskLevel(actions);

    return {
      id: `plan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      name,
      description,
      actions,
      riskLevel,
      blockedReasons: blockedReasons.length > 0 ? blockedReasons : undefined,
      status: (riskLevel === 'BLOCKED' ? 'REJECTED' : 'PROPOSED') as PlanStatus,
      createdAt: new Date(),
      createdBy,
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
}
