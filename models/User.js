import mongoose from "mongoose";

const notionConfigSchema = new mongoose.Schema(
  {
    databaseName: { type: String, default: "" },
    targetId: { type: String, default: "" },
    resolvedTargetId: { type: String, default: "" },
    resolvedTargetKind: { type: String, default: "" }
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    salt: { type: String, required: true },
    passwordHash: { type: String, required: true },
    webhookKey: { type: String, required: true, unique: true, index: true },
    webhookSecret: { type: String, required: true },
    notion: { type: notionConfigSchema, required: true }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

export const User = mongoose.models.User || mongoose.model("User", userSchema);
