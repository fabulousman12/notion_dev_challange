import { NotionConnectionRequiredError } from "../services/notionMcpClient.js";
import { analyzeIssue } from "../services/aiService.js";
import { createNotionTask } from "../services/notionService.js";
import { findUserByWebhookKey, sanitizeUser } from "../services/userService.js";
import { addWorkflow } from "../services/workflowStore.js";
import { verifyGithubSignature } from "../utils/githubSignature.js";

const supportedActions = new Set(["opened", "edited", "reopened"]);

export async function handleGithubWebhook(req, res, next) {
  try {
    const event = req.headers["x-github-event"];
    const signature = req.headers["x-hub-signature-256"];
    const webhookKey = req.params.webhookKey;
    const user = await findUserByWebhookKey(webhookKey);

    if (!user) {
      return res.status(404).json({ message: "Unknown webhook target" });
    }

    if (!user.webhookSecret) {
      return res.status(409).json({ message: "Webhook secret is not configured for this user" });
    }

    if (!verifyGithubSignature(req.rawBody, signature, user.webhookSecret)) {
      return res.status(401).json({ message: "Invalid GitHub webhook signature" });
    }

    if (event !== "issues") {
      return res.status(202).json({ message: "Ignored non-issue event" });
    }

    const { action, issue, repository } = req.body;

    if (!supportedActions.has(action)) {
      return res.status(202).json({ message: `Ignored issue action: ${action}` });
    }

    const issuePayload = {
      id: issue?.id,
      number: issue?.number,
      title: issue?.title || "Untitled issue",
      body: issue?.body || "",
      url: issue?.html_url || "",
      repository: repository?.full_name || "unknown/repository"
    };

    const aiResult = await analyzeIssue(issuePayload);
    const notionPage = await createNotionTask(user, aiResult, issuePayload);

    const workflow = await addWorkflow({
      userId: user.id,
      user: sanitizeUser(user),
      issue: issuePayload,
      task: aiResult,
      notion: notionPage,
      status: notionPage.mode === "live" ? "synced" : "mocked",
      agent: {
        provider: process.env.OPENAI_API_KEY ? "openai" : "fallback",
        mcpServer: process.env.NOTION_MCP_SERVER_URL || "https://mcp.notion.com/mcp"
      }
    });

    return res.status(201).json({
      message: "GitHub issue processed successfully",
      workflow
    });
  } catch (error) {
    if (error instanceof NotionConnectionRequiredError) {
      return res.status(409).json({
        message: error.message
      });
    }

    return next(error);
  }
}
