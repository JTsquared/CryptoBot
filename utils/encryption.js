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



import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import crypto from "crypto";

const client = new SecretManagerServiceClient();

async function getSecret(secretName) {
  const [version] = await client.accessSecretVersion({
    name: `projects/bubbledegen/secrets/${secretName}/versions/latest`,
  });
  return version.payload.data.toString();
}

export async function encrypt(text) {
  const key = Buffer.from(await getSecret("ENCRYPTION_KEY"), "base64");
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export async function decrypt(text) {
  const key = Buffer.from(await getSecret("ENCRYPTION_KEY"), "base64");
  const data = Buffer.from(text, "base64");

  const iv = data.slice(0, 16);
  const tag = data.slice(16, 32);
  const encrypted = data.slice(32);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

