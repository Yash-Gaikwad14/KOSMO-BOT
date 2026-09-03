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

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'BLOCKED';

export type PlanStatus = 'PROPOSED' | 'CONFIRMED' | 'EXECUTED' | 'REJECTED' | 'CANCELLED';

export interface Plan {
  id: string;
  name: string;
  description: string;
  actions: DiscordAction[];
  riskLevel: RiskLevel;
  blockedReasons?: string[];
  status: PlanStatus;
  createdAt: Date;
  createdBy?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
  blocked?: boolean;
  blockedReasons?: string[];
}

export interface NLContext {
  userId: string;
  username: string;
  roles: string[];
  guildId?: string;
  channelId?: string;
  isFounder?: boolean;
}

export interface NLPlanResult {
  success: boolean;
  plan?: Plan;
  explanation: string;
  validation: ValidationResult;
  rawLLMOutput?: string;
  error?: string;
}
