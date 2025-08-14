import crypto from "crypto";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

const PROJECT_ID = "bubbledegen";
const SECRET_ID = "ENCRYPTION_KEY";
const ALGO = "aes-256-gcm";
const IV_LEN = 12;           // 96-bit recommended for GCM
const TAG_LEN = 16;          // 128-bit tag output
const client = new SecretManagerServiceClient();

// Cache latest version briefly to avoid hammering Secret Manager on hot paths.
// Decrypt fetches the exact version on demand (usually cached by the client lib).
let latestCache = { key: null, version: null, ts: 0 };
const LATEST_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function accessSecretVersion(versionStr = "latest") {
  // returns { keyBuf, version }
  const name = `projects/${PROJECT_ID}/secrets/${SECRET_ID}/versions/${versionStr}`;
  const [v] = await client.accessSecretVersion({ name });
  const keyBase64 = v.payload.data.toString();
  const keyBuf = Buffer.from(keyBase64, "base64");
  if (keyBuf.length !== 32) {
    throw new Error(`ENCRYPTION_KEY version ${v.name} is not 32 bytes after base64 decode`);
  }
  // v.name ends with "/versions/<n>"
  const version = v.name.split("/").pop();
  return { keyBuf, version };
}

async function getLatestKey() {
  const now = Date.now();
  if (latestCache.key && now - latestCache.ts < LATEST_TTL_MS) {
    return { keyBuf: latestCache.key, version: latestCache.version };
  }
  const { keyBuf, version } = await accessSecretVersion("latest");
  latestCache = { key: keyBuf, version, ts: now };
  return { keyBuf, version };
}

/**
 * Returns: "<version>:<base64(iv||tag||ciphertext)>"
 */
export async function encrypt(plaintext) {
  const { keyBuf, version } = await getLatestKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, keyBuf, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16 bytes

  const payload = Buffer.concat([iv, tag, ct]).toString("base64");
  return `${version}:${payload}`;
}

/**
 * Accepts: "<version>:<base64(iv||tag||ciphertext)>"
 */
export async function decrypt(serialized) {
  const sep = serialized.indexOf(":");
  if (sep === -1) throw new Error("Invalid ciphertext format: missing version prefix");

  const version = serialized.slice(0, sep);
  const b64 = serialized.slice(sep + 1);

  const { keyBuf } = await accessSecretVersion(version);
  const buf = Buffer.from(b64, "base64");
  const iv = buf.slice(0, IV_LEN);
  const tag = buf.slice(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.slice(IV_LEN + TAG_LEN);

  const decipher = crypto.createDecipheriv(ALGO, keyBuf, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}


