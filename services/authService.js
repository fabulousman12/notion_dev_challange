import crypto from "crypto";
import jwt from "jsonwebtoken";
import { getAppConfig, requireSessionSecret } from "../config/appConfig.js";

function getUserId(user) {
  return String(user.id || user._id);
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derivedKey = crypto.scryptSync(password, salt, 64).toString("hex");
  return {
    salt,
    passwordHash: derivedKey
  };
}

export function verifyPassword(password, salt, passwordHash) {
  const candidate = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(passwordHash, "hex");

  if (candidate.length !== stored.length) {
    return false;
  }

  return crypto.timingSafeEqual(candidate, stored);
}

export function generateWebhookKey() {
  return crypto.randomBytes(18).toString("hex");
}

export function generateWebhookSecret() {
  return crypto.randomBytes(32).toString("hex");
}

export function createSessionToken(user) {
  const config = getAppConfig();

  return jwt.sign(
    {
      sub: getUserId(user),
      email: user.email
    },
    requireSessionSecret(),
    {
      expiresIn: config.jwtExpiresIn
    }
  );
}

export function verifySessionToken(token) {
  try {
    return jwt.verify(token, requireSessionSecret());
  } catch {
    return null;
  }
}

export function sanitizeUser(user) {
  const config = getAppConfig();
  const id = getUserId(user);

  return {
    id,
    name: user.name,
    email: user.email,
    webhookKey: user.webhookKey,
    webhookSecret: user.webhookSecret || "",
    webhookUrl: `${config.appBaseUrl}/webhook/github/${user.webhookKey}`,
    notion: user.notion,
    createdAt: user.createdAt
  };
}
