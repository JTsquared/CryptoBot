import 'dotenv/config';

export default {
  token: process.env.DISCORD_TOKEN,
  mongoUri: process.env.MONGO_URI,
  ownerId: process.env.OWNER_ID,
};