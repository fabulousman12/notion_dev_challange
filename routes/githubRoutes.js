import { Router } from "express";
import { handleGithubWebhook } from "../controllers/githubController.js";

const router = Router();

router.post("/github/:webhookKey", handleGithubWebhook);

export default router;
