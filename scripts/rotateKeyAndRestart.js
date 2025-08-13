// scripts/rotateKeyAndRestart.js
import { exec } from "child_process";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import crypto from "crypto";

const client = new SecretManagerServiceClient();
const SECRET_NAME = "ENCRYPTION_KEY";
const PROJECT_ID = "bubbledegen"; // adjust if needed
const PM2_PROCESS_NAME = "cryptobot";

async function rotateKey() {
  try {
    // Generate new 32-byte key in base64
    const newKey = crypto.randomBytes(32).toString("base64");

    // Add new version to Secret Manager
    await client.addSecretVersion({
      parent: `projects/${PROJECT_ID}/secrets/${SECRET_NAME}`,
      payload: {
        data: Buffer.from(newKey, "utf8"),
      },
    });

    console.log("✅ Successfully added new secret version.");

    // Restart PM2 process
    exec(`pm2 restart ${PM2_PROCESS_NAME}`, (err, stdout, stderr) => {
      if (err) {
        console.error("❌ Failed to restart PM2:", err);
        return;
      }
      console.log(`✅ PM2 restarted process "${PM2_PROCESS_NAME}".`);
      console.log(stdout);
      if (stderr) console.error(stderr);
    });
  } catch (error) {
    console.error("❌ Error rotating key:", error);
  }
}

// Run rotation
rotateKey();
