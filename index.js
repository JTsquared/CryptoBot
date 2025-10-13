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

  // Try to connect to MongoDB (with error handling for local dev)
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("⚠️  MongoDB connection failed:", error.message);
    console.error("Bot will continue without database (commands that need DB will fail)");
  }

  // Collect hidden commands first
  const hiddenCommands = [];
  for (const file of commandFiles) {
    const mod = await import(`./commands/${file}`);
    if (mod.default?.hidden) {
      console.log(`Found hidden command: ${mod.default.data.name}`);
      hiddenCommands.push(mod.default);
    }
  }

  console.log(`Total hidden commands found: ${hiddenCommands.length}`);
  console.log(`Current NETWORK: ${process.env.NETWORK}`);

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  // Register commands based on environment
  if (process.env.NETWORK === 'testnet') {
    // In testnet, register ALL commands (regular + hidden) together
    const allCommands = [...commands];
    if (hiddenCommands.length > 0) {
      const hiddenCommandsJson = hiddenCommands.map(cmd => cmd.data.toJSON());
      allCommands.push(...hiddenCommandsJson);
    }

    console.log(`Registering ${allCommands.length} total commands in test guild ${process.env.GUILD_ID}`);
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
      { body: allCommands }
    );
    console.log(`✅ Registered ${allCommands.length} commands in test guild`);
    console.log(`   Regular: ${commands.length}, Hidden: ${hiddenCommands.length}`);
  } else {
    // In production, register regular commands globally or in guild
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    // await rest.put(
    //   Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
    //   { body: commands }
    // );
    console.log(`Registered ${commands.length} regular commands`);

    // Register hidden commands only in guilds with Degen Rumble
    // In production, only register in guilds that also have Rumble Bot
    for (const cmd of hiddenCommands) {
      client.guilds.cache.forEach(async guild => {
        const rumbleBot = guild.members.cache.find(
          member => member.user.username === 'Degen Rumble' // or use its ID if you know it
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
import rateLimit from 'express-rate-limit';

const app = express();
app.use(express.json());

// Rate limiting - 100 requests per 15 minutes per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error: 'Too many requests, please try again later.'
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  // Skip localhost requests from rate limiting
  skip: (req) => {
    const clientIP = req.ip || req.headers['x-forwarded-for']?.split(',')[0] || req.connection.remoteAddress;
    const LOCALHOST_IPS = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
    return LOCALHOST_IPS.some(ip => clientIP.includes(ip));
  }
});

// Apply rate limiter to all API routes
app.use('/api/', apiLimiter);

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

    // Store the authenticated API key's guild ID in the request
    // Routes MUST validate this matches the requested guildId
    req.apiGuildId = apiKeyRecord.guildId;
    req.isExternalRequest = true; // Flag to indicate this came from external API key

    // Update last used timestamp
    apiKeyRecord.lastUsedAt = new Date();
    await apiKeyRecord.save();

    console.log(`✅ API key authenticated for guild ${apiKeyRecord.guildId} from ${clientIP}`);
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
