// src/services/discord/repair.ts

import { authorize, Category } from './policy';
import type { RepairInput, RepairResult } from '../../types/repair';
import type {
  DesiredRole,
  DesiredChannel,
  DesiredState,
  PermissionTemplate,
  PermissionTemplateOverwrite,
} from '../../types/desiredState';
import type {
  AuditReport,
  RoleInfo,
  ChannelInfo,
} from '../../types/audit';
import type { DiscordAction } from './types';

/** Helper to find a role by name in the audit report */
function findRoleByName(
  audit: AuditReport,
  name: string
): RoleInfo | undefined {
  return audit.roles.find((r) => r.name === name);
}

/** Helper to find a channel by name in the audit report */
function findChannelByName(
  audit: AuditReport,
  name: string
): ChannelInfo | undefined {
  return audit.channels.find((c) => c.name === name);
}

/** Resolve placeholders like "role:Everyone" to real Discord role IDs */
function resolvePlaceholderId(
  audit: AuditReport,
  placeholder: string
): string | undefined {
  const match = placeholder.match(/^role:(.+)$/i);
  if (!match) return undefined;

  const roleName = match[1];
  const role = findRoleByName(audit, roleName);

  return role?.id;
}

/** Normalize permission overwrites for comparison */
function normaliseOverwrites(
  overwrites: { id: string; allow?: string[]; deny?: string[] }[]
) {
  return overwrites
    .map((ow) => ({
      id: ow.id,
      allow: (ow.allow ?? []).slice().sort(),
      deny: (ow.deny ?? []).slice().sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Compare permission overwrite arrays */
function overwritesEqual(
  a: { id: string; allow?: string[]; deny?: string[] }[],
  b: { id: string; allow?: string[]; deny?: string[] }[]
) {
  const na = normaliseOverwrites(a);
  const nb = normaliseOverwrites(b);

  return JSON.stringify(na) === JSON.stringify(nb);
}

/** Main repair planning function */
export function generateRepairPlan(input: RepairInput): RepairResult {
  const { audit, desired, userRoleIds } = input;

  const summary = {
    missingRoles: [] as string[],
    missingChannels: [] as string[],
    permissionDrift: [] as string[],
    commandDrift: [] as string[],
    protectedResources: [] as string[],
  };

  const result: RepairResult = {
    status: 'READY',
    actions: [],
    summary,
  };

  const warnings: string[] = [];

  // ---------- Authorization ----------

  const decision = authorize(userRoleIds, Category.REPAIR);

  if (decision === 'DENY') {
    result.status = 'DENIED';
    result.errors = ['User is not authorized to perform a repair.'];

    return result;
  }

  if (decision === 'REQUIRES_FOUNDERS_APPROVAL') {
    result.status = 'PENDING_APPROVAL';
    warnings.push('Founder approval is required before repair execution.');
  }

  // ---------- Guild ID check ----------

  if (
    desired.guildId !== 'GUILD_ID_PLACEHOLDER' &&
    desired.guildId !== audit.guild.id
  ) {
    warnings.push(
      `Desired guildId (${desired.guildId}) does not match audit guild (${audit.guild.id}).`
    );
  }

  // ---------- Roles ----------

  desired.roles.forEach((dr: DesiredRole) => {
    const existing = findRoleByName(audit, dr.name);

    if (!existing) {
      summary.missingRoles.push(dr.name);

      result.actions.push({
        type: 'createRole',
        payload: {
          name: dr.name,
        },
      } as DiscordAction);

      if (dr.logical === 'Founder') {
        summary.protectedResources.push(dr.name);

        warnings.push(
          'Founder role creation requires founder approval (high risk).'
        );
      }
    } else {
      if (existing.position !== dr.position) {
        summary.permissionDrift.push(
          `Role "${dr.name}" position drift (desired ${dr.position}, actual ${existing.position}).`
        );

        warnings.push(
          `Role "${dr.name}" position drift (desired ${dr.position}, actual ${existing.position}) – unsupported edit.`
        );
      }

      warnings.push(
        `Role "${dr.name}" permissions may drift – cannot edit with current action set.`
      );
    }
  });

  // ---------- Channels ----------

  desired.channels.forEach((dc: DesiredChannel) => {
    const existing = findChannelByName(audit, dc.name);

    if (!existing) {
      summary.missingChannels.push(dc.name);

      result.actions.push({
        type: 'createChannel',
        payload: {
          name: dc.name,
          type: dc.type,
        },
      } as DiscordAction);
    } else {
      if (existing.type !== dc.type) {
        summary.permissionDrift.push(
          `Channel "${dc.name}" type mismatch.`
        );

        warnings.push(
          `Channel "${dc.name}" type mismatch (desired ${dc.type}, actual ${existing.type}) – cannot mutate.`
        );
      }

      if (dc.parent) {
        const parentChannel = findChannelByName(audit, dc.parent);

        const actualParentId = existing.parentId;
        const expectedParentId = parentChannel?.id ?? null;

        if (actualParentId !== expectedParentId) {
          warnings.push(
            `Channel "${dc.name}" parent mismatch – unsupported edit.`
          );
        }
      }
    }
  });

  // ---------- Permission Templates ----------

  const templateMap = new Map<string, PermissionTemplate>();

  (desired.permissionTemplates ?? []).forEach((template) => {
    templateMap.set(template.name, template);
  });

  desired.channels.forEach((dc: DesiredChannel) => {
    if (!dc.permissionTemplate) return;

    const template = templateMap.get(dc.permissionTemplate);

    if (!template) {
      warnings.push(
        `Permission template "${dc.permissionTemplate}" not found.`
      );
      return;
    }

    const targetChannel = findChannelByName(audit, dc.name);

    const resolvedOverwrites = template.overwrites
      .map((ow) => {
        const resolvedId = resolvePlaceholderId(audit, ow.id);

        if (!resolvedId) {
          warnings.push(
            `Unable to resolve placeholder ${ow.id} for template ${template.name}.`
          );

          return null;
        }

        return {
          id: resolvedId,
          allow: ow.allow,
          deny: ow.deny,
        };
      })
      .filter((ow): ow is PermissionTemplateOverwrite => ow !== null);

    if (
      targetChannel &&
      resolvedOverwrites.length === template.overwrites.length &&
      !overwritesEqual(
        template.overwrites,
        targetChannel.permissionOverwrites
      )
    ) {
      summary.permissionDrift.push(dc.name);

      result.actions.push({
        type: 'applyPermissionTemplate',
        payload: {
          targetName: dc.name,
          permissionOverwrites: resolvedOverwrites,
        },
      } as DiscordAction);
    }
  });

  // ---------- Commands ----------

  if (desired.commands?.length) {
    desired.commands.forEach((cmd) => {
      const exists = audit.commands.find(
        (c) => c.name === cmd.name
      );

      if (!exists) {
        summary.commandDrift.push(cmd.name);

        warnings.push(
          `Command "${cmd.name}" missing – unsupported creation action.`
        );
      } else if (
        exists.description !== cmd.description ||
        exists.defaultPermission !== cmd.defaultPermission
      ) {
        summary.commandDrift.push(cmd.name);

        warnings.push(
          `Command "${cmd.name}" drift – unsupported edit action.`
        );
      }
    });
  }

  // ---------- Final result ----------

  if (warnings.length) {
    result.warnings = warnings;
  }

  return result;
}