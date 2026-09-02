export type CreateRolePayload = {
  name: string;
  color?: number;
  hoist?: boolean;
};

export type CreateChannelPayload = {
  name: string;
  type: 'GUILD_TEXT' | 'GUILD_VOICE' | 'GUILD_CATEGORY';
};

export type AssignRolePayload = {
  roleName: string;
  memberId: string;
};

export type RemoveRolePayload = AssignRolePayload;

export type PermissionOverwrite = {
  id: string;
  allow?: string[];
  deny?: string[];
};

export type ApplyPermissionTemplatePayload = {
  targetName: string;
  permissionOverwrites: PermissionOverwrite[];
};

export type DiscordAction =
  | { type: 'createRole'; payload: CreateRolePayload }
  | { type: 'createChannel'; payload: CreateChannelPayload }
  | { type: 'assignRole'; payload: AssignRolePayload }
  | { type: 'removeRole'; payload: RemoveRolePayload }
  | { type: 'applyPermissionTemplate'; payload: ApplyPermissionTemplatePayload };
