// src/services/discord/repair.ts

import { Guild, ChannelType } from 'discord.js';
import * as fs from 'fs';
import * as path from 'path';
import { DiscordAction, PermissionOverwrite } from './types';
import { authorize, Category, LogicalRole } from './policy';
import { validateAction, PRIVILEGED_ROLE_NAMES } from './permissionValidator';
import { findRole, findChannel } from './lookup';
import { DesiredState, DesiredChannel, DesiredRole, PermissionTemplate } from '../../types/desiredState';
import {
  RepairOptions,
  RepairResult,
  DriftItem,
  RepairPlanStatus,
} from '../../types/repair';

/**
 * Loads desired-state configuration from disk if not provided.
 */
function loadDesiredState(): DesiredState {
  const configPath = path.resolve(__dirname, '../../config/desiredState.json');
  const raw = fs.readFileSync(configPath, { encoding: 'utf-8' });
  return JSON.parse(raw);
}

/**
 * Maps desired channel type string to Discord ChannelType number.
 */
function mapChannelType(type: 'GUILD_TEXT' | 'GUILD_VOICE' | 'GUILD_CATEGORY'): ChannelType {
  switch (type) {
    case 'GUILD_TEXT':
      return ChannelType.GuildText;
    case 'GUILD_VOICE':
      return ChannelType.GuildVoice;
    case 'GUILD_CATEGORY':
      return ChannelType.GuildCategory;
    default:
      return ChannelType.GuildText;
  }
}

/**
 * Generates a repair plan by comparing the live Guild state with the DesiredState.
 *
 * This function is strictly read-only: it generates and validates the plan
 * but NEVER executes mutations or calls runAction().
 */
