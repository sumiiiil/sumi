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

// ================= CLIENT =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User,
    Partials.GuildMember
  ]
});

// ================= CONFIG =================
const GUILD_ID = "1387525349222645873";
const FORUM_CHANNEL_ID = "1504256009365885029";
const STAFF_ROLE_ID = "1500489431918837861";

// ================= READY =================
client.once("ready", () => {
  console.log(`READY: ${client.user.tag}`);

  client.user.setPresence({
    activities: [{ name: "dm me for inquiries" }],
    status: "online"
  });
});

// ================= MESSAGE SYSTEM =================
client.on("messageCreate", async (message) => {

  if (message.author.bot) return;

  try {

    // ================= USER DM =================
    if (!message.guild) {

      const guild = await client.guilds.fetch(GUILD_ID);
      const forum = await guild.channels.fetch(FORUM_CHANNEL_ID);

      // CHECK EXISTING TICKET
      const { data: existingTicket } = await supabase
        .from("tickets")
        .select("*")
        .eq("user_id", message.author.id)
        .eq("open", true)
        .single();

      let thread = null;

      // ================= EXISTING THREAD =================
      if (existingTicket) {

        thread = await client.channels
          .fetch(existingTicket.thread_id)
          .catch(() => null);

      }

      // ================= CREATE THREAD =================
      if (!thread) {

        thread = await forum.threads.create({
          name: `ticket-${message.author.username}`,
          message: {
            content: `new thread from **${message.author.tag}**`
          }
        });

        await supabase
          .from("tickets")
          .upsert({
            user_id: message.author.id,
            thread_id: thread.id,
            open: true
          });

        // OPEN MESSAGE
        try {
          await message.author.send({
            embeds: [
              new EmbedBuilder()
                .setTitle("<a:51_raindance:1412622961969598484> ⋯ new thread opened")
                .setDescription(
                  "please be patient while waiting for a response.\n" +
                  "if needed, ping staff in the server after 24h."
                )
                .setColor(0x90EE90)
            ]
          });
        } catch {}
      }

      // ================= USER EMBED =================
      const embed = new EmbedBuilder()
        .setDescription(message.content || "*no text*")
        .setColor(0x90EE90)
        .setAuthor({
          name: message.author.tag,
          iconURL: message.author.displayAvatarURL()
        });

      const firstAttachment = message.attachments.first();

      // IMAGE SUPPORT
      if (firstAttachment?.contentType?.startsWith("image")) {
        embed.setImage(firstAttachment.url);
      }

      // SEND TO THREAD
      await thread.send({
        embeds: [embed]
      });

      return;
    }

    // ================= STAFF =================
    const isThread =
      message.channel.type === ChannelType.PublicThread ||
      message.channel.type === ChannelType.PrivateThread;

    if (!isThread) return;

    if (!message.member?.roles.cache.has(STAFF_ROLE_ID)) return;

    // FIND TICKET
    const { data: ticket } = await supabase
      .from("tickets")
      .select("*")
      .eq("thread_id", message.channel.id)
      .eq("open", true)
      .single();

    if (!ticket) return;

    const user = await client.users
      .fetch(ticket.user_id)
      .catch(() => null);

    if (!user) return;

    // ================= CLOSE =================
    if (message.content === "!close") {

      await message.channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("<a:51_leaves:1412620595593740338> ⋯ thread closed")
            .setDescription("ticket closed by staff.")
            .setColor(0x90EE90)
        ]
      });

      try {
        await user.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("<a:51_leaves:1412620595593740338> ⋯ thread closed")
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
        .eq("user_id", ticket.user_id);

      await message.channel.setArchived(true);
      await message.channel.setLocked(true);

      return;
    }

    // ================= STAFF EMBED =================
    const embed = new EmbedBuilder()
      .setDescription(message.content || "*no text*")
      .setColor(0xffffff)
      .setAuthor({
        name: message.author.tag,
        iconURL: message.author.displayAvatarURL()
      });

    const firstAttachment = message.attachments.first();

    if (firstAttachment?.contentType?.startsWith("image")) {
      embed.setImage(firstAttachment.url);
    }

    // SEND TO USER
    await user.send({
      embeds: [embed]
    });

  } catch (err) {
    console.log("ERROR:", err);
  }
});

client.login(process.env.TOKEN);
