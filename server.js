import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import authRoutes from "./routes/authRoutes.js";
import githubRoutes from "./routes/githubRoutes.js";
import notionRoutes from "./routes/notionRoutes.js";
import workflowRoutes from "./routes/workflowRoutes.js";
import { getAppConfig } from "./config/appConfig.js";
import { createRateLimitMiddleware, getRequestFingerprint } from "./middleware/rateLimitMiddleware.js";
import { connectToDatabase } from "./services/database.js";
import { listUsers } from "./services/userService.js";
import { listWorkflows } from "./services/workflowStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.resolve(__dirname, "../client/dist");

const app = express();
const config = getAppConfig();
const apiRateLimit = createRateLimitMiddleware({
  windowMs: config.security.apiRateLimitWindowMs,
  max: config.security.apiRateLimitMax,
  message: "Too many API requests. Please slow down.",
  keyPrefix: "api",
  keySelector: getRequestFingerprint
});
const webhookRateLimit = createRateLimitMiddleware({
  windowMs: config.security.webhookRateLimitWindowMs,
  max: config.security.webhookRateLimitMax,
  message: "Too many webhook deliveries. Please retry later.",
  keyPrefix: "webhook"
});

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Origin-Agent-Cluster", "?1");

  if (req.secure || req.headers["x-forwarded-proto"] === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }

  next();
});

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || !config.appOrigin || origin === config.appOrigin) {
        return callback(null, true);
      }

      return callback(new Error("Origin not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-GitHub-Event", "X-Hub-Signature-256"]
  })
);

app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buffer) => {
      req.rawBody = buffer;
    }
  })
);

app.use("/api", apiRateLimit);
app.use("/webhook", webhookRateLimit);

app.get("/api/health", async (_req, res, next) => {
  try {
    const users = await listUsers();
    const workflows = await listWorkflows();

    res.json({
      status: "ok",
      version: config.appVersion,
      aiMode: config.openAiApiKey ? "live" : "fallback",
      mcpServer: config.notion.mcpServerUrl,
      users: users.length,
      totalWorkflows: workflows.length,
      multiTenant: true,
      database: "mongodb"
    });
  } catch (error) {
    next(error);
  }
});

app.use("/api/auth", authRoutes);
app.use("/webhook", githubRoutes);
app.use("/api/workflows", workflowRoutes);
app.use("/api/notion", notionRoutes);

app.use(express.static(clientDistPath, { index: false }));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/webhook")) {
    return next();
  }

  return res.sendFile(path.join(clientDistPath, "index.html"));
});

app.use((error, _req, res, _next) => {
  console.error("Unhandled server error:", error);
  res.status(500).json({
    message: "Internal server error",
    details: error.message
  });
});

async function startServer() {
  await connectToDatabase();
  app.listen(config.port, () => {
    console.log(`AI Developer Command Center API running on port ${config.port}`);
    console.log(`Serving frontend from ${clientDistPath}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
