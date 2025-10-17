// api/services/otpStore.js
import { CosmosClient } from "@azure/cosmos";
import crypto from "node:crypto";
import dotenv from "dotenv";
dotenv.config();

const OTP_TTL_SECONDS = 10 * 60; // 10 min

const client = new CosmosClient({
  endpoint: process.env.COSMOSDB_URI,
  key: process.env.COSMOSDB_KEY,
});
const db = client.database("graduados");
const otpContainer = db.container("logins"); // crie esse container com pk=/id

function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export async function saveOtp(email, code) {
  const id = `${email}#${Date.now()}`;
  const hash = sha256(`${email}:${code}`);
  const expiresAt = Date.now() + OTP_TTL_SECONDS * 1000;

  await otpContainer.items.create({
    id,
    email,
    hash,
    createdAt: new Date().toISOString(),
    expiresAt,
    type: "otp",
    ttl: OTP_TTL_SECONDS,
  });
  return { id, expiresAt };
}

export async function verifyAndConsumeOtp(email, code) {
  const hash = sha256(`${email}:${code}`);
  // busca últimos OTPs desse email
  const { resources } = await otpContainer.items
    .query({
      query:
        "SELECT * FROM c WHERE c.type='otp' AND c.email=@e ORDER BY c.createdAt DESC",
      parameters: [{ name: "@e", value: email }],
    })
    .fetchAll();

  for (const item of resources || []) {
    if (Date.now() > (item.expiresAt || 0)) continue;
    if (item.hash === hash) {
      // consome (apaga) o OTP
      await otpContainer.item(item.id, item.id).delete();
      return true;
    }
  }
  return false;
}
