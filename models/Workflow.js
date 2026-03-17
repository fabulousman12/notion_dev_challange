import mongoose from "mongoose";

const workflowSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    user: { type: Object, required: true },
    issue: { type: Object, required: true },
    task: { type: Object, required: true },
    notion: { type: Object, required: true },
    status: { type: String, required: true },
    agent: { type: Object, required: true }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

export const Workflow = mongoose.models.Workflow || mongoose.model("Workflow", workflowSchema);
