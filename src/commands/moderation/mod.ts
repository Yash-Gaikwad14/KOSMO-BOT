import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
} from 'discord.js';
import { handleWarn } from './handlers/warnHandler';
import { handleStrike } from './handlers/strikeHandler';
import { handleHistory, handleCase } from './handlers/historyHandler';
import { handleTimeout } from './handlers/timeoutHandler';
import { handleKickProposal } from './handlers/kickHandler';
import { handleBanProposal } from './handlers/banHandler';
import { handlePurgeProposal, MAX_PURGE_AMOUNT } from './handlers/purgeHandler';
import { handleModerationButton } from './handlers/buttonHandler';

export { MAX_PURGE_AMOUNT, handleModerationButton };

export const data = new SlashCommandBuilder()
  .setName('mod')
  .setDescription('Staff moderation commands for Kosmo Community')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('timeout')
      .setDescription('Timeout a server member for a specified duration')
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('The member to timeout')
          .setRequired(true)
      )
      .addIntegerOption((option) =>
        option
          .setName('duration')
          .setDescription('Duration of timeout in minutes (1 - 10080)')
          .setMinValue(1)
          .setMaxValue(10080)
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName('reason')
          .setDescription('Reason for timeout')
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('kick')
      .setDescription('Kick a member from the server (requires interactive confirmation)')
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('The member to kick')
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName('reason')
          .setDescription('Reason for kick (max 512 characters)')
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('ban')
      .setDescription('Ban a member from the server (requires interactive confirmation)')
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('The member to ban')
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName('reason')
          .setDescription('Reason for ban (max 512 characters)')
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('purge')
      .setDescription('Bulk delete recent messages in the current channel (requires interactive confirmation)')
      .addIntegerOption((option) =>
        option
          .setName('amount')
          .setDescription('Number of messages to delete (1-100)')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(100)
      )
      .addStringOption((option) =>
        option
          .setName('reason')
          .setDescription('Reason for message purge (max 512 characters)')
          .setRequired(true)
          .setMaxLength(512)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('warn')
      .setDescription('Issue a formal warning to a member')
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('The member to warn')
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName('reason')
          .setDescription('Reason for warning (max 512 characters)')
          .setRequired(true)
          .setMaxLength(512)
      )
      .addStringOption((option) =>
        option
          .setName('evidence')
          .setDescription('Optional evidence reference (link, message ID, note)')
          .setRequired(false)
          .setMaxLength(512)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('strike')
      .setDescription('Issue an infraction strike and calculate policy escalation')
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('The member to strike')
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName('reason')
          .setDescription('Reason for strike (max 512 characters)')
          .setRequired(true)
          .setMaxLength(512)
      )
      .addStringOption((option) =>
        option
          .setName('evidence')
          .setDescription('Optional evidence reference (link, message ID, note)')
          .setRequired(false)
          .setMaxLength(512)
      )
      .addStringOption((option) =>
        option
          .setName('severity')
          .setDescription('Severity tier')
          .setRequired(false)
          .addChoices(
            { name: 'Low', value: 'LOW' },
            { name: 'Medium', value: 'MEDIUM' },
            { name: 'High', value: 'HIGH' }
          )
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('history')
      .setDescription('View moderation history and active strikes for a member')
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('The member whose history to view')
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('case')
      .setDescription('Look up full details for a moderation Case ID')
      .addStringOption((option) =>
        option
          .setName('case_id')
          .setDescription('Case ID to inspect (e.g. CASE-20260905-XXXX)')
          .setRequired(true)
      )
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand(false);

  if (subcommand === 'warn') {
    return handleWarn(interaction);
  }

  if (subcommand === 'strike') {
    return handleStrike(interaction);
  }

  if (subcommand === 'history') {
    return handleHistory(interaction);
  }

  if (subcommand === 'case') {
    return handleCase(interaction);
  }

  if (subcommand === 'kick') {
    return handleKickProposal(interaction);
  }

  if (subcommand === 'ban') {
    return handleBanProposal(interaction);
  }

  if (subcommand === 'purge') {
    return handlePurgeProposal(interaction);
  }

  // Default to timeout handler (preserves Phase 4D.1 behavior)
  return handleTimeout(interaction);
}

export default execute;
