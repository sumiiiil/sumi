const express = require("express");
const app = express();

app.get("/", (_, res) => res.send("Modmail running"));
app.listen(3000, () => console.log("Web server running"));

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
  partials: [Partials.Channel, Partials.Message, Partials.User]
});

// ================= CONFIG =================
const GUILD_ID = "1387525349222645873";
const FORUM_CHANNEL_ID = "1504256009365885029";
const STAFF_ROLE_ID = "1500489431918837861";

const tickets = new Map();

// ================= READY =================
client.once("ready", async () => {
  console.log(`READY: ${client.user.tag}`);

  client.user.setPresence({
    activities: [
      {
        name: "dm me for inquiries"
      }
    ],
    status: "online"
  });

  // restore tickets
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

  // ================= DM USERS =================
  if (message.channel.isDMBased()) {
    const guild = await client.guilds.fetch(GUILD_ID);
    const forum = await guild.channels.fetch(FORUM_CHANNEL_ID);

    let ticketData = tickets.get(message.author.id);

    let thread;

    // ================= CHECK DUPLICATE SAFETY =================
    if (ticketData) {
      thread = await client.channels
        .fetch(ticketData.threadId)
        .catch(() => null);

      if (thread) {
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
    }

    // ================= CREATE NEW THREAD =================
    thread = await forum.threads.create({
      name: `ticket-${message.author.username}`,
      message: {
        content: `new thread from **${message.author.tag}**`
      }
    });

    // save to DB (safe upsert style)
    const { data: dbTicket } = await supabase
      .from("tickets")
      .upsert({
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

    // ================= DM USER (SAFE) =================
    try {
      const dm = await message.author.createDM();

      await dm.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("new thread opened")
            .setDescription(
              "please wait for staff reply.\nif needed, follow up after 24h."
            )
            .setColor(0x90EE90)
        ]
      });
    } catch (err) {
      console.log("❌ DM failed:", err);
    }

    // ================= SEND TO THREAD =================
    await thread.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("new ticket")
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

  // ================= STAFF REPLIES =================
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

  let user;
  try {
    user = await client.users.fetch(ticket.user_id);
  } catch {
    return;
  }

  // ================= CLOSE COMMAND =================
  if (message.content === "!close") {
    await message.channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("thread closed")
          .setDescription("ticket closed by staff")
          .setColor(0x90EE90)
      ]
    });

    try {
      await user.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("ticket closed")
            .setDescription("you may open a new ticket anytime.")
            .setColor(0x90EE90)
        ]
      });
    } catch {}

    await supabase
      .from("tickets")
      .update({ open: false })
      .eq("id", ticket.id);

    tickets.delete(ticket.user_id);

    await message.channel.setArchived(true);
    await message.channel.setLocked(true);

    return;
  }

  // ================= STAFF MESSAGE -> USER =================
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
