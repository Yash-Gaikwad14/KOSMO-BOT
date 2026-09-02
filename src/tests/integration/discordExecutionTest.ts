// Integration test for Phase 2 actions against the real test guild
import 'dotenv/config';
import { Client, GatewayIntentBits, Guild } from 'discord.js';
import { runAction } from '../../services/discord/actions';
import { findCategory, findChannel, findRole } from '../../services/discord/lookup';

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !guildId) {
  console.error('Missing DISCORD_BOT_TOKEN or DISCORD_GUILD_ID in .env');
  process.exit(1);
}

async function main() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
  await client.login(token);
  const guild = await client.guilds.fetch(guildId as string);

  console.log('=== Starting real‑Discord integration tests ===');

  // Helper to log and verify
  async function exec(action: any, description: string) {
    console.log(`\n--- ${description}`);
    try {
      const result = await runAction(guild, action);
      console.log('Result:', result);
    } catch (e:any) {
      console.error('Error:', e.message);
    }
  }

  // 1. Category creation (via createChannel with GUILD_CATEGORY)
  const catName = 'test-category';
  const catAction = { type: 'createChannel', payload: { name: catName, type: 'GUILD_CATEGORY' } } as any;
  await exec(catAction, 'Create category (first run)');
  await exec(catAction, 'Create category (second run – idempotent)');
  console.log('Verify category exists:', findCategory(guild, catName) ? 'found' : 'missing');

  // 2. Channel creation (text)
  const chanName = 'test-channel';
  const chanAction = { type: 'createChannel', payload: { name: chanName, type: 'GUILD_TEXT' } } as any;
  await exec(chanAction, 'Create channel (first run)');
  await exec(chanAction, 'Create channel (second run – idempotent)');
  console.log('Verify channel exists:', findChannel(guild, chanName) ? 'found' : 'missing');

  // 3. Role creation
  const roleName = 'test-role';
  const roleAction = { type: 'createRole', payload: { name: roleName } } as any;
  await exec(roleAction, 'Create role (first run)');
  await exec(roleAction, 'Create role (second run – idempotent)');
  console.log('Verify role exists:', findRole(guild, roleName) ? 'found' : 'missing');

  // 4. Role assignment (assign to bot itself)
  const botMember = await guild.members.fetchMe();
  const assignAction = { type: 'assignRole', payload: { roleName, memberId: botMember.id } } as any;
  await exec(assignAction, 'Assign role to bot');
  await exec(assignAction, 'Assign role again – idempotent');

  // 5. Role removal
  const removeAction = { type: 'removeRole', payload: { roleName, memberId: botMember.id } } as any;
  await exec(removeAction, 'Remove role from bot');
  await exec(removeAction, 'Remove again – idempotent (should report not present)');

  // 6. Permission template application (deny @everyone SendMessages on the test channel)
  const everyoneId = guild.roles.everyone.id;
  const permTemplate = {
    type: 'applyPermissionTemplate',
    payload: {
      targetName: chanName,
      permissionOverwrites: [
        {
          id: everyoneId,
          deny: ['SendMessages'],
        },
      ],
    },
  } as any;
  await exec(permTemplate, 'Apply permission template (first run)');
  await exec(permTemplate, 'Apply permission template (second run – idempotent)');

  // 7. Safety: attempt privileged role creation (Founder)
  const privilegedAction = { type: 'createRole', payload: { name: 'Founder' } } as any;
  await exec(privilegedAction, 'Attempt to create privileged role (should fail)');

  // 8. Safety: attempt admin permission grant via template
  const adminPermTemplate = {
    type: 'applyPermissionTemplate',
    payload: {
      targetName: chanName,
      permissionOverwrites: [{ id: everyoneId, allow: ['Administrator'] }],
    },
  } as any;
  await exec(adminPermTemplate, 'Attempt admin permission grant (should fail)');

  await client.destroy();
  console.log('\n=== Integration tests completed ===');
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
