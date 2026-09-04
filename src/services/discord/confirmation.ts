// src/services/discord/confirmation.ts

import { Guild } from 'discord.js';
import { Plan, PlanStatus } from './types';
import { PlanService } from './plan';
import { authorize, Category, AuthContext } from './policy';
import { PermissionValidator } from './permissionValidator';
import { runAction } from './actions';

/**
 * Result returned by the confirmation and execution workflow.
 */
export interface ConfirmationResult {
  success: boolean;
  status: PlanStatus;
  plan?: Plan;
  message: string;
  executionResults?: string[];
  requiresFounderApproval?: boolean;
  unauthorized?: boolean;
}

/**
 * Confirms and deterministically executes a pending Plan.
 *
 * Security & Execution Pipeline:
 * 1. Plan lookup & lifecycle validation (must be in 'PROPOSED' status)
 * 2. Authorization re-check against centralized Policy (Category.CONFIRM)
 * 3. State transition to 'CONFIRMED' (prevents double execution)
 * 4. Safety re-validation through PermissionValidator immediately before execution
 * 5. Deterministic Discord execution via runAction()
 * 6. Final state transition to 'EXECUTED'
 *
 * @param guild The Discord guild where actions are performed.
 * @param planId The ID of the pending plan to execute.
 * @param userRoleIds Discord role IDs of the confirming human.
 * @param context Caller and guild owner context for dynamic server-owner authorization.
 */
export async function confirmAndExecutePlan(
  guild: Guild,
  planId: string,
  userRoleIds: string[],
  context?: AuthContext
): Promise<ConfirmationResult> {
  // 1. Plan lookup
  const plan = PlanService.getPlan(planId);
  if (!plan) {
    return {
      success: false,
      status: 'REJECTED',
      message: `Plan "${planId}" not found or expired.`,
    };
  }

  // Lifecycle check: prevent duplicate or stale executions
  if (plan.status === 'EXECUTED') {
    return {
      success: false,
      status: 'EXECUTED',
      plan,
      message: `Plan "${planId}" has already been executed.`,
    };
  }

  if (plan.status === 'CANCELLED') {
    return {
      success: false,
      status: 'CANCELLED',
      plan,
      message: `Plan "${planId}" has been cancelled and cannot be executed.`,
    };
  }

  if (plan.status !== 'PROPOSED') {
    return {
      success: false,
      status: plan.status,
      plan,
      message: `Plan "${planId}" cannot be executed in status '${plan.status}'.`,
    };
  }

  // 2. Centralized Policy Authorization Re-Check (CONFIRM category)
  // Dynamic guild owner verification via context (guild.ownerId)
  const decision = authorize(userRoleIds, Category.CONFIRM, context);

  if (decision === 'DENY') {
    // Unauthorized confirmation: plan remains PROPOSED
    return {
      success: false,
      status: 'PROPOSED',
      plan,
      unauthorized: true,
      message: 'You are not authorized to confirm this action.',
    };
  }

  if (decision === 'REQUIRES_FOUNDERS_APPROVAL') {
    // Admin or role requiring founder approval: plan remains PROPOSED
    return {
      success: false,
      status: 'PROPOSED',
      plan,
      requiresFounderApproval: true,
      message: 'Confirmation requires Founder or Team Kosmo approval.',
    };
  }

  // 3. Atomically transition state to CONFIRMED to prevent double confirmation
  plan.status = 'CONFIRMED';

  // 4. Safety re-validation through PermissionValidator immediately before execution
  const validation = PermissionValidator.validateActions(plan.actions);
  if (!validation.valid || validation.blocked) {
    plan.status = 'REJECTED';
    const reason = validation.blockedReasons?.[0] || validation.errors[0] || 'Safety validation rejected the plan.';
    return {
      success: false,
      status: 'REJECTED',
      plan,
      message: `Safety validation blocked execution: ${reason}`,
    };
  }

  // 5. Deterministic Discord execution via runAction()
  const executionResults: string[] = [];
  try {
    for (const action of plan.actions) {
      const res = await runAction(guild, action);
      executionResults.push(res);
    }

    // 6. Transition to EXECUTED upon completion
    plan.status = 'EXECUTED';
    return {
      success: true,
      status: 'EXECUTED',
      plan,
      message: 'Action confirmed and executed.',
      executionResults,
    };
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    // Do NOT falsely mark plan EXECUTED on failure
    return {
      success: false,
      status: 'CONFIRMED',
      plan,
      message: `Execution failed: ${errorMsg}`,
      executionResults,
    };
  }
}

/**
 * Cancels a pending Plan, transitioning its status to CANCELLED.
 *
 * @param planId The ID of the pending plan to cancel.
 * @param userRoleIds Discord role IDs of the human requesting cancellation.
 * @param context Caller and guild owner context.
 */
export function cancelPlan(
  planId: string,
  userRoleIds: string[],
  context?: AuthContext
): ConfirmationResult {
  const plan = PlanService.getPlan(planId);
  if (!plan) {
    return {
      success: false,
      status: 'REJECTED',
      message: `Plan "${planId}" not found or expired.`,
    };
  }

  if (plan.status !== 'PROPOSED') {
    return {
      success: false,
      status: plan.status,
      plan,
      message: `Plan "${planId}" cannot be cancelled in status '${plan.status}'.`,
    };
  }

  plan.status = 'CANCELLED';
  return {
    success: true,
    status: 'CANCELLED',
    plan,
    message: 'Action cancelled. No changes were made.',
  };
}
