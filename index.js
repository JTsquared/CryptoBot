import { Client, Collection, GatewayIntentBits, REST, Routes } from "discord.js";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import dotenv from "dotenv";

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
