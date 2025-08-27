import { Client, Collection, GatewayIntentBits, REST, Routes } from "discord.js";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import dotenv from "dotenv";
import prizePoolRoutes from "./api/prizePoolRoutes.js";
import express from "express";

dotenv.config();

const client = new Client({ intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers, // needed for .members.fetch()
] });
client.commands = new Collection();

const commandsPath = path.resolve("commands");
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(".js"));

const commands = [];
for (const file of commandFiles) {
  const command = (await import(`./commands/${file}`)).default;

  // Skip registration if marked as hidden
  if (command.hidden) {
    console.log(`Skipping hidden command: ${command.data.name}`);
    continue;
  }

  client.commands.set(command.data.name, command);
  commands.push(command.data.toJSON());
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  console.log("Slash commands registered.");

  const hiddenCommands = [];
  for (const file of commandFiles) {
    const mod = await import(`./commands/${file}`);
    if (mod.default?.hidden) {
      hiddenCommands.push(mod.default);
    }
  }

  for (const cmd of hiddenCommands) {
    // Only register in guilds that also have Rumble Bot
    client.guilds.cache.forEach(async guild => {
      const rumbleBot = guild.members.cache.find(
        member => member.user.username === 'Rumble Bot' // or use its ID if you know it
      );
      if (rumbleBot) {
        await rest.put(
          Routes.applicationGuildCommands(client.user.id, guild.id),
          { body: [cmd.data.toJSON()] }
        );
        console.log(`Registered hidden command ${cmd.data.name} in guild ${guild.name}`);
      }
    });
  }
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(err);
    await interaction.reply({ content: "There was an error executing this command.", ephemeral: true });
  }
});

client.login(process.env.DISCORD_TOKEN);

// ----------------- EXPRESS SERVER SETUP -----------------
const app = express();
app.use(express.json());

// Mount your API routes
app.use("/api/prizepool", prizePoolRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`API server running on http://0.0.0.0:${PORT}`);
});
