// src/types/audit.d.ts

/**
 * Minimal type definitions for the audit service report.
 */

export interface GuildInfo {
  id: string;
  name: string;
}

export interface RoleInfo {
  id: string;
  name: string;
  position: number;
  permissions: string; // bitfield as string for JSON safety
}

export interface PermissionOverwriteInfo {
  id: string;
  allow: string[];
  deny: string[];
}

export interface ChannelInfo {
  id: string;
  name: string;
  type: string; // Discord channel type string
  parentId: string | null;
  permissionOverwrites: PermissionOverwriteInfo[];
}

export interface CommandInfo {
  id: string;
  name: string;
  description: string;
  defaultPermission: boolean;
}

export interface AuditReport {
  guild: GuildInfo;
  roles: RoleInfo[];
  channels: ChannelInfo[];
  commands: CommandInfo[];
  hasDesiredStateConfig: boolean;
}
