import { User } from "../models/User.js";
import { connectToDatabase } from "./database.js";
import {
  generateWebhookKey,
  generateWebhookSecret,
  hashPassword,
  sanitizeUser,
  verifyPassword
} from "./authService.js";
import { getAppConfig } from "../config/appConfig.js";

function buildDefaultNotionConfig(overrides = {}) {
  const config = getAppConfig();

  return {
    targetId: overrides.targetId || overrides.databaseId || overrides.dataSourceId || "",
    resolvedTargetId: overrides.resolvedTargetId || "",
    resolvedTargetKind: overrides.resolvedTargetKind || "",
    titleProperty: overrides.titleProperty || config.notion.defaults.titleProperty,
    priorityProperty: overrides.priorityProperty || config.notion.defaults.priorityProperty,
    statusProperty: overrides.statusProperty || config.notion.defaults.statusProperty,
    statusValue: overrides.statusValue || config.notion.defaults.statusValue,
    subtasksProperty: overrides.subtasksProperty || config.notion.defaults.subtasksProperty,
    sourceProperty: overrides.sourceProperty || config.notion.defaults.sourceProperty
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

  const { salt, passwordHash } = hashPassword(password);
  const createdUser = await User.create({
    name: name?.trim() || normalizedEmail.split("@")[0],
    email: normalizedEmail,
    salt,
    passwordHash,
    webhookKey: generateWebhookKey(),
    webhookSecret: generateWebhookSecret(),
    notion: buildDefaultNotionConfig(notion)
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
  const nextTargetId = notionConfig.targetId ?? existing.targetId;
  const targetChanged = nextTargetId !== existing.targetId;

  user.notion = buildDefaultNotionConfig({
    ...existing,
    ...notionConfig,
    resolvedTargetId: targetChanged ? "" : notionConfig.resolvedTargetId ?? existing.resolvedTargetId,
    resolvedTargetKind: targetChanged ? "" : notionConfig.resolvedTargetKind ?? existing.resolvedTargetKind
  });

  await user.save();
  return user.toObject();
}

export async function saveResolvedNotionTarget(userId, resolvedTarget) {
  await connectToDatabase();
  const user = await User.findById(userId);

  if (!user) {
    throw new Error("User not found");
  }

  user.notion = buildDefaultNotionConfig({
    ...user.notion.toObject(),
    resolvedTargetId: resolvedTarget?.id || "",
    resolvedTargetKind: resolvedTarget?.kind || ""
  });

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

export { sanitizeUser };
