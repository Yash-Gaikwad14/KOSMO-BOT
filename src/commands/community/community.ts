import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ChannelType,
} from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('community')
  .setDescription('Kosmo Community information and help commands')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('info')
      .setDescription('Display basic information about this community server')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('channels')
      .setDescription('List channels available in this community server')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('roles')
      .setDescription('List roles available in this community server')
  );

/**
 * Helper to safely format a list of items with length truncation.
 * Ensures the formatted string does not exceed maxLength (default 1000 for embed field limits).
 */
export function formatItemList(items: string[], maxLength: number = 1000): string {
  if (!items || items.length === 0) {
    return 'None';
  }

  let formatted = '';
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const separator = i === 0 ? '' : ', ';
    const remainingCount = items.length - i;
    const overflowNote = ` (+${remainingCount} more)`;

    if (formatted.length + separator.length + item.length + overflowNote.length > maxLength) {
      formatted += (formatted.length > 0 ? ', ' : '') + `(+${remainingCount} more)`;
      return formatted;
    }

    formatted += separator + item;
  }

  return formatted;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  // 1. Must be executed in a guild
  const guild = interaction.guild;
  if (!guild) {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: 'Command must be used in a guild.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'Command must be used in a guild.', ephemeral: true });
    }
    return;
  }

  try {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'info': {
        const ownerDisplay = guild.ownerId ? `<@${guild.ownerId}>` : 'Unknown';
        const memberCount =
          typeof guild.memberCount === 'number'
            ? guild.memberCount.toLocaleString()
            : 'Unknown';
        const roleCount = guild.roles?.cache
          ? guild.roles.cache.size.toLocaleString()
          : '0';
        const channelCount = guild.channels?.cache
          ? guild.channels.cache.size.toLocaleString()
          : '0';

        const embed = new EmbedBuilder()
          .setTitle(`Community Information — ${guild.name}`)
          .setColor(0x3498db)
          .addFields(
            { name: 'Server Name', value: guild.name, inline: true },
            { name: 'Server ID', value: guild.id, inline: true },
            { name: 'Server Owner', value: ownerDisplay, inline: true },
            { name: 'Members', value: memberCount, inline: true },
            { name: 'Roles', value: roleCount, inline: true },
            { name: 'Channels', value: channelCount, inline: true }
          )
          .setTimestamp();

        if (typeof guild.iconURL === 'function') {
          const icon = guild.iconURL();
          if (icon) embed.setThumbnail(icon);
        }

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ embeds: [embed] });
        } else {
          await interaction.reply({ embeds: [embed] });
        }
        break;
      }

      case 'channels': {
        const channels = guild.channels?.cache
          ? Array.from(guild.channels.cache.values())
          : [];

        const categories: string[] = [];
        const textChannels: string[] = [];
        const voiceChannels: string[] = [];
        const otherChannels: string[] = [];

        for (const channel of channels) {
          if (!channel) continue;

          // Category channels
          if (channel.type === ChannelType.GuildCategory) {
            categories.push(channel.name || 'Unnamed Category');
          }
          // Text & Announcement channels
          else if (
            channel.type === ChannelType.GuildText ||
            channel.type === ChannelType.GuildAnnouncement
          ) {
            textChannels.push(`<#${channel.id}>`);
          }
          // Voice & Stage channels
          else if (
            channel.type === ChannelType.GuildVoice ||
            channel.type === ChannelType.GuildStageVoice
          ) {
            voiceChannels.push(`<#${channel.id}>`);
          }
          // Other supported channels (Forums, Threads, etc.)
          else {
            otherChannels.push(channel.name ? `<#${channel.id}>` : channel.id);
          }
        }

        const embed = new EmbedBuilder()
          .setTitle(`Community Channels — ${guild.name}`)
          .setColor(0x3498db)
          .setDescription(`Total channels: **${channels.length}**`)
          .addFields(
            {
              name: `📁 Categories (${categories.length})`,
              value: formatItemList(categories),
              inline: false,
            },
            {
              name: `💬 Text Channels (${textChannels.length})`,
              value: formatItemList(textChannels),
              inline: false,
            },
            {
              name: `🔊 Voice Channels (${voiceChannels.length})`,
              value: formatItemList(voiceChannels),
              inline: false,
            }
          )
          .setTimestamp();

        if (otherChannels.length > 0) {
          embed.addFields({
            name: `📌 Other Channels (${otherChannels.length})`,
            value: formatItemList(otherChannels),
            inline: false,
          });
        }

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ embeds: [embed] });
        } else {
          await interaction.reply({ embeds: [embed] });
        }
        break;
      }

      case 'roles': {
        const allRoles = guild.roles?.cache
          ? Array.from(guild.roles.cache.values())
          : [];

        // Exclude @everyone as a normal community role and sort descending by position
        const communityRoles = allRoles
          .filter((r) => r && r.id !== guild.id && r.name !== '@everyone')
          .sort((a, b) => (b.position ?? 0) - (a.position ?? 0));

        const roleNames = communityRoles.map((r) => r.name);
        const formattedRoles =
          communityRoles.length > 0
            ? formatItemList(roleNames)
            : 'No community roles found';

        const embed = new EmbedBuilder()
          .setTitle(`Community Roles — ${guild.name}`)
          .setColor(0x3498db)
          .setDescription(`Total community roles: **${communityRoles.length}**`)
          .addFields({
            name: `Roles (${communityRoles.length})`,
            value: formattedRoles,
            inline: false,
          })
          .setTimestamp();

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ embeds: [embed] });
        } else {
          await interaction.reply({ embeds: [embed] });
        }
        break;
      }

      default: {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({
            content: `Unknown subcommand: ${subcommand}`,
            ephemeral: true,
          });
        } else {
          await interaction.reply({
            content: `Unknown subcommand: ${subcommand}`,
            ephemeral: true,
          });
        }
        break;
      }
    }
  } catch (error: any) {
    const errorMessage = error?.message || 'An unexpected error occurred.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: `❌ Error: ${errorMessage}`, ephemeral: true });
    } else {
      await interaction.reply({ content: `❌ Error: ${errorMessage}`, ephemeral: true });
    }
  }
}

export default execute;
