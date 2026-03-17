import crypto from "crypto";
import { NotionAuthState } from "../models/NotionAuthState.js";
import { connectToDatabase } from "./database.js";
import { requireEncryptionKey } from "../config/appConfig.js";

function encryptPayload(payload) {
  const key = requireEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: encrypted.toString("base64")
  });
}

function decryptPayload(raw) {
  const key = requireEncryptionKey();
  const envelope = JSON.parse(raw);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64")
  );

  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final()
  ]);

  return JSON.parse(decrypted.toString("utf8"));
}

export async function readEncryptedAuthStates() {
  await connectToDatabase();
  const documents = await NotionAuthState.find({}, { userId: 1, encryptedState: 1 }).lean();

  return documents.reduce((accumulator, document) => {
    accumulator[document.userId] = decryptPayload(document.encryptedState);
    return accumulator;
  }, {});
}

export async function writeEncryptedAuthStates(stateMap) {
  await connectToDatabase();
  const operations = Object.entries(stateMap).map(([userId, state]) => ({
    updateOne: {
      filter: { userId },
      update: { $set: { encryptedState: encryptPayload(state) } },
      upsert: true
    }
  }));

  if (operations.length > 0) {
    await NotionAuthState.bulkWrite(operations);
  }

  const activeUserIds = Object.keys(stateMap);
  await NotionAuthState.deleteMany({ userId: { $nin: activeUserIds } });
}

export async function clearEncryptedAuthStates() {
  await connectToDatabase();
  await NotionAuthState.deleteMany({});
}
