import { Router } from "express";
import { getRecentWorkflows } from "../controllers/workflowController.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/", requireAuth, getRecentWorkflows);

export default router;
