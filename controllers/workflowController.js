import { listWorkflows } from "../services/workflowStore.js";

export async function getRecentWorkflows(req, res, next) {
  try {
    const items = await listWorkflows(req.userId);
    res.json({ items });
  } catch (error) {
    next(error);
  }
}
