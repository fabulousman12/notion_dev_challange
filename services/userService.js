import { User } from "../models/User.js";
import { connectToDatabase } from "./database.js";
import {
  generateWebhookKey,
  generateWebhookSecret,
  hashPassword,
  sanitizeUser,
  verifyPassword
} from "./authService.js";

function buildDefaultDatabaseName(nameOrEmail = "User") {
  return `${nameOrEmail} AI Developer Tasks`;
}

function buildDefaultNotionConfig(overrides = {}, fallbackNameOrEmail = "User") {
  const baseName = String(fallbackNameOrEmail || "User").trim() || "User";

  return {
    databaseName: overrides.databaseName || buildDefaultDatabaseName(baseName),
    targetId: overrides.targetId || overrides.databaseId || overrides.dataSourceId || "",
    resolvedTargetId: overrides.resolvedTargetId || "",
    resolvedTargetKind: overrides.resolvedTargetKind || ""
  };
}

async function ensureWebhookSecret(user) {
  if (user?.webhookSecret) {
    return user;
  }

  user.webhookSecret = generateWebhookSecret();
  await user.save();
  return user;
}

export async function listUsers() {
  await connectToDatabase();
  const users = await User.find({}).sort({ createdAt: -1 }).lean();
  return users.map(sanitizeUser);
}

export async function findUserByEmail(email) {
  await connectToDatabase();
  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    return null;
  }

  await ensureWebhookSecret(user);
  return user.toObject();
}

export async function findUserById(userId) {
  await connectToDatabase();
  const user = await User.findById(userId);

  if (!user) {
    return null;
  }

  await ensureWebhookSecret(user);
  return user.toObject();
}

export async function findUserByWebhookKey(webhookKey) {
  await connectToDatabase();
  const user = await User.findOne({ webhookKey });

  if (!user) {
    return null;
  }

  await ensureWebhookSecret(user);
  return user.toObject();
}

export async function createUser({ name, email, password, notion = {} }) {
  await connectToDatabase();
  const normalizedEmail = email.trim().toLowerCase();
  const existingUser = await User.findOne({ email: normalizedEmail }).lean();

  if (existingUser) {
    throw new Error("A user with that email already exists");
  }

  const displayName = name?.trim() || normalizedEmail.split("@")[0];
  const { salt, passwordHash } = hashPassword(password);
  const createdUser = await User.create({
    name: displayName,
    email: normalizedEmail,
    salt,
    passwordHash,
    webhookKey: generateWebhookKey(),
    webhookSecret: generateWebhookSecret(),
    notion: buildDefaultNotionConfig(notion, displayName)
  });

  return createdUser.toObject();
}

export async function authenticateUser({ email, password }) {
  const user = await findUserByEmail(email);

  if (!user) {
    return null;
  }

  if (!verifyPassword(password, user.salt, user.passwordHash)) {
    return null;
  }

  return user;
}

export async function updateUserNotionConfig(userId, notionConfig) {
  await connectToDatabase();
  const user = await User.findById(userId);

  if (!user) {
    throw new Error("User not found");
  }

  const existing = user.notion.toObject();
  const nextDatabaseName = String(
    notionConfig.databaseName ?? existing.databaseName ?? buildDefaultDatabaseName(user.name)
  ).trim();
  const nextTargetId = notionConfig.targetId ?? existing.targetId;
  const databaseChanged = nextDatabaseName !== existing.databaseName;
  const targetChanged = nextTargetId !== existing.targetId;

  user.notion = buildDefaultNotionConfig(
    {
      ...existing,
      ...notionConfig,
      databaseName: nextDatabaseName,
      targetId: nextTargetId,
      resolvedTargetId:
        databaseChanged || targetChanged ? "" : notionConfig.resolvedTargetId ?? existing.resolvedTargetId,
      resolvedTargetKind:
        databaseChanged || targetChanged ? "" : notionConfig.resolvedTargetKind ?? existing.resolvedTargetKind
    },
    user.name
  );

  await user.save();
  return user.toObject();
}

export async function saveResolvedNotionTarget(userId, notionState = {}) {
  await connectToDatabase();
  const user = await User.findById(userId);

  if (!user) {
    throw new Error("User not found");
  }

  const existing = user.notion.toObject();
  const target = notionState.target || {};

  user.notion = buildDefaultNotionConfig(
    {
      ...existing,
      databaseName: notionState.databaseName || existing.databaseName,
      targetId: notionState.targetId || existing.targetId || target.id || "",
      resolvedTargetId: notionState.resolvedTargetId || target.id || existing.resolvedTargetId,
      resolvedTargetKind: notionState.resolvedTargetKind || target.kind || existing.resolvedTargetKind
    },
    user.name
  );

  await user.save();
  return user.toObject();
}

export async function rotateUserWebhookKey(userId) {
  await connectToDatabase();
  const user = await User.findById(userId);

  if (!user) {
    throw new Error("User not found");
  }

  user.webhookKey = generateWebhookKey();
  user.webhookSecret = generateWebhookSecret();
  await user.save();
  return user.toObject();
}

export { buildDefaultDatabaseName, sanitizeUser };
