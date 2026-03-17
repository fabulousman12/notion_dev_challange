import mongoose from "mongoose";

const authStateSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    encryptedState: { type: String, required: true }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

export const NotionAuthState =
  mongoose.models.NotionAuthState || mongoose.model("NotionAuthState", authStateSchema);
