// import crypto from "crypto";

// export function encrypt(text) {
//   if (!process.env.ENCRYPTION_KEY || !process.env.ENCRYPTION_IV) {
//     throw new Error("Missing ENCRYPTION_KEY or ENCRYPTION_IV in .env");
//   }
//   const cipher = crypto.createCipheriv(
//     "aes-256-ctr",
//     Buffer.from(process.env.ENCRYPTION_KEY, "hex"),
//     Buffer.from(process.env.ENCRYPTION_IV, "hex")
//   );
//   return Buffer.concat([cipher.update(text), cipher.final()]).toString("hex");
// }

// export function decrypt(text) {
//   if (!process.env.ENCRYPTION_KEY || !process.env.ENCRYPTION_IV) {
//     throw new Error("Missing ENCRYPTION_KEY or ENCRYPTION_IV in .env");
//   }
//   const decipher = crypto.createDecipheriv(
//     "aes-256-ctr",
//     Buffer.from(process.env.ENCRYPTION_KEY, "hex"),
//     Buffer.from(process.env.ENCRYPTION_IV, "hex")
//   );
//   return Buffer.concat([
//     decipher.update(Buffer.from(text, "hex")),
//     decipher.final()
//   ]).toString();
// }



// encryption.js
import crypto from "crypto";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

const SECRET_NAME = "projects/YOUR_PROJECT_ID/secrets/encryption-key/versions/latest";

let encryptionKeyBuffer = null;

// Load encryption key from GCP Secret Manager
export async function loadEncryptionKey() {
  if (encryptionKeyBuffer) return encryptionKeyBuffer; // already loaded

  const client = new SecretManagerServiceClient();
  const [version] = await client.accessSecretVersion({ name: SECRET_NAME });
  const key = version.payload.data.toString();

  encryptionKeyBuffer = Buffer.from(key, "base64");
  if (encryptionKeyBuffer.length !== 32) {
    throw new Error("Encryption key must be 32 bytes for AES-256-GCM.");
  }

  return encryptionKeyBuffer;
}

export async function encrypt(text) {
  const key = await loadEncryptionKey();
  const iv = crypto.randomBytes(12); // GCM recommended IV size
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export async function decrypt(encryptedText) {
  const key = await loadEncryptionKey();
  const data = Buffer.from(encryptedText, "base64");
  const iv = data.slice(0, 12);
  const authTag = data.slice(12, 28);
  const encrypted = data.slice(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
