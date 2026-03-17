import { Workflow } from "../models/Workflow.js";
import { connectToDatabase } from "./database.js";

export async function addWorkflow(workflow) {
  await connectToDatabase();
  const createdWorkflow = await Workflow.create(workflow);
  const object = createdWorkflow.toObject();

  return {
    id: String(object._id),
    createdAt: object.createdAt,
    ...object
  };
}

export async function listWorkflows(userId) {
  await connectToDatabase();
  const query = userId ? { userId } : {};
  const items = await Workflow.find(query).sort({ createdAt: -1 }).limit(userId ? 20 : 50).lean();

  return items.map((item) => ({
    id: String(item._id),
    createdAt: item.createdAt,
    ...item
  }));
}
