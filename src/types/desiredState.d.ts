// src/types/desiredState.d.ts

import type { LogicalRole } from '../services/discord/policy';

/** Desired representation of a Discord role. */
export interface DesiredRole {
  /** Logical role name – must match one of the LogicalRole enum values. */
  logical: LogicalRole;
  /** Exact Discord role name as it appears in the guild. */
  name: string;
  /** Position in the role hierarchy (higher numbers = higher on the list). */
  position: number;
  /** Permissions expressed as an array of Discord permission flag strings. */
  permissions: string[];
}

/** Desired channel or category definition. */
export interface DesiredChannel {
  /** Channel name (must be unique within the guild). */
  name: string;
  /** Channel type – matches the payload accepted by the createChannel action. */
  type: 'GUILD_TEXT' | 'GUILD_VOICE' | 'GUILD_CATEGORY';
  /** Optional parent category name (null for top‑level categories). */
  parent?: string | null;
  /** Optional name of a permission template to apply to the channel. */
  permissionTemplate?: string;
}

/** Permission overwrite entry used by a permission template. */
export interface PermissionTemplateOverwrite {
  /** Identifier placeholder – e.g. "role:Everyone" or "role:Bot". */
  id: string;
  /** Permissions to allow. */
  allow: string[];
  /** Permissions to deny. */
  deny: string[];
}

/** Reusable permission template that can be referenced by DesiredChannel. */
export interface PermissionTemplate {
  /** Template name – referenced from DesiredChannel.permissionTemplate. */
  name: string;
  /** Collection of overwrites. */
  overwrites: PermissionTemplateOverwrite[];
}

/** Desired slash command definition. */
export interface DesiredCommand {
  name: string;
  description: string;
  defaultPermission: boolean;
}

/** Top‑level desired‑state descriptor. */
export interface DesiredState {
  /** Discord guild identifier – use a placeholder if the real ID is not known at compile time. */
  guildId: string;
  /** All logical roles that must exist in the guild. */
  roles: DesiredRole[];
  /** All channels / categories that must exist. */
  channels: DesiredChannel[];
  /** Optional permission templates referenced by channels. */
  permissionTemplates?: PermissionTemplate[];
  /** Optional slash commands that must be registered. */
  commands?: DesiredCommand[];
}

/** Result of resolving placeholders against an AuditReport. */
export interface ResolvedDesiredState extends Omit<DesiredState, 'permissionTemplates'> {
  permissionTemplates?: PermissionTemplate[];
}
