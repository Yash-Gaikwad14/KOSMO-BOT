import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
} from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('member')
  .setDescription('Inspect a Discord member and view their profile details')
  .addUserOption((option) =>
    option
      .setName('user')
      .setDescription('The member to inspect')
      .setRequired(true)
  );

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

  // 2. Resolve selected user
  const user = interaction.options.getUser('user', true);

  // 3. Resolve GuildMember
  let member = interaction.options.getMember('user') as GuildMember | null;

  if (!member) {
    try {
      member = await guild.members.fetch(user.id);
    } catch {
      member = null;
    }
  }

  if (!member) {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: 'Member could not be found in this server.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'Member could not be found in this server.', ephemeral: true });
    }
    return;
  }

  // 4. Format Member Information
  const displayName = member.displayName || user.displayName || user.username;
  const username = user.username;
  const memberType = user.bot ? 'Bot' : 'User';

  const createdTimestamp =
    user.createdTimestamp ?? (user.createdAt ? user.createdAt.getTime() : null);
  const createdStr = createdTimestamp
    ? `<t:${Math.floor(createdTimestamp / 1000)}:F>`
    : 'Unknown';

  const joinedTimestamp =
    member.joinedTimestamp ?? (member.joinedAt ? member.joinedAt.getTime() : null);
  const joinedStr = joinedTimestamp
    ? `<t:${Math.floor(joinedTimestamp / 1000)}:F>`
    : 'Unknown';

  // Format Roles
  let rolesFormatted = 'No additional roles';
  if (member.roles && member.roles.cache) {
    const rolesList = Array.from(member.roles.cache.values())
      .filter((r: any) => r.id !== guild.id && r.name !== '@everyone')
      .sort((a: any, b: any) => (b.position ?? 0) - (a.position ?? 0));

    if (rolesList.length > 0) {
      const names = rolesList.map((r: any) => r.name).join(', ');
      rolesFormatted = names.length > 1024 ? `${names.substring(0, 1020)}...` : names;
    }
  }

  const highestRoleName = member.roles?.highest?.name || 'None';

  // Format Timeout Status
  let timeoutStr = 'None';
  const disabledUntil = member.communicationDisabledUntil;
  const isTimedOut = typeof member.isCommunicationDisabled === 'function'
    ? member.isCommunicationDisabled()
    : Boolean(disabledUntil && disabledUntil.getTime() > Date.now());

  if (isTimedOut && disabledUntil) {
    const untilSeconds = Math.floor(disabledUntil.getTime() / 1000);
    timeoutStr = `Active until <t:${untilSeconds}:F> (<t:${untilSeconds}:R>)`;
  } else if (isTimedOut) {
    timeoutStr = 'Active';
  }

  // 5. Build Embed
  const embed = new EmbedBuilder()
    .setTitle('Member Inspection')
    .setColor(0x3498db)
    .addFields(
      { name: 'Member', value: `${displayName} (${username})`, inline: true },
      { name: 'User ID', value: user.id, inline: true },
      { name: 'Type', value: memberType, inline: true },
      { name: 'Account Created', value: createdStr, inline: true },
      { name: 'Joined Server', value: joinedStr, inline: true },
      { name: 'Highest Role', value: highestRoleName, inline: true },
      { name: 'Roles', value: rolesFormatted, inline: false },
      { name: 'Timeout', value: timeoutStr, inline: true }
    )
    .setTimestamp();

  if (typeof user.displayAvatarURL === 'function') {
    embed.setThumbnail(user.displayAvatarURL());
  }

  // 6. Deliver Response (Read-Only)
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ embeds: [embed] });
  } else {
    await interaction.reply({ embeds: [embed] });
  }
}

export default execute;
