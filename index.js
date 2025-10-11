import dotenv from "dotenv";
let envFile = ".env";

const envArg = process.argv.find(arg => arg.startsWith("--env="));
if (envArg) {
  const file = envArg.split("=")[1];
  if (file === "test") envFile = ".env.test";
  else if (file === "prod") envFile = ".env.prod";
  else envFile = ".env"; // fallback
}

console.log(`Loading env file: ${envFile}`);
dotenv.config({ path: envFile });

console.log("NETWORK:", process.env.NETWORK);

import { Client, Collection, GatewayIntentBits, REST, Routes } from "discord.js";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import prizePoolRoutes from "./api/prizePoolRoutes.js";
import express from "express";


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
  // await rest.put(
  //   Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
  //   { body: commands }
  // );
  // console.log("Slash commands registered.");

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

// console.log("discord token: " + process.env.DISCORD_TOKEN);
client.login(process.env.DISCORD_TOKEN);

// ----------------- EXPRESS SERVER SETUP -----------------
const app = express();
app.use(express.json());

// API Authentication Middleware
app.use("/api/prizepool", async (req, res, next) => {
  // Get client IP
  const clientIP = req.ip || req.headers['x-forwarded-for']?.split(',')[0] || req.connection.remoteAddress;

  // Localhost IPs (HardcoreRumble bot on same VM) - no API key required
  const LOCALHOST_IPS = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
  const isLocalhost = LOCALHOST_IPS.some(ip => clientIP.includes(ip));

  if (isLocalhost) {
    // Localhost requests bypass API key authentication
    return next();
  }

  // External requests require API key
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    console.warn(`🚨 BLOCKED: External request from ${clientIP} - No API key provided`);
    return res.status(401).json({
      success: false,
      error: 'Unauthorized - API key required for external access'
    });
  }

  try {
    // Import ApiKey model dynamically to avoid circular dependencies
    const { default: ApiKey } = await import('./database/models/apiKey.js');
    const crypto = await import('crypto');

    // Hash the provided API key
    const keyHash = crypto.default.createHash('sha256').update(apiKey).digest('hex');

    // Find the API key in database
    const apiKeyRecord = await ApiKey.findOne({ keyHash: keyHash, isActive: true });

    if (!apiKeyRecord) {
      console.warn(`🚨 BLOCKED: External request from ${clientIP} - Invalid API key`);
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - Invalid or revoked API key'
      });
    }

    // Extract guildId from the request (URL path or body)
    const guildId = req.params.guildId || req.body?.guildId || req.query?.guildId;

    // Validate the API key belongs to the requested guild
    if (guildId && apiKeyRecord.guildId !== guildId) {
      console.warn(`🚨 BLOCKED: API key from guild ${apiKeyRecord.guildId} attempted to access guild ${guildId}`);
      return res.status(403).json({
        success: false,
        error: 'Forbidden - API key does not have access to this guild'
      });
    }

    // Update last used timestamp
    apiKeyRecord.lastUsedAt = new Date();
    await apiKeyRecord.save();

    // Attach guild info to request for downstream use
    req.apiGuildId = apiKeyRecord.guildId;

    console.log(`✅ External API request authenticated: Guild ${apiKeyRecord.guildId} from ${clientIP}`);
    next();

  } catch (error) {
    console.error('Error validating API key:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error during authentication'
    });
  }
});

// Mount your API routes
app.use("/api/prizepool", prizePoolRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`API server running on http://0.0.0.0:${PORT}`);
});
