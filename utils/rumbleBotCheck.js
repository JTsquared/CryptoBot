// utils/rumbleBotCheck.js
export async function isRumbleBotPresent(guild) {
    const rumbleBotId = "RUMBLE_BOT_CLIENT_ID"; // from Discord dev portal
    try {
      const member = await guild.members.fetch(rumbleBotId);
      return !!member;
    } catch {
      return false;
    }
  }
  