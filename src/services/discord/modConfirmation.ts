import crypto from 'crypto';
import { cache, redisKeys, REDIS_TTL } from '../cache';

export type ModActionStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' | 'EXECUTED' | 'FAILED';

export interface PendingModAction {
  id: string;
  guildId: string;
  moderatorId: string;
  targetId?: string;
  targetTag?: string;
  channelId?: string;
  amount?: number;
  actionType: 'KICK' | 'BAN' | 'PURGE' | 'REWARD_SPARKS';
  reason: string;
  status: ModActionStatus;
  createdAt: Date;
  expiresAt: Date;
}

export const MOD_CONFIRMATION_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const MOD_CONFIRMATION_TTL_SEC = REDIS_TTL.MOD_CONFIRMATION; // 5 minutes in seconds

// In-memory test mirror for pending moderation actions
const pendingModActions = new Map<string, PendingModAction>();

/**
 * Creates a new pending moderation action with a 5-minute TTL.
 * Stored in Redis (speed layer with 300s TTL) and local memory mirror.
 */
export function createPendingModAction(
  data: Omit<PendingModAction, 'id' | 'status' | 'createdAt' | 'expiresAt'>
): PendingModAction {
  const id = crypto.randomUUID();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + MOD_CONFIRMATION_TTL_MS);

  const pendingAction: PendingModAction = {
    ...data,
    id,
    status: 'PENDING',
    createdAt,
    expiresAt,
  };

  pendingModActions.set(id, pendingAction);
  cache.set(redisKeys.modAction(id), pendingAction, REDIS_TTL.MOD_CONFIRMATION).catch((err) => {
    console.warn(`Failed to store mod_action:${id} in Redis:`, err);
  });

  return pendingAction;
}

/**
 * Retrieves a pending moderation action by ID.
 * Automatically marks as EXPIRED if the 5-minute TTL has elapsed.
 */
export function getPendingModAction(actionId: string): PendingModAction | undefined {
  const action = pendingModActions.get(actionId);
  if (!action) return undefined;

  if (action.status === 'PENDING' && Date.now() > action.expiresAt.getTime()) {
    action.status = 'EXPIRED';
    cache.set(redisKeys.modAction(actionId), action, REDIS_TTL.MOD_CONFIRMATION_TERMINAL).catch(() => {});
  }

  return action;
}

/**
 * Asynchronous retrieval of pending moderation action directly from Redis.
 */
export async function getPendingModActionAsync(actionId: string): Promise<PendingModAction | null> {
  const raw = await cache.get<PendingModAction>(redisKeys.modAction(actionId));
  if (!raw) {
    const local = pendingModActions.get(actionId);
    return local || null;
  }

  const action: PendingModAction = {
    ...raw,
    createdAt: new Date(raw.createdAt),
    expiresAt: new Date(raw.expiresAt),
  };

  if (action.status === 'PENDING' && Date.now() > action.expiresAt.getTime()) {
    action.status = 'EXPIRED';
    await cache.set(redisKeys.modAction(actionId), action, REDIS_TTL.MOD_CONFIRMATION_TERMINAL);
  }

  return action;
}

export interface ConfirmModActionResult {
  success: boolean;
  action?: PendingModAction;
  error?: string;
}

/**
 * Atomically transitions action from PENDING -> CONFIRMED.
 * Enforces:
 *   - Action exists and is not expired
 *   - Guild ID matches
 *   - Moderator ID matches
 *   - Replay protection (only PENDING actions can be confirmed)
 */
export function atomicConfirmModAction(
  actionId: string,
  moderatorId: string,
  guildId: string
): ConfirmModActionResult {
  const action = getPendingModAction(actionId);
  if (!action) {
    return { success: false, error: 'Moderation action not found or expired.' };
  }

  if (action.guildId !== guildId) {
    return { success: false, error: 'Action does not belong to this server.' };
  }

  if (action.moderatorId !== moderatorId) {
    return { success: false, error: 'Only the moderator who initiated this action can confirm it.' };
  }

  if (action.status === 'EXPIRED' || Date.now() > action.expiresAt.getTime()) {
    action.status = 'EXPIRED';
    return { success: false, error: 'This moderation confirmation has expired (5 minute limit).' };
  }

  if (action.status !== 'PENDING') {
    return {
      success: false,
      error: `Action has already been ${action.status.toLowerCase()} and cannot be confirmed again.`,
    };
  }

  // Atomic transition: PENDING -> CONFIRMED
  action.status = 'CONFIRMED';
  const remainingSec = Math.max(1, Math.ceil((action.expiresAt.getTime() - Date.now()) / 1000));
  cache.set(redisKeys.modAction(actionId), action, remainingSec).catch(() => {});
  return { success: true, action };
}

export interface CancelModActionResult {
  success: boolean;
  message: string;
}

/**
 * Cancels a pending moderation action.
 */
export function cancelModAction(
  actionId: string,
  moderatorId: string,
  guildId: string
): CancelModActionResult {
  const action = getPendingModAction(actionId);
  if (!action) {
    return { success: false, message: 'Moderation action not found.' };
  }

  if (action.guildId !== guildId) {
    return { success: false, message: 'Action does not belong to this server.' };
  }

  if (action.moderatorId !== moderatorId) {
    return { success: false, message: 'Only the moderator who initiated this action can cancel it.' };
  }

  if (action.status !== 'PENDING') {
    return {
      success: false,
      message: `Action is already ${action.status.toLowerCase()}.`,
    };
  }

  action.status = 'CANCELLED';
  cache.set(redisKeys.modAction(actionId), action, REDIS_TTL.MOD_CONFIRMATION_TERMINAL).catch(() => {});
  return { success: true, message: 'Moderation action cancelled.' };
}

/**
 * Transitions action from CONFIRMED -> EXECUTED after successful kick and verified absence.
 */
export function markExecuted(actionId: string): boolean {
  const action = pendingModActions.get(actionId);
  if (!action) return false;
  if (action.status !== 'CONFIRMED') return false;

  action.status = 'EXECUTED';
  cache.set(redisKeys.modAction(actionId), action, REDIS_TTL.MOD_CONFIRMATION_TERMINAL).catch(() => {});
  return true;
}

/**
 * Transitions action from CONFIRMED -> FAILED after execution failure.
 * Ensures the action is placed in a terminal state and cannot be confirmed again.
 */
export function markFailed(actionId: string): boolean {
  const action = pendingModActions.get(actionId);
  if (!action) return false;
  if (action.status !== 'CONFIRMED' && action.status !== 'PENDING') return false;

  action.status = 'FAILED';
  cache.set(redisKeys.modAction(actionId), action, REDIS_TTL.MOD_CONFIRMATION_TERMINAL).catch(() => {});
  return true;
}

/**
 * Periodically cleans up actions older than 1 hour.
 */
export function cleanupExpired(): void {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [id, action] of pendingModActions.entries()) {
    if (action.createdAt.getTime() < oneHourAgo) {
      pendingModActions.delete(id);
    }
  }
}

/**
 * Test helper to reset the in-memory store.
 */
export function _resetModConfirmationStore(): void {
  pendingModActions.clear();
}
