// src/commands/premium/premium.ts

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
} from 'discord.js';
import { authorize, Category, extractUserRoleIds } from '../../services/discord/policy';
import { premiumSyncService, PREMIUM_ROLE_NAMES } from '../../services/payments/premiumService';
import { getPremiumEntitlementProvider } from '../../services/payments/entitlementProvider';
import type { PremiumEntitlement } from '../../types/premium';

export const data = new SlashCommandBuilder()
  .setName('premium')
  .setDescription('Manage and synchronize member premium role entitlements')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('sync')
      .setDescription('Synchronize a member’s Discord roles with their authoritative entitlement')
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('The member whose premium roles to synchronize')
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('status')
      .setDescription('Inspect a member’s current entitlement and Discord premium roles')
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('The member whose status to inspect')
          .setRequired(true)
      )
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({
      content: '❌ This command must be executed within a Discord server.',
      ephemeral: true,
    });
    return;
  }

  // 1. Centralized Policy Authorization: Requires Founder or Team Kosmo (MANAGE category)
  const callerRoles = extractUserRoleIds(interaction.member);
  const authDecision = authorize(callerRoles, Category.MANAGE, {
    userId: interaction.user.id,
    guildOwnerId: guild.ownerId,
  });

  if (authDecision !== 'ALLOW') {
    await interaction.reply({
      content: '❌ You are not authorized to use premium synchronization commands.',
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand(false);

  if (subcommand === 'sync') {
    return handleSync(interaction);
  }

  if (subcommand === 'status') {
    return handleStatus(interaction);
  }

  await interaction.reply({
    content: '❌ Unknown subcommand.',
    ephemeral: true,
  });
}

/**
 * Handles /premium sync user:<target>
 */
async function handleSync(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const targetUser = interaction.options.getUser('user', true);

  await interaction.deferReply({ ephemeral: true });

  const result = await premiumSyncService.syncMemberPremium(guild, targetUser.id, {
    callerTag: interaction.user.tag || interaction.user.username,
    callerId: interaction.user.id,
  });

  const embed = new EmbedBuilder().setTimestamp();

  if (result.status === 'SUCCESS') {
    embed
      .setTitle('💎 Premium Roles Synchronized')
      .setColor(0x57f287)
      .setDescription(`Successfully updated premium roles for <@${targetUser.id}>.`)
      .addFields(
        { name: 'Entitled Tier', value: `\`${result.entitledTier}${result.entitledVip ? ' + VIP' : ''}\``, inline: true },
        { name: 'Status', value: '`SUCCESS`', inline: true },
        {
          name: 'Mutations Applied',
          value:
            result.mutations
              .map((m) => `${m.action === 'ADD' ? '➕ Added' : '➖ Removed'} \`${m.roleName}\``)
              .join('\n') || 'None',
          inline: false,
        }
      )
      .setFooter({ text: 'Authoritative Entitlement Synchronized' });
  } else if (result.status === 'NO_CHANGE') {
    embed
      .setTitle('💎 Premium Roles Already In Sync')
      .setColor(0x3498db)
      .setDescription(`No role mutations were needed for <@${targetUser.id}>. Role state matches entitlement.`)
      .addFields(
        { name: 'Current Tier', value: `\`${result.currentTier}${result.hasVip ? ' + VIP' : ''}\``, inline: true },
        { name: 'Status', value: '`NO_CHANGE (IDEMPOTENT)`', inline: true }
      )
      .setFooter({ text: 'Already Up To Date' });
  } else if (result.status === 'BLOCKED_ROLE_HIERARCHY') {
    embed
      .setTitle('⚠️ Synchronization Blocked — Role Hierarchy')
      .setColor(0xed4245)
      .setDescription(result.error || 'The bot cannot manage the requested premium role due to role hierarchy.')
      .addFields({ name: 'Target', value: `<@${targetUser.id}>`, inline: true })
      .setFooter({ text: 'Role Hierarchy Guard' });
  } else {
    // SYNC_FAILED
    embed
      .setTitle('❌ Premium Synchronization Failed')
      .setColor(0xed4245)
      .setDescription(result.error || 'An unexpected error occurred during synchronization.')
      .addFields({ name: 'Target', value: `<@${targetUser.id}>`, inline: true })
      .setFooter({ text: 'Fail-Safe Mode: No roles were modified' });
  }

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Handles /premium status user:<target>
 */
async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const targetUser = interaction.options.getUser('user', true);

  await interaction.deferReply({ ephemeral: true });

  let member: GuildMember | null = null;
  try {
    member = await guild.members.fetch(targetUser.id);
  } catch {
    member = null;
  }

  if (!member) {
    await interaction.editReply({ content: '❌ Target member could not be found in this server.' });
    return;
  }

  const provider = getPremiumEntitlementProvider();
  let entitlement: PremiumEntitlement | null = null;
  let sourceError: string | null = null;

  try {
    entitlement = await provider.getEntitlement(targetUser.id);
  } catch (err: unknown) {
    sourceError = err instanceof Error ? err.message : 'Failed to query entitlement provider';
  }

  const memberRoles = member.roles.cache;
  const hasMax = memberRoles.some((r) => r.name.toLowerCase() === PREMIUM_ROLE_NAMES.MAX.toLowerCase());
  const hasPro = memberRoles.some((r) => r.name.toLowerCase() === PREMIUM_ROLE_NAMES.PRO.toLowerCase());
  const hasVip = memberRoles.some((r) => r.name.toLowerCase() === PREMIUM_ROLE_NAMES.VIP.toLowerCase());

  const activeDiscordRoles: string[] = [];
  if (hasMax) activeDiscordRoles.push('Kosmo Max');
  if (hasPro) activeDiscordRoles.push('Kosmo Pro');
  if (hasVip) activeDiscordRoles.push('Kosmo VIP');

  const embed = new EmbedBuilder()
    .setTitle(`💎 Premium Entitlement Status — ${member.user.tag}`)
    .setColor(0x3498db)
    .addFields(
      {
        name: 'Target Member',
        value: `${member.user.tag} (<@${member.id}>)`,
        inline: false,
      },
      {
        name: 'Discord Roles Present',
        value: activeDiscordRoles.length > 0 ? activeDiscordRoles.map((r) => `\`${r}\``).join(', ') : 'None',
        inline: true,
      }
    )
    .setTimestamp();

  if (sourceError) {
    embed.addFields(
      { name: 'Authoritative Entitlement', value: '`PROVIDER_UNAVAILABLE`', inline: true },
      { name: 'Provider Error', value: `\`${sourceError}\``, inline: false }
    );
  } else if (entitlement) {
    embed.addFields(
      { name: 'Entitled Paid Tier', value: `\`${entitlement.tier}\``, inline: true },
      { name: 'Entitled VIP', value: `\`${entitlement.isVip || entitlement.tier === 'VIP' ? 'YES' : 'NO'}\``, inline: true },
      { name: 'Entitlement Status', value: `\`${entitlement.status}\``, inline: true },
      { name: 'Source', value: `\`${entitlement.source}\``, inline: true }
    );

    if (entitlement.expiresAt) {
      embed.addFields({
        name: 'Expires At',
        value: `<t:${Math.floor(new Date(entitlement.expiresAt).getTime() / 1000)}:R>`,
        inline: true,
      });
    }
  }

  await interaction.editReply({ embeds: [embed] });
}

export default execute;
