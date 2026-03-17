import { Router } from "express";
import {
  getNotionStatus,
  handleNotionCallback,
  removeNotionConnection,
  startNotionConnection
} from "../controllers/notionController.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/connect", requireAuth, startNotionConnection);
router.get("/callback", handleNotionCallback);
router.get("/status", requireAuth, getNotionStatus);
router.post("/disconnect", requireAuth, removeNotionConnection);

export default router;
