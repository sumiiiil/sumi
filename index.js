const express = require("express");
const app = express();

app.get("/", (_, res) => res.send("Modmail running"));
app.listen(3000, () => console.log("Web server running"));

const fs = require("fs");

const {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  EmbedBuilder
} = require("discord.js");

const { createClient } = require("@supabase/supabase-js");

// ================= SUPABASE =================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ================= BOT =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

// ===== CONFIG =====
const GUILD_ID = "1387525349222645873";
const FORUM_CHANNEL_ID = "1504256009365885029";
const STAFF_ROLE_ID = "1500489431918837861";
const PREFIX = "!";

// ===== COMMAND LOADER =====
const commands = new Map();
const commandFiles = fs.readdirSync("./commands").filter(f => f.endsWith(".js"));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  commands.set(command.name, command);
}

// ===== MEMORY CACHE =====
const tickets = new Map();

// ================= READY =================
client.once("ready", async () => {
  console.log(`READY: ${client.user.tag}`);

  client.user.setPresence({
    activities: [
      {
        name: "dm me for inquiries",
        type: 1,
        url: "https://twitch.tv/discord"
      }
    ],
    status: "online"
  });

  // RESTORE TICKETS
  const { data } = await supabase
    .from("tickets")
    .select("*")
    .eq("open", true);

  for (const t of data || []) {
    tickets.set(t.user_id, {
      id: t.id,
      threadId: t.thread_id
    });
  }

  console.log(`Restored ${data?.length || 0} tickets`);
});

// ================= MAIN =================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // ================= COMMAND SYSTEM =================
  if (message.guild && !message.channel.isThread()) {
    if (message.content.startsWith(PREFIX)) {
      const args = message.content.slice(PREFIX.length).trim().split(/ +/);
      const commandName = args.shift().toLowerCase();

      const command = commands.get(commandName);
      if (!command) return;

      try {
        await command.execute(message, args);
      } catch (err) {
        console.error(err);
      }

      return;
    }
  }

  // ================= USER DM =================
  if (message.channel.isDMBased()) {
    const guild = await client.guilds.fetch(GUILD_ID);
    const forum = await guild.channels.fetch(FORUM_CHANNEL_ID);

    let ticketData = tickets.get(message.author.id);
    let thread;

    // ===== CREATE NEW THREAD =====
    if (!ticketData) {
      thread = await forum.threads.create({
        name: `ticket-${message.author.username}`,
        message: {
          content: `new thread from **${message.author.tag}**`
        }
      });

      const { data: dbTicket } = await supabase
        .from("tickets")
        .insert({
          user_id: message.author.id,
          thread_id: thread.id,
          open: true
        })
        .select()
        .single();

      tickets.set(message.author.id, {
        id: dbTicket.id,
        threadId: thread.id
      });

      // ===== YOUR ORIGINAL DM LAYOUT =====
      await message.author.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("<a:51_raindance:1412622961969598484>  ⋯ ⠀new thread opened")
            .setDescription(
              "please be patient while waiting for a response.\n" +
              "if needed, ping staff in the server after 24h."
            )
            .setColor(0x90EE90)
        ]
      });

      // ===== YOUR ORIGINAL THREAD LAYOUT =====
      await thread.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("new thread <a:51_raindance:1412622961969598484> ")
            .setDescription(message.content || "*no text*")
            .setColor(0x90EE90)
            .setAuthor({
              name: message.author.tag,
              iconURL: message.author.displayAvatarURL()
            })
        ]
      });

      await message.react("<a:51_raindance:1412622961969598484>");
      return;
    }

    // ===== EXISTING THREAD =====
    thread = await client.channels.fetch(ticketData.threadId).catch(() => null);
    if (!thread) return;

    await thread.send({
      embeds: [
        new EmbedBuilder()
          .setDescription(message.content || "*no text*")
          .setColor(0x90EE90)
          .setAuthor({
            name: message.author.tag,
            iconURL: message.author.displayAvatarURL()
          })
      ]
    });

    return;
  }

  // ================= STAFF =================
  if (!message.guild) return;

  const isThread =
    message.channel.type === ChannelType.PublicThread ||
    message.channel.type === ChannelType.PrivateThread;

  if (!isThread) return;

  if (!message.member?.roles.cache.has(STAFF_ROLE_ID)) return;

  const { data: ticket } = await supabase
    .from("tickets")
    .select("*")
    .eq("thread_id", message.channel.id)
    .eq("open", true)
    .single();

  if (!ticket) return;

  const userId = ticket.user_id;

  let user;
  try {
    user = await client.users.fetch(userId);
  } catch {
    return;
  }

  const content = message.content?.trim();

  // ================= COMMANDS =================
  if (content.startsWith("!")) {

    if (content === "!close") {

      // ===== YOUR ORIGINAL CLOSE EMBED =====
      await message.channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("<a:51_leaves:1412620595593740338>  ⋯ ⠀thread closed")
            .setDescription("ticket has been closed by staff.")
            .setColor(0x90EE90)
        ]
      });

      try {
        await user.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("<a:51_leaves:1412620595593740338>  ⋯ ⠀thread closed")
              .setDescription(
                "this ticket has been closed.\n" +
                "send a new message to open a new thread."
              )
              .setColor(0x90EE90)
          ]
        });
      } catch {}

      await supabase
        .from("tickets")
        .update({ open: false })
        .eq("id", ticket.id);

      tickets.delete(userId);

      await message.channel.setArchived(true);

      return;
    }

    return;
  }

  // ================= STAFF MESSAGE =================
  try {
    await user.send({
      embeds: [
        new EmbedBuilder()
          .setDescription(message.content)
          .setColor(0x90EE90)
          .setAuthor({
            name: message.author.tag,
            iconURL: message.author.displayAvatarURL()
          })
      ]
    });
  } catch (err) {
    console.log("DM failed:", err);
  }
});

client.login(process.env.TOKEN);
