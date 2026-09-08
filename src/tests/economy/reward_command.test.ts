import path from 'path';
import { Collection, GuildMember, ChannelType } from 'discord.js';
import execute, { data, handleRewardButton } from '../../commands/economy/reward';
import { loadCommands } from '../../commands/loader';
import {
  _resetModConfirmationStore,
  getPendingModAction,
} from '../../services/discord/modConfirmation';
import { IUnbelievaBoatClient } from '../../services/economy/unbelievaboatClient';

describe('/reward sparks — Command & Confirmation Integration Tests', () => {
  const FOUNDER_ROLE_ID = '1544750811207442532';
  const TEAM_KOSMO_ROLE_ID = '1544801399068434443';
  const MODERATOR_ROLE_ID = '1544801402247712868';
  const ADMIN_ROLE_ID = '1544801401000000000';
  const COMMUNITY_ROLE_ID = '1544801403000000000';

  function createMockInteraction(options: {
    guildId?: string | null;
    userId?: string;
    username?: string;
    roles?: string[];
    subcommand?: string;
    amount?: any;
    reason?: any;
    channels?: any[];
  }) {
    let replyPayload: any = null;
    let editReplyPayload: any = null;

    const roleMap = new Collection<string, any>();
    (options.roles || []).forEach((r) => roleMap.set(r, { id: r, name: r }));

    const channelsMap = new Collection<string, any>();
    (options.channels || []).forEach((c) => channelsMap.set(c.id, c));

    const guild =
      options.guildId === null
        ? null
        : {
            id: options.guildId || 'guild-123',
            name: 'KOSMO Guild',
            channels: { cache: channelsMap },
          };

    const interaction: any = {
      guild,
      guildId: guild ? guild.id : null,
      user: {
        id: options.userId || 'user-founder-1',
        username: options.username || 'FounderUser',
        tag: `${options.username || 'FounderUser'}#0001`,
      },
      member: {
        roles: {
          cache: roleMap,
        },
      },
      options: {
        getSubcommand: jest.fn().mockReturnValue(options.subcommand || 'sparks'),
        getInteger: jest.fn().mockImplementation((name: string) => {
          if (name === 'amount') return options.amount !== undefined ? options.amount : 5000;
          return null;
        }),
        getString: jest.fn().mockImplementation((name: string) => {
          if (name === 'reason') return options.reason !== undefined ? options.reason : 'Operational budget grant';
          return null;
        }),
      },
      replied: false,
      deferred: false,
      reply: jest.fn().mockImplementation(async (payload) => {
        replyPayload = payload;
        interaction.replied = true;
      }),
      editReply: jest.fn().mockImplementation(async (payload) => {
        editReplyPayload = payload;
      }),
      getReplyData: () => replyPayload,
      getEditReplyData: () => editReplyPayload,
    };

    return interaction;
  }

  function createMockButtonInteraction(options: {
    customId: string;
    guildId?: string | null;
    userId?: string;
    username?: string;
    roles?: string[];
    channels?: any[];
  }) {
    let replyPayload: any = null;
    let updatePayload: any = null;
    let editReplyPayload: any = null;

    const roleMap = new Collection<string, any>();
    (options.roles || []).forEach((r) => roleMap.set(r, { id: r, name: r }));

    const channelsMap = new Collection<string, any>();
    (options.channels || []).forEach((c) => channelsMap.set(c.id, c));

    const guild =
      options.guildId === null
        ? null
        : {
            id: options.guildId || 'guild-123',
            name: 'KOSMO Guild',
            channels: { cache: channelsMap },
          };

    const interaction: any = {
      customId: options.customId,
      guild,
      guildId: guild ? guild.id : null,
      user: {
        id: options.userId || 'user-founder-1',
        username: options.username || 'FounderUser',
        tag: `${options.username || 'FounderUser'}#0001`,
      },
      member: {
        roles: {
          cache: roleMap,
        },
      },
      replied: false,
      deferred: false,
      reply: jest.fn().mockImplementation(async (payload) => {
        replyPayload = payload;
        interaction.replied = true;
      }),
      update: jest.fn().mockImplementation(async (payload) => {
        updatePayload = payload;
        interaction.replied = true;
      }),
      deferUpdate: jest.fn().mockImplementation(async () => {
        interaction.deferred = true;
      }),
      editReply: jest.fn().mockImplementation(async (payload) => {
        editReplyPayload = payload;
      }),
      getReplyData: () => replyPayload,
      getUpdateData: () => updatePayload || editReplyPayload,
      getEditReplyData: () => editReplyPayload,
    };

    return interaction;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    _resetModConfirmationStore();
  });

  // =========================================================================
  // 1. COMMAND REGISTRATION & LOADER DISCOVERY (Requirements 6, 7)
  // =========================================================================
  describe('Command Registration & Structure', () => {
    test('registers as /reward with sparks subcommand and options', () => {
      expect(data.name).toBe('reward');
      expect(data.description).toBeDefined();

      const sparksSub = data.options.find((opt: any) => opt.name === 'sparks') as any;
      expect(sparksSub).toBeDefined();

      const amountOpt = sparksSub.options.find((o: any) => o.name === 'amount');
      const reasonOpt = sparksSub.options.find((o: any) => o.name === 'reason');

      expect(amountOpt?.required).toBe(true);
      expect(amountOpt?.min_value).toBe(1);
      expect(amountOpt?.max_value).toBe(5000);

      expect(reasonOpt?.required).toBe(true);
      expect(reasonOpt?.min_length).toBe(10);
      expect(reasonOpt?.max_length).toBe(500);

      // CRITICAL: Verify NO target/user/member/recipient argument exists!
      const userOpt = sparksSub.options.find((o: any) =>
        ['user', 'target', 'member', 'recipient'].includes(o.name)
      );
      expect(userOpt).toBeUndefined();
    });

    test('is discoverable by the commands loader', async () => {
      const commandsDir = path.resolve(__dirname, '../../commands');
      const commands = await loadCommands(commandsDir);
      expect(commands.has('reward')).toBe(true);
      const entry = commands.get('reward');
      expect(entry?.data.name).toBe('reward');
      expect(typeof entry?.default).toBe('function');
    });

    test('rejects execution outside a guild', async () => {
      const interaction = createMockInteraction({
        guildId: null,
        roles: [FOUNDER_ROLE_ID],
      });

      await execute(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('only be used within a server'),
          ephemeral: true,
        })
      );
    });
  });

  // =========================================================================
  // 2. AUTHORIZATION MATRIX (Requirements 1 - 5)
  // =========================================================================
  describe('Authorization Matrix', () => {
    test('1. Founder is allowed to execute /reward sparks', async () => {
      const interaction = createMockInteraction({ roles: [FOUNDER_ROLE_ID] });
      await execute(interaction);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
          ephemeral: true,
        })
      );
    });

    test('2. Team Kosmo is allowed to execute /reward sparks', async () => {
      const interaction = createMockInteraction({ roles: [TEAM_KOSMO_ROLE_ID] });
      await execute(interaction);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
          ephemeral: true,
        })
      );
    });

    test('3. Moderator is strictly DENIED', async () => {
      const interaction = createMockInteraction({ roles: [MODERATOR_ROLE_ID] });
      await execute(interaction);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Unauthorized'),
          ephemeral: true,
        })
      );
    });

    test('4. Generic Administrator is DENIED unless mapped to Founder/Team role', async () => {
      const interaction = createMockInteraction({ roles: [ADMIN_ROLE_ID] });
      await execute(interaction);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Unauthorized'),
          ephemeral: true,
        })
      );

      // Allowed when mapped to Founder
      const mappedInteraction = createMockInteraction({ roles: [ADMIN_ROLE_ID, FOUNDER_ROLE_ID] });
      await execute(mappedInteraction);
      expect(mappedInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          ephemeral: true,
        })
      );
    });

    test('5. Unauthorized community members are DENIED', async () => {
      const interaction = createMockInteraction({ roles: [COMMUNITY_ROLE_ID] });
      await execute(interaction);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Unauthorized'),
          ephemeral: true,
        })
      );
    });
  });

  // =========================================================================
  // 3. TARGET & RECIPIENT BINDING (Requirements 6 - 8)
  // =========================================================================
  describe('Target & Recipient Binding', () => {
    test('recipient is always the authenticated command actor (self-grant)', async () => {
      const actorId = 'user-founder-42';
      const interaction = createMockInteraction({
        userId: actorId,
        roles: [FOUNDER_ROLE_ID],
        amount: 2500,
        reason: 'Operational self grant test',
      });

      await execute(interaction);

      const reply = interaction.getReplyData();
      const embed = reply.embeds[0].data;
      expect(embed.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'Recipient',
            value: `Your own wallet (<@${actorId}>)`,
          }),
        ])
      );

      // Verify pending action in confirmation store is bound to actorId
      const actionRow = reply.components[0];
      const confirmButtonId = actionRow.components[0].data.custom_id;
      const actionId = confirmButtonId.replace('reward_sparks_confirm_', '');
      const stored = getPendingModAction(actionId);

      expect(stored).toBeDefined();
      expect(stored?.moderatorId).toBe(actorId);
      expect(stored?.targetId).toBe(actorId);
    });
  });

  // =========================================================================
  // 4. AMOUNT VALIDATION (Requirements 9 - 15)
  // =========================================================================
  describe('Amount Validation Guardrails', () => {
    test('9. Amount 1 is allowed', async () => {
      const interaction = createMockInteraction({ roles: [FOUNDER_ROLE_ID], amount: 1 });
      await execute(interaction);
      const reply = interaction.getReplyData();
      expect(reply.embeds[0].data.fields).toEqual(
        expect.arrayContaining([expect.objectContaining({ value: '**+1 Sparks**' })])
      );
    });

    test('10. Amount 5,000 is allowed', async () => {
      const interaction = createMockInteraction({ roles: [FOUNDER_ROLE_ID], amount: 5000 });
      await execute(interaction);
      const reply = interaction.getReplyData();
      expect(reply.embeds[0].data.fields).toEqual(
        expect.arrayContaining([expect.objectContaining({ value: '**+5,000 Sparks**' })])
      );
    });

    test('11. Amount 5,001 is rejected', async () => {
      const interaction = createMockInteraction({ roles: [FOUNDER_ROLE_ID], amount: 5001 });
      await execute(interaction);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('cannot exceed 5,000') })
      );
    });

    test('12. Amount 0 is rejected', async () => {
      const interaction = createMockInteraction({ roles: [FOUNDER_ROLE_ID], amount: 0 });
      await execute(interaction);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('at least 1 Spark') })
      );
    });

    test('13. Negative amount is rejected', async () => {
      const interaction = createMockInteraction({ roles: [FOUNDER_ROLE_ID], amount: -500 });
      await execute(interaction);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('at least 1 Spark') })
      );
    });

    test('14. Decimal amount is rejected', async () => {
      const interaction = createMockInteraction({ roles: [FOUNDER_ROLE_ID], amount: 100.5 });
      await execute(interaction);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('must be an integer') })
      );
    });

    test('15. Malformed / non-numeric amount is rejected', async () => {
      const interaction = createMockInteraction({ roles: [FOUNDER_ROLE_ID], amount: 'five-thousand' as any });
      await execute(interaction);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('valid finite number') })
      );
    });
  });

  // =========================================================================
  // 5. REASON VALIDATION (Requirements 16 - 19)
  // =========================================================================
  describe('Reason Validation Guardrails', () => {
    test('16. Valid reason is accepted', async () => {
      const interaction = createMockInteraction({
        roles: [FOUNDER_ROLE_ID],
        reason: 'Operational server maintenance compensation',
      });
      await execute(interaction);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) })
      );
    });

    test('17. Empty reason is rejected', async () => {
      const interaction = createMockInteraction({ roles: [FOUNDER_ROLE_ID], reason: '' });
      await execute(interaction);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('empty or whitespace-only') })
      );
    });

    test('18. Reason < 10 characters is rejected', async () => {
      const interaction = createMockInteraction({ roles: [FOUNDER_ROLE_ID], reason: 'Short' });
      await execute(interaction);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('at least 10 characters') })
      );
    });

    test('19. Reason > 500 characters is rejected', async () => {
      const interaction = createMockInteraction({
        roles: [FOUNDER_ROLE_ID],
        reason: 'A'.repeat(501),
      });
      await execute(interaction);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('cannot exceed 500 characters') })
      );
    });
  });

  // =========================================================================
  // 6. CONFIRMATION & IDEMPOTENCY (Requirements 20 - 28)
  // =========================================================================
  describe('Confirmation & Safety Pipeline', () => {
    test('20. Proposal creates pending action without executing UBB mutation', async () => {
      const mockUBBClient: IUnbelievaBoatClient = {
        grantSparks: jest.fn(),
        getUserBalance: jest.fn(),
        getGuildLeaderboard: jest.fn(),
      };

      const interaction = createMockInteraction({
        roles: [FOUNDER_ROLE_ID],
        amount: 3000,
        reason: 'Funding operational testing wallet',
      });

      await execute(interaction);

      expect(mockUBBClient.grantSparks).not.toHaveBeenCalled();

      const reply = interaction.getReplyData();
      expect(reply.components).toBeDefined();
      const confirmButton = reply.components[0].components[0].data;
      expect(confirmButton.label).toBe('Confirm');
      expect(confirmButton.custom_id).toMatch(/^reward_sparks_confirm_/);
    });

    test('21. Reject button click from non-initiator user', async () => {
      const interaction = createMockInteraction({
        userId: 'user-founder-1',
        roles: [FOUNDER_ROLE_ID],
      });
      await execute(interaction);

      const confirmButtonId = interaction.getReplyData().components[0].components[0].data.custom_id;

      // Another user attempts to click confirm
      const imposterClick = createMockButtonInteraction({
        customId: confirmButtonId,
        userId: 'user-imposter-99',
        roles: [FOUNDER_ROLE_ID],
      });

      await handleRewardButton(imposterClick);

      expect(imposterClick.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Only the staff member who initiated this grant can confirm it'),
          ephemeral: true,
        })
      );
    });

    test('22. Reject button click for wrong guild', async () => {
      const interaction = createMockInteraction({
        guildId: 'guild-original',
        userId: 'user-founder-1',
        roles: [FOUNDER_ROLE_ID],
      });
      await execute(interaction);

      const confirmButtonId = interaction.getReplyData().components[0].components[0].data.custom_id;

      const crossGuildClick = createMockButtonInteraction({
        customId: confirmButtonId,
        guildId: 'guild-different',
        userId: 'user-founder-1',
        roles: [FOUNDER_ROLE_ID],
      });

      await handleRewardButton(crossGuildClick);

      expect(crossGuildClick.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('does not belong to this server'),
          ephemeral: true,
        })
      );
    });

    test('23 & 24. Amount and reason remain immutable from initial proposal', async () => {
      const interaction = createMockInteraction({
        userId: 'user-founder-1',
        roles: [FOUNDER_ROLE_ID],
        amount: 4500,
        reason: 'Immutability test reason',
      });
      await execute(interaction);

      const confirmButtonId = interaction.getReplyData().components[0].components[0].data.custom_id;
      const actionId = confirmButtonId.replace('reward_sparks_confirm_', '');
      const stored = getPendingModAction(actionId);

      expect(stored?.amount).toBe(4500);
      expect(stored?.reason).toBe('Immutability test reason');
    });

    test('25. Expired confirmation (>5 minutes) is rejected', async () => {
      const interaction = createMockInteraction({
        userId: 'user-founder-1',
        roles: [FOUNDER_ROLE_ID],
      });
      await execute(interaction);

      const confirmButtonId = interaction.getReplyData().components[0].components[0].data.custom_id;
      const actionId = confirmButtonId.replace('reward_sparks_confirm_', '');
      const stored = getPendingModAction(actionId)!;

      // Force expiration
      stored.expiresAt = new Date(Date.now() - 1000);

      const expiredClick = createMockButtonInteraction({
        customId: confirmButtonId,
        userId: 'user-founder-1',
        roles: [FOUNDER_ROLE_ID],
      });

      await handleRewardButton(expiredClick);

      expect(expiredClick.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('expired'),
          ephemeral: true,
        })
      );
    });

    test('26 & 27. Replay & double execution are prevented (UBB called exactly once)', async () => {
      const mockUBBClient: IUnbelievaBoatClient = {
        grantSparks: jest.fn().mockResolvedValue({
          success: true,
          status: 200,
          data: { cash: 5000, total: 15000 },
        }),
        getUserBalance: jest.fn(),
        getGuildLeaderboard: jest.fn(),
      };

      const interaction = createMockInteraction({
        userId: 'user-founder-1',
        roles: [FOUNDER_ROLE_ID],
        amount: 5000,
        reason: 'Testing atomic double execution prevention',
      });
      await execute(interaction);

      const confirmButtonId = interaction.getReplyData().components[0].components[0].data.custom_id;

      const click1 = createMockButtonInteraction({
        customId: confirmButtonId,
        userId: 'user-founder-1',
        roles: [FOUNDER_ROLE_ID],
      });

      const click2 = createMockButtonInteraction({
        customId: confirmButtonId,
        userId: 'user-founder-1',
        roles: [FOUNDER_ROLE_ID],
      });

      // First click succeeds
      await handleRewardButton(click1, mockUBBClient);
      expect(mockUBBClient.grantSparks).toHaveBeenCalledTimes(1);

      // Second click is rejected
      await handleRewardButton(click2, mockUBBClient);
      expect(mockUBBClient.grantSparks).toHaveBeenCalledTimes(1); // STILL 1!
      expect(click2.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('cannot be confirmed again'),
          ephemeral: true,
        })
      );
    });

    test('28. Re-authorization occurs at execution (demoted staff member is aborted)', async () => {
      const mockUBBClient: IUnbelievaBoatClient = {
        grantSparks: jest.fn(),
        getUserBalance: jest.fn(),
        getGuildLeaderboard: jest.fn(),
      };

      const interaction = createMockInteraction({
        userId: 'user-founder-1',
        roles: [FOUNDER_ROLE_ID],
      });
      await execute(interaction);

      const confirmButtonId = interaction.getReplyData().components[0].components[0].data.custom_id;

      // Staff member was demoted (no longer has Founder or Team role)
      const demotedClick = createMockButtonInteraction({
        customId: confirmButtonId,
        userId: 'user-founder-1',
        roles: [COMMUNITY_ROLE_ID],
      });

      await handleRewardButton(demotedClick, mockUBBClient);

      expect(mockUBBClient.grantSparks).not.toHaveBeenCalled();
      const updateData = demotedClick.getUpdateData();
      expect(updateData.embeds[0].data.description).toContain('Unauthorized');
    });

    test('Cancel button transitions action to CANCELLED without UBB mutation', async () => {
      const mockUBBClient: IUnbelievaBoatClient = {
        grantSparks: jest.fn(),
        getUserBalance: jest.fn(),
        getGuildLeaderboard: jest.fn(),
      };

      const interaction = createMockInteraction({
        userId: 'user-founder-1',
        roles: [FOUNDER_ROLE_ID],
      });
      await execute(interaction);

      const cancelButtonId = interaction.getReplyData().components[0].components[1].data.custom_id;
      const cancelClick = createMockButtonInteraction({
        customId: cancelButtonId,
        userId: 'user-founder-1',
        roles: [FOUNDER_ROLE_ID],
      });

      await handleRewardButton(cancelClick, mockUBBClient);

      expect(mockUBBClient.grantSparks).not.toHaveBeenCalled();
      const updateData = cancelClick.getUpdateData();
      expect(updateData.embeds[0].data.title).toBe('🚫 Sparks Grant Cancelled');
    });
  });

  // =========================================================================
  // 7. EXECUTION & AUDIT LOGGING (Requirements 29 - 35)
  // =========================================================================
  describe('Execution & Audit Logging Verification', () => {
    test('29 - 33. Successful execution calls UBB with correct parameters and audits to #mod-logs', async () => {
      const sendAuditMock = jest.fn().mockResolvedValue({});
      const modLogsChan = {
        id: 'mod-logs-chan',
        name: 'mod-logs',
        type: ChannelType.GuildText,
        send: sendAuditMock,
      };

      const mockUBBClient: IUnbelievaBoatClient = {
        grantSparks: jest.fn().mockResolvedValue({
          success: true,
          status: 200,
          data: { cash: 9500, total: 25000 },
        }),
        getUserBalance: jest.fn(),
        getGuildLeaderboard: jest.fn(),
      };

      const interaction = createMockInteraction({
        guildId: 'guild-abc',
        userId: 'user-founder-7',
        roles: [FOUNDER_ROLE_ID],
        amount: 4000,
        reason: 'Legitimate operational Sparks allocation',
        channels: [modLogsChan],
      });

      await execute(interaction);

      const confirmButtonId = interaction.getReplyData().components[0].components[0].data.custom_id;
      const confirmClick = createMockButtonInteraction({
        customId: confirmButtonId,
        guildId: 'guild-abc',
        userId: 'user-founder-7',
        roles: [FOUNDER_ROLE_ID],
        channels: [modLogsChan],
      });

      await handleRewardButton(confirmClick, mockUBBClient);

      // 29. Correct guild ID
      // 30. Correct user ID (actor)
      // 31. Correct Sparks amount
      // 32. Correct reason
      expect(mockUBBClient.grantSparks).toHaveBeenCalledWith(
        'guild-abc',
        'user-founder-7',
        4000,
        'Legitimate operational Sparks allocation'
      );

      // 33. Successful response updates interaction
      const editReplyData = confirmClick.getEditReplyData();
      expect(editReplyData.embeds[0].data.title).toBe('✨ Sparks Added');
      expect(editReplyData.embeds[0].data.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Amount Added', value: '+4,000 Sparks' }),
          expect.objectContaining({ name: 'New Cash Balance', value: '9,500 Sparks' }),
          expect.objectContaining({ name: 'Total Balance', value: '25,000 Sparks' }),
        ])
      );

      // 35. Audit log generated in #mod-logs
      expect(sendAuditMock).toHaveBeenCalledTimes(1);
      const auditEmbed = sendAuditMock.mock.calls[0][0].embeds[0].data;
      expect(auditEmbed.title).toBe('✨ Staff Sparks Grant');
      expect(auditEmbed.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Action', value: '`STAFF_REWARD_SPARKS`' }),
          expect.objectContaining({ name: 'Result', value: '`SUCCESS`' }),
          expect.objectContaining({ name: 'Amount', value: '**+4,000 Sparks**' }),
        ])
      );
    });

    test('34. Provider failure is handled safely and logged to #mod-logs', async () => {
      const sendAuditMock = jest.fn().mockResolvedValue({});
      const modLogsChan = {
        id: 'mod-logs-chan',
        name: 'mod-logs',
        type: ChannelType.GuildText,
        send: sendAuditMock,
      };

      const mockUBBClient: IUnbelievaBoatClient = {
        grantSparks: jest.fn().mockResolvedValue({
          success: false,
          status: 500,
          error: 'UnbelievaBoat service unavailable',
        }),
        getUserBalance: jest.fn(),
        getGuildLeaderboard: jest.fn(),
      };

      const interaction = createMockInteraction({
        guildId: 'guild-abc',
        userId: 'user-founder-7',
        roles: [FOUNDER_ROLE_ID],
        amount: 2000,
        reason: 'Testing provider failure',
        channels: [modLogsChan],
      });

      await execute(interaction);

      const confirmButtonId = interaction.getReplyData().components[0].components[0].data.custom_id;
      const confirmClick = createMockButtonInteraction({
        customId: confirmButtonId,
        guildId: 'guild-abc',
        userId: 'user-founder-7',
        roles: [FOUNDER_ROLE_ID],
        channels: [modLogsChan],
      });

      await handleRewardButton(confirmClick, mockUBBClient);

      const editReplyData = confirmClick.getEditReplyData();
      expect(editReplyData.embeds[0].data.title).toBe('❌ Sparks Grant Failed');
      expect(editReplyData.embeds[0].data.description).toContain('UnbelievaBoat service unavailable');

      // Failure audit log sent
      expect(sendAuditMock).toHaveBeenCalledTimes(1);
      const auditEmbed = sendAuditMock.mock.calls[0][0].embeds[0].data;
      expect(auditEmbed.title).toBe('❌ Staff Sparks Grant Failed');
      expect(auditEmbed.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Result', value: '`FAILED`' }),
          expect.objectContaining({ name: 'Error Details', value: 'UnbelievaBoat service unavailable' }),
        ])
      );

      // Verify action is in FAILED terminal state
      const actionId = confirmButtonId.replace('reward_sparks_confirm_', '');
      const stored = getPendingModAction(actionId);
      expect(stored?.status).toBe('FAILED');
    });

    test('regression: UBB failure immediately after atomicConfirmModAction leaves action in FAILED terminal state and prevents retry', async () => {
      const mockUBBClient: IUnbelievaBoatClient = {
        grantSparks: jest.fn().mockRejectedValue(new Error('Network timeout talking to UnbelievaBoat')),
        getUserBalance: jest.fn(),
        getGuildLeaderboard: jest.fn(),
      };

      const interaction = createMockInteraction({
        userId: 'user-founder-fail',
        roles: [FOUNDER_ROLE_ID],
        amount: 3000,
        reason: 'Testing terminal state on execution failure',
      });

      await execute(interaction);

      const confirmButtonId = interaction.getReplyData().components[0].components[0].data.custom_id;
      const actionId = confirmButtonId.replace('reward_sparks_confirm_', '');

      // Verify initial state is PENDING
      const initialStored = getPendingModAction(actionId);
      expect(initialStored?.status).toBe('PENDING');

      // First click: triggers confirmation then provider failure
      const confirmClick = createMockButtonInteraction({
        customId: confirmButtonId,
        userId: 'user-founder-fail',
        roles: [FOUNDER_ROLE_ID],
      });

      await handleRewardButton(confirmClick, mockUBBClient);

      // Verify action is placed into safe terminal state 'FAILED'
      const failedStored = getPendingModAction(actionId);
      expect(failedStored).toBeDefined();
      expect(failedStored?.status).toBe('FAILED');

      // Attempt second click (retry attempt)
      const retryClick = createMockButtonInteraction({
        customId: confirmButtonId,
        userId: 'user-founder-fail',
        roles: [FOUNDER_ROLE_ID],
      });

      await handleRewardButton(retryClick, mockUBBClient);

      // Second click MUST be rejected and NOT retry UBB mutation
      expect(mockUBBClient.grantSparks).toHaveBeenCalledTimes(1); // Never retried
      expect(retryClick.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('cannot be confirmed again'),
          ephemeral: true,
        })
      );

      // Verify action remains in FAILED terminal state and cannot be reactivated
      expect(failedStored?.status).toBe('FAILED');
    });
  });
});
