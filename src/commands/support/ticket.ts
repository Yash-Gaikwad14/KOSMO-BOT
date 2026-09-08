// src/commands/support/ticket.ts

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import {
  isTicketChannel,
  inspectTicket,
  auditTicketPrivacy,
  routeTicket,
  logTicketAudit,
} from '../../services/support/ticketService';
import {
  extractUserRoleIds,
  getAuthLevel,
  AuthLevel,
} from '../../services/discord/policy';
import { TicketRouteDestination } from '../../types/ticket';

export const data = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Staff support ticket workflows, routing, and privacy inspection')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName('inspect')
      .setDescription('Inspect ticket metadata and privacy status without leaking content')
  )
  .addSubcommand((sub) =>
    sub
      .setName('verify-privacy')
      .setDescription('Audit permission overwrites on this ticket to verify privacy integrity')
  )
  .addSubcommand((sub) =>
    sub
      .setName('route')
      .setDescription('Route this ticket to an approved support category')
      .addStringOption((opt) =>
        opt
          .setName('destination')
          .setDescription('Destination support category')
          .setRequired(true)
          .addChoices(
            { name: 'Active Tickets (Dynamic)', value: 'ACTIVE_TICKETS' },
            { name: 'Feedback & Support (General)', value: 'FEEDBACK_AND_SUPPORT' },
            { name: 'Priority Support (Pro/Max)', value: 'PRIORITY_SUPPORT' }
          )
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('close')
      .setDescription('Guidance and orchestration for ticket closure via Ticket Tool')
  );

export default async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({
      content: '❌ This command can only be used in a Discord server.',
      ephemeral: true,
    });
    return;
  }

  // 1. Authorization: Only Staff (Owner, Founder, Team Kosmo, Admin, Moderator)
  const callerRoles = extractUserRoleIds(interaction.member);
  const authLevel = getAuthLevel(callerRoles, {
    userId: interaction.user.id,
    guildOwnerId: guild.ownerId,
  });

  const isStaff =
    authLevel === AuthLevel.OWNER ||
    authLevel === AuthLevel.FOUNDER ||
    authLevel === AuthLevel.TEAM_KOSMO ||
    authLevel === AuthLevel.ADMIN ||
    authLevel === AuthLevel.MODERATOR;

  if (!isStaff) {
    const unauthorizedEmbed = new EmbedBuilder()
      .setTitle('❌ Unauthorized')
      .setColor(0xed4245)
      .setDescription('You do not have permission to use staff ticket commands.')
      .setFooter({ text: 'Access restricted to Kosmo Staff and Moderators.' })
      .setTimestamp();

    await interaction.reply({ embeds: [unauthorizedEmbed], ephemeral: true });
    return;
  }

  // 2. Channel context check: Must be an active ticket channel
  const channel = interaction.channel;
  if (!isTicketChannel(channel)) {
    const invalidChannelEmbed = new EmbedBuilder()
      .setTitle('❌ Invalid Channel')
      .setColor(0xe67e22)
      .setDescription(
        'This command can only be executed inside an active support ticket channel (e.g. `#ticket-username` or channels under `ACTIVE TICKETS`).'
      )
      .setTimestamp();

    await interaction.reply({ embeds: [invalidChannelEmbed], ephemeral: true });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  // 3. Subcommand execution
  if (subcommand === 'inspect') {
    const metadata = inspectTicket(guild, channel);

    const privacyBadge = metadata.isPrivate ? '🔒 Private' : '⚠️ Privacy Issue Detected';
    const embedColor = metadata.isPrivate ? 0x2ecc71 : 0xe74c3c;

    const embed = new EmbedBuilder()
      .setTitle(`🎫 Ticket Inspection — #${metadata.channelName}`)
      .setColor(embedColor)
      .addFields(
        { name: 'Channel ID', value: `\`${metadata.channelId}\``, inline: true },
        { name: 'Category', value: metadata.categoryName ?? 'None', inline: true },
        { name: 'Privacy Status', value: privacyBadge, inline: true },
        {
          name: 'Creator Access',
          value: metadata.creatorId ? `<@${metadata.creatorId}> (\`${metadata.creatorId}\`)` : 'Not Detected',
          inline: true,
        },
        {
          name: 'Staff Access',
          value: metadata.privacyReport.staffHasAccess ? '✅ Preserved' : '⚠️ Missing',
          inline: true,
        },
        {
          name: 'Created At',
          value: metadata.createdAt ? `<t:${Math.floor(metadata.createdAt.getTime() / 1000)}:R>` : 'Unknown',
          inline: true,
        }
      )
      .setFooter({ text: 'Strict Privacy: Message content is never logged or exposed.' })
      .setTimestamp();

    if (metadata.privacyReport.issues.length > 0) {
      embed.addFields({
        name: '🚨 Issues',
        value: metadata.privacyReport.issues.map((i) => `• ${i}`).join('\n'),
        inline: false,
      });
    }

    if (metadata.privacyReport.warnings.length > 0) {
      embed.addFields({
        name: '⚠️ Warnings',
        value: metadata.privacyReport.warnings.map((w) => `• ${w}`).join('\n'),
        inline: false,
      });
    }

    await logTicketAudit(guild, {
      guildId: guild.id,
      channelId: (channel as any).id,
      channelName: (channel as any).name || 'unknown',
      actorId: interaction.user.id,
      actorTag: interaction.user.tag,
      action: 'TICKET_INSPECT',
      status: 'SUCCESS',
      timestamp: new Date(),
    });

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (subcommand === 'verify-privacy') {
    const report = auditTicketPrivacy(guild, channel);

    const embedColor = report.isPrivate ? 0x2ecc71 : 0xed4245;
    const title = report.isPrivate ? '🔒 Ticket Privacy Integrity: Verified' : '🚨 Ticket Privacy Integrity: Compromised';

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(embedColor)
      .setDescription(
        report.isPrivate
          ? 'All privacy checks passed. `@everyone` is denied access and staff access is configured.'
          : 'One or more privacy checks failed. Review issues below immediately!'
      )
      .addFields(
        {
          name: '@everyone Denied',
          value: report.everyoneDeniesView ? '✅ Yes' : '❌ No (Exposed)',
          inline: true,
        },
        {
          name: 'Staff Access Granted',
          value: report.staffHasAccess ? '✅ Yes' : '⚠️ Warning',
          inline: true,
        },
        {
          name: 'Creator Access Granted',
          value: report.creatorHasAccess ? '✅ Yes' : '⚠️ Not detected',
          inline: true,
        }
      )
      .setFooter({ text: 'Audit strictly examines permission overwrites only.' })
      .setTimestamp();

    if (report.issues.length > 0) {
      embed.addFields({
        name: 'Issues',
        value: report.issues.map((i) => `• ${i}`).join('\n'),
        inline: false,
      });
    }

    if (report.warnings.length > 0) {
      embed.addFields({
        name: 'Warnings',
        value: report.warnings.map((w) => `• ${w}`).join('\n'),
        inline: false,
      });
    }

    await logTicketAudit(guild, {
      guildId: guild.id,
      channelId: (channel as any).id,
      channelName: (channel as any).name || 'unknown',
      actorId: interaction.user.id,
      actorTag: interaction.user.tag,
      action: 'TICKET_VERIFY_PRIVACY',
      status: report.isPrivate ? 'SUCCESS' : 'FAILED',
      timestamp: new Date(),
    });

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (subcommand === 'route') {
    const destination = interaction.options.getString('destination', true) as TicketRouteDestination;

    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await routeTicket(guild, channel, destination, interaction.user.id);

      await logTicketAudit(guild, {
        guildId: guild.id,
        channelId: (channel as any).id,
        channelName: (channel as any).name || 'unknown',
        actorId: interaction.user.id,
        actorTag: interaction.user.tag,
        action: 'TICKET_ROUTE',
        destinationCategory: result.newCategoryName,
        details: result.message,
        status: 'SUCCESS',
        timestamp: new Date(),
      });

      const successEmbed = new EmbedBuilder()
        .setTitle('✅ Ticket Routed')
        .setColor(0x2ecc71)
        .setDescription(result.message)
        .addFields({ name: 'New Category', value: result.newCategoryName, inline: true })
        .setFooter({ text: 'Channel permission overwrites preserved during route.' })
        .setTimestamp();

      await interaction.editReply({ embeds: [successEmbed] });
    } catch (err: any) {
      await logTicketAudit(guild, {
        guildId: guild.id,
        channelId: (channel as any).id,
        channelName: (channel as any).name || 'unknown',
        actorId: interaction.user.id,
        actorTag: interaction.user.tag,
        action: 'TICKET_ROUTE',
        destinationCategory: destination,
        details: err?.message || String(err),
        status: 'FAILED',
        timestamp: new Date(),
      });

      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Routing Failed')
        .setColor(0xed4245)
        .setDescription(err?.message || 'Failed to route ticket category.')
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed] });
    }
    return;
  }

  if (subcommand === 'close') {
    // Ticket Tool owns closure/deletion. KOSMO-BOT reports that Ticket Tool remains authoritative.
    const closeEmbed = new EmbedBuilder()
      .setTitle('🔒 Ticket Tool Closure Authority')
      .setColor(0x3498db)
      .setDescription(
        '**Ticket Tool is the authoritative lifecycle owner for tickets.**\n\nTo safely close or delete this ticket while preserving transcripts and maintaining lifecycle consistency, please use **Ticket Tool\'s native Close button** located on the initial ticket embed at the top of this channel.\n\n*KOSMO-BOT deliberately does not delete or alter external ticket lifecycles to avoid creating competing ticket ledgers.*'
      )
      .setFooter({ text: 'Ticket Tool external bot boundary preserved.' })
      .setTimestamp();

    await logTicketAudit(guild, {
      guildId: guild.id,
      channelId: (channel as any).id,
      channelName: (channel as any).name || 'unknown',
      actorId: interaction.user.id,
      actorTag: interaction.user.tag,
      action: 'TICKET_CLOSE_REQUEST',
      details: 'Staff requested ticket close; directed to Ticket Tool native close panel.',
      status: 'INFO',
      timestamp: new Date(),
    });

    await interaction.reply({ embeds: [closeEmbed], ephemeral: true });
    return;
  }
}
