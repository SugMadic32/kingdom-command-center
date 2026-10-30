import {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction,
} from 'discord.js';
import { q, one } from '../lib/db.js';
import { config } from '../lib/config.js';
import { setDiscordSender } from '../lib/notify.js';

const commands = [
  new SlashCommandBuilder().setName('events').setDescription('Upcoming published kingdom events'),
  new SlashCommandBuilder().setName('castle').setDescription('Next castle appointment'),
  new SlashCommandBuilder().setName('kvk').setDescription('Current KVK season and phases'),
  new SlashCommandBuilder().setName('appointments').setDescription("Your upcoming King's appointment slots (only you can see the reply)"),
  new SlashCommandBuilder().setName('resources').setDescription('Your saved resource inventory (only you can see the reply)'),
  new SlashCommandBuilder().setName('link').setDescription('Link your Discord account to the Command Center')
    .addStringOption((o) => o.setName('code').setDescription('Code from Settings › Discord').setRequired(true)),
].map((c) => c.toJSON());

const ts = (d: Date) => `<t:${Math.floor(new Date(d).getTime() / 1000)}:F> (<t:${Math.floor(new Date(d).getTime() / 1000)}:R>)`;

/** Starts only when a token is configured. The token never leaves the server process. */
export async function startDiscordBot() {
  if (!config.discordToken || !config.discordAppId) {
    console.log('[discord] DISCORD_BOT_TOKEN / DISCORD_APP_ID not set — bot disabled.');
    return;
  }
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  const route = config.discordGuildId
    ? Routes.applicationGuildCommands(config.discordAppId, config.discordGuildId)
    : Routes.applicationCommands(config.discordAppId);
  await rest.put(route, { body: commands });

  // Least privilege: guild events only; no message content intent needed for slash commands.
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.on('interactionCreate', async (i) => {
    if (!i.isChatInputCommand()) return;
    try { await handle(i); } catch (e) {
      console.error('[discord] command failed', e);
      const msg = { content: 'That command failed. Try again in a minute.', flags: MessageFlags.Ephemeral } as const;
      if (i.replied || i.deferred) await i.followUp(msg); else await i.reply(msg);
    }
  });

  client.once('ready', () => {
    console.log(`[discord] connected as ${client.user?.tag}`);
    setDiscordSender(async (target, text) => {
      if (target.channelId) {
        const ch = await client.channels.fetch(target.channelId);
        if (!ch || !ch.isSendable()) throw new Error('Configured channel is missing or the bot cannot post there.');
        await ch.send({ content: text.slice(0, 1900), allowedMentions: { parse: [] } });
      } else if (target.userId) {
        const user = await client.users.fetch(target.userId);
        await user.send({ content: text.slice(0, 1900), allowedMentions: { parse: [] } });
      }
    });
  });
  client.on('error', (e) => console.error('[discord] client error', e));
  await client.login(config.discordToken);
}

async function handle(i: ChatInputCommandInteraction) {
  switch (i.commandName) {
    case 'events': {
      const rows = await q(`SELECT id, title, type, starts_at FROM events WHERE status = 'published' AND scope = 'kingdom'
                             AND starts_at > now() ORDER BY starts_at LIMIT 8`);
      return i.reply(rows.length
        ? rows.map((e) => `**${e.title}** (${e.type}) — ${ts(e.starts_at)}\n${config.appUrl}/events/${e.id}`).join('\n')
        : 'No upcoming kingdom events are published.');
    }
    case 'castle': {
      const e = await one(`SELECT id, title, starts_at, description FROM events WHERE status = 'published' AND type = 'castle'
                            AND starts_at > now() ORDER BY starts_at LIMIT 1`);
      return i.reply(e ? `**${e.title}** — ${ts(e.starts_at)}\n${e.description.slice(0, 500)}\n${config.appUrl}/events/${e.id}`
        : 'No castle appointment is published yet.');
    }
    case 'kvk': {
      const s = await one(`SELECT * FROM kvk_seasons WHERE ends_at IS NULL OR ends_at > now() ORDER BY starts_at LIMIT 1`);
      if (!s) return i.reply('No KVK season is scheduled.');
      const phases = await q('SELECT name, starts_at FROM kvk_phases WHERE season_id = $1 ORDER BY starts_at', [s.id]);
      return i.reply(`**${s.name}** — starts ${ts(s.starts_at)}\n${phases.map((p) => `• ${p.name}: ${ts(p.starts_at)}`).join('\n')}`);
    }
    case 'appointments': {
      const u = await one<{ id: number }>('SELECT id FROM users WHERE discord_user_id = $1 AND deleted_at IS NULL', [i.user.id]);
      if (!u) return i.reply({ content: 'Link your account first: Settings › Discord on the website, then /link.', flags: MessageFlags.Ephemeral });
      const rows = await q(`SELECT b.slot_start, p.name AS position, s.name AS schedule FROM appointment_bookings b
                              JOIN appointment_schedules s ON s.id = b.schedule_id JOIN appointment_positions p ON p.id = b.position_id
                             WHERE b.user_id = $1 AND b.slot_start > now() - make_interval(mins => s.slot_minutes) ORDER BY b.slot_start LIMIT 10`, [u.id]);
      return i.reply({ content: rows.length ? rows.map((r) => `**${r.position}** — ${ts(r.slot_start)} (${r.schedule})`).join('\n') : 'You have no upcoming appointments.',
        flags: MessageFlags.Ephemeral });
    }
    case 'resources': {
      const u = await one<{ id: number }>('SELECT id FROM users WHERE discord_user_id = $1 AND deleted_at IS NULL', [i.user.id]);
      if (!u) return i.reply({ content: 'Link your account first: Settings › Discord on the website, then /link.', flags: MessageFlags.Ephemeral });
      const inv = await q(`SELECT r.name, COALESCE(mi.amount,0) AS amount FROM resource_types r
                            LEFT JOIN member_inventory mi ON mi.resource_key = r.key AND mi.user_id = $1
                           WHERE NOT r.deferred ORDER BY r.sort`, [u.id]);
      return i.reply({ content: inv.map((r) => `${r.name}: ${Number(r.amount).toLocaleString('en-US')}`).join('\n') || 'No inventory saved.',
        flags: MessageFlags.Ephemeral });
    }
    case 'link': {
      const code = i.options.getString('code', true).trim().toUpperCase();
      const u = await one<{ id: number }>(
        `UPDATE users SET discord_user_id = $2, discord_link_code = NULL, discord_link_expires = NULL
          WHERE discord_link_code = $1 AND discord_link_expires > now() AND deleted_at IS NULL RETURNING id`, [code, i.user.id]);
      return i.reply({ content: u ? 'Linked. You can now turn on Discord reminders in Settings.' : 'That code is invalid or expired.',
        flags: MessageFlags.Ephemeral });
    }
  }
}
