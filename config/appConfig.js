import crypto from "crypto";

function parseEncryptionKey(rawKey) {
  if (!rawKey) {
    return null;
  }

  const trimmed = rawKey.trim();

  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  try {
    const decoded = Buffer.from(trimmed, "base64");

    if (decoded.length === 32) {
      return decoded;
    }
  } catch {
    return null;
  }

  return null;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOriginFromUrl(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

export function getAppConfig() {
  const encryptionKey = parseEncryptionKey(process.env.APP_ENCRYPTION_KEY || "");
  const port = Number(process.env.PORT || 4000);
  const appBaseUrl = process.env.APP_BASE_URL || `http://localhost:${port}`;

  return {
    appName: "AI Developer Command Center",
    appVersion: "1.0.0",
    port,
    appBaseUrl,
    appOrigin: parseOriginFromUrl(appBaseUrl),
    openAiApiKey: process.env.OPENAI_API_KEY || "",
    openAiModel: process.env.OPENAI_MODEL || "gpt-5.1",
    sessionSecret: process.env.APP_SESSION_SECRET || process.env.APP_ENCRYPTION_KEY || "",
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "10m",
    mongoUri: process.env.MONGODB_URI || "",
    notion: {
      mcpServerUrl: process.env.NOTION_MCP_SERVER_URL || "https://mcp.notion.com/mcp",
      defaults: {
        titleProperty: process.env.DEFAULT_NOTION_TITLE_PROPERTY || "Task",
        priorityProperty: process.env.DEFAULT_NOTION_PRIORITY_PROPERTY || "Priority",
        statusProperty: process.env.DEFAULT_NOTION_STATUS_PROPERTY || "Status",
        statusValue: process.env.DEFAULT_NOTION_STATUS_VALUE || "Open",
        subtasksProperty: process.env.DEFAULT_NOTION_SUBTASKS_PROPERTY || "Subtasks",
        sourceProperty: process.env.DEFAULT_NOTION_SOURCE_PROPERTY || "Source"
      }
    },
    security: {
      encryptionKey,
      hasEncryptionKey: Boolean(encryptionKey),
      hasSessionSecret: Boolean(process.env.APP_SESSION_SECRET || process.env.APP_ENCRYPTION_KEY),
      apiRateLimitWindowMs: parsePositiveInt(process.env.API_RATE_LIMIT_WINDOW_MS, 60_000),
      apiRateLimitMax: parsePositiveInt(process.env.API_RATE_LIMIT_MAX, 120),
      authRateLimitWindowMs: parsePositiveInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 120_000),
      authRateLimitMax: parsePositiveInt(process.env.AUTH_RATE_LIMIT_MAX, 20),
      webhookRateLimitWindowMs: parsePositiveInt(process.env.WEBHOOK_RATE_LIMIT_WINDOW_MS, 60_000),
      webhookRateLimitMax: parsePositiveInt(process.env.WEBHOOK_RATE_LIMIT_MAX, 120),
      loginAttemptWindowMs: parsePositiveInt(process.env.LOGIN_ATTEMPT_WINDOW_MS, 120_000),
      loginAttemptMax: parsePositiveInt(process.env.LOGIN_ATTEMPT_MAX, 5),
      loginCooldownMs: parsePositiveInt(process.env.LOGIN_COOLDOWN_MS, 120_000)
    }
  };
}

export function requireEncryptionKey() {
  const config = getAppConfig();

  if (!config.security.hasEncryptionKey) {
    throw new Error(
      "APP_ENCRYPTION_KEY must be a 32-byte base64 or 64-char hex value for production Notion MCP auth"
    );
  }

  return config.security.encryptionKey;
}

export function requireSessionSecret() {
  const config = getAppConfig();

  if (!config.security.hasSessionSecret) {
    throw new Error("APP_SESSION_SECRET or APP_ENCRYPTION_KEY is required for JWT auth tokens");
  }

  return config.sessionSecret;
}

export function requireMongoUri() {
  const config = getAppConfig();

  if (!config.mongoUri) {
    throw new Error("MONGODB_URI is required for the MongoDB-backed backend");
  }

  return config.mongoUri;
}

export function generateEncryptionKey() {
  return crypto.randomBytes(32).toString("base64");
}
