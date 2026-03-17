import { Router } from "express";
import {
  getCurrentUser,
  loginUser,
  registerUser,
  rotateWebhookKey,
  updateMyNotionConfig
} from "../controllers/authController.js";
import { getAppConfig } from "../config/appConfig.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { createRateLimitMiddleware, getRequestFingerprint } from "../middleware/rateLimitMiddleware.js";

const router = Router();
const config = getAppConfig();
const authRateLimit = createRateLimitMiddleware({
  windowMs: config.security.authRateLimitWindowMs,
  max: config.security.authRateLimitMax,
  message: "Too many authentication requests. Please try again shortly.",
  keyPrefix: "auth",
  keySelector: getRequestFingerprint
});

router.post("/register", authRateLimit, registerUser);
router.post("/login", authRateLimit, loginUser);
router.get("/me", requireAuth, getCurrentUser);
router.patch("/me/notion", requireAuth, updateMyNotionConfig);
router.post("/me/webhook-key/rotate", requireAuth, rotateWebhookKey);

export default router;