export async function generateRepairPlan(options: RepairOptions): Promise<RepairResult> {
  const { guild, userRoleIds } = options;
  const warnings: string[] = [];
  const errors: string[] = [];
  const driftItems: DriftItem[] = [];
  const actions: DiscordAction[] = [];
  const generatedAt = new Date();

  // 1. Authorization Check
  const decision = authorize(userRoleIds, Category.REPAIR);

  if (decision === 'DENY') {
    return {
      status: 'DENIED',
      actions: [],
      driftItems: [],
      warnings: [],
      errors: ['Unauthorized: repair operation is not permitted for your role.'],
      summary: 'Repair denied: user lacks sufficient permissions.',
      generatedAt,
    };
  }

  if (decision === 'REQUIRES_FOUNDERS_APPROVAL') {
    return {
      status: 'PENDING_APPROVAL',
      actions: [],
      driftItems: [],
      warnings: ['Repair requires explicit Founder approval before a plan can be generated or executed.'],
      errors: [],
      summary: 'Repair requires Founder approval before planning or execution.',
      generatedAt,
    };
  }

  // 2. Load Desired State
  let desired: DesiredState;
  try {
    desired = options.desiredState ?? loadDesiredState();
  } catch (err: any) {
    return {
      status: 'BLOCKED',
      actions: [],
      driftItems: [],
      warnings: [],
      errors: [`Failed to load desiredState configuration: ${err.message}`],
      blockedReasons: ['Missing or unparseable desiredState configuration.'],
      summary: 'Repair blocked: unable to load desired state configuration.',
      generatedAt,
    };
  }

  // 3. Diff Roles
  for (const desiredRole of desired.roles || []) {
    const existing = findRole(guild, desiredRole.name);

    if (!existing) {
      const lowerName = desiredRole.name.toLowerCase();
      const isPrivileged =
        desiredRole.logical === LogicalRole.Founder ||
        PRIVILEGED_ROLE_NAMES.some((p) => p.toLowerCase() === lowerName);

      if (isPrivileged) {
        if (desiredRole.logical === LogicalRole.Founder || lowerName === 'founder') {
          driftItems.push({
            type: 'FOUNDER_DRIFT',
            targetName: desiredRole.name,
            description: `Founder role "${desiredRole.name}" is missing in the guild, but automated repair of Founder roles is forbidden.`,
            severity: 'PROTECTED',
          });
          warnings.push(`Founder role "${desiredRole.name}" is missing; skipping automated creation.`);
        } else {
          driftItems.push({
            type: 'ROLE_DRIFT',
            targetName: desiredRole.name,
            description: `Privileged role "${desiredRole.name}" is missing in the guild; human setup is required as automated creation is forbidden.`,
            severity: 'PROTECTED',
          });
          warnings.push(`Privileged role "${desiredRole.name}" is missing; skipping automated creation.`);
        }
      } else {
        driftItems.push({
          type: 'MISSING_ROLE',
          targetName: desiredRole.name,
          description: `Role "${desiredRole.name}" is missing in guild.`,
          severity: 'INFO',
        });
        actions.push({
          type: 'createRole',
          payload: {
            name: desiredRole.name,
            hoist: false,
          },
        });
      }
    } else {
      // Role exists – report existing role drift as a warning
      const desiredPerms = desiredRole.permissions || [];
      if (desiredPerms.length > 0) {
        driftItems.push({
          type: 'ROLE_DRIFT',
          targetName: desiredRole.name,
          description: `Role "${desiredRole.name}" already exists; permission modification is not supported in create-only repair.`,
          severity: 'WARNING',
        });
        warnings.push(`Role "${desiredRole.name}" drift detected; modifying existing roles is unsupported in this phase.`);
      }
    }
  }

  // 4. Diff Channels
  for (const desiredChannel of desired.channels || []) {
    const existing = findChannel(guild, desiredChannel.name);

    if (!existing) {
      driftItems.push({
        type: 'MISSING_CHANNEL',
        targetName: desiredChannel.name,
        description: `Channel "${desiredChannel.name}" (${desiredChannel.type}) is missing in guild.`,
        severity: 'INFO',
      });

      actions.push({
        type: 'createChannel',
        payload: {
          name: desiredChannel.name,
          type: desiredChannel.type,
        },
      });

      // If channel has a permission template attached, generate applyPermissionTemplate
      if (desiredChannel.permissionTemplate && desired.permissionTemplates) {
        const tpl = desired.permissionTemplates.find(
          (t) => t.name === desiredChannel.permissionTemplate
        );

        if (tpl) {
          const resolvedOverwrites: PermissionOverwrite[] = (tpl.overwrites || []).map((ow) => {
            let targetId = ow.id;
            // Resolve placeholder roles
            if (ow.id === 'role:Everyone' || ow.id === '@everyone') {
              targetId = guild.id || '@everyone';
            } else if (ow.id.startsWith('role:')) {
              const roleName = ow.id.replace('role:', '');
              const matchedRole = findRole(guild, roleName);
              targetId = matchedRole ? matchedRole.id : roleName;
            }

            return {
              id: targetId,
              allow: ow.allow,
              deny: ow.deny,
            };
          });

          actions.push({
            type: 'applyPermissionTemplate',
            payload: {
              targetName: desiredChannel.name,
              permissionOverwrites: resolvedOverwrites,
            },
          });
        }
      }
    } else {
      // Channel exists – check for type mismatch
      const expectedType = mapChannelType(desiredChannel.type);
      if (existing.type !== expectedType) {
        driftItems.push({
          type: 'CHANNEL_TYPE_MISMATCH',
          targetName: desiredChannel.name,
          description: `Channel "${desiredChannel.name}" has type ${existing.type}, but expected ${expectedType} (${desiredChannel.type}).`,
          severity: 'ERROR',
        });
        errors.push(`Channel type mismatch on "${desiredChannel.name}". Existing channel type differs from desired state.`);
        // Channel type mismatch must NOT produce a mutation for that channel
      } else {
        // Channel exists and type matches
        if (desiredChannel.permissionTemplate) {
          driftItems.push({
            type: 'PERMISSION_DRIFT',
            targetName: desiredChannel.name,
            description: `Channel "${desiredChannel.name}" exists; template re-application is skipped for existing channels in create-only repair.`,
            severity: 'WARNING',
          });
          warnings.push(`Channel "${desiredChannel.name}" exists; template modifications on existing channels are reported as warnings.`);
        }
      }
    }
  }

  // 5. Check for Unmanaged Resources (Third-party / protected)
  if (guild.roles?.cache) {
    guild.roles.cache.forEach((role) => {
      const isManaged = (desired.roles || []).some((r) => r.name.toLowerCase() === role.name.toLowerCase());
      if (!isManaged && role.name !== '@everyone') {
        driftItems.push({
          type: 'UNMANAGED_RESOURCE',
          targetName: role.name,
          description: `Role "${role.name}" is not defined in desired state and is treated as unmanaged/protected.`,
          severity: 'PROTECTED',
        });
      }
    });
  }

  // 6. Safety Validation Loop (Using existing validateAction(guild, action))
  const blockedReasons: string[] = [];
  for (const action of actions) {
    try {
      validateAction(guild, action);
    } catch (err: any) {
      blockedReasons.push(`Action [${action.type}] for payload ${JSON.stringify(action.payload)} violated safety policy: ${err.message}`);
    }
  }

  if (blockedReasons.length > 0) {
    return {
      status: 'BLOCKED',
      actions: [], // Zero executable actions on validation failure
      driftItems,
      warnings,
      errors: [...errors, ...blockedReasons],
      blockedReasons,
      summary: `Repair plan BLOCKED due to safety violations: ${blockedReasons.join('; ')}`,
      generatedAt,
    };
  }

  const status: RepairPlanStatus = actions.length === 0 ? 'NO_OP' : 'READY';
  const summary =
    status === 'NO_OP'
      ? 'Guild is fully aligned with desired state (or remaining drift cannot be repaired in create-only mode). No actions required.'
      : `Repair plan generated with ${actions.length} action(s) across ${driftItems.length} detected drift item(s).`;

  return {
    status,
    actions,
    driftItems,
    warnings,
    errors,
    summary,
    generatedAt,
  };
}
