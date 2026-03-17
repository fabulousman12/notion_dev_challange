import {
  beginNotionOAuthFlow,
  completeNotionOAuthFlow,
  disconnectNotion,
  getNotionConnectionStatus
} from "../services/notionAuthService.js";
import { withNotionClient } from "../services/notionMcpClient.js";
import { ensureNotionWorkspace } from "../services/notionSchemaService.js";
import { saveResolvedNotionTarget } from "../services/userService.js";

export async function startNotionConnection(req, res, next) {
  try {
    const { authorizationUrl } = await beginNotionOAuthFlow(req.userId);
    return res.redirect(302, authorizationUrl);
  } catch (error) {
    return next(error);
  }
}

export async function handleNotionCallback(req, res) {
  const { code, state, error } = req.query;

  if (error) {
    return res.status(400).send(`<h1>Notion connection failed</h1><p>${String(error)}</p>`);
  }

  if (!code || !state) {
    return res.status(400).send("Missing OAuth callback parameters");
  }

  try {
    const result = await completeNotionOAuthFlow({ code: String(code), state: String(state) });
    return res.status(200).send(
      `<h1>Notion connected</h1><p>User ${result.userId} is now connected. You can close this tab.</p>`
    );
  } catch (callbackError) {
    return res.status(500).send(
      `<h1>Notion connection failed</h1><pre>${String(callbackError.message)}</pre>`
    );
  }
}

export async function getNotionStatus(req, res, next) {
  try {
    const status = await getNotionConnectionStatus(req.userId);

    if (status.connected) {
      try {
        const workspace = await withNotionClient(req.userId, async (client) =>
          ensureNotionWorkspace(client, {
            id: req.userId,
            ...req.user,
            notion: status.notionTarget || req.user?.notion || {}
          })
        );

        await saveResolvedNotionTarget(req.userId, {
          databaseName: workspace.databaseName,
          targetId: workspace.createdDatabase?.targetId || status.notionTarget?.targetId || workspace.target.id,
          resolvedTargetId: workspace.target.id,
          resolvedTargetKind: workspace.target.kind,
          target: workspace.target
        });

        status.notionTarget = {
          ...(status.notionTarget || {}),
          databaseName: workspace.databaseName,
          targetId: workspace.createdDatabase?.targetId || status.notionTarget?.targetId || workspace.target.id,
          resolvedTargetId: workspace.target.id,
          resolvedTargetKind: workspace.target.kind
        };
        status.schema = {
          properties: workspace.properties,
          resolved: workspace.resolved,
          expectedProperties: workspace.expectedProperties,
          target: workspace.target,
          createdDatabase: workspace.createdDatabase || null
        };
      } catch (schemaError) {
        status.schema = {
          error: schemaError.message,
          properties: [],
          resolved: null,
          expectedProperties: ["Title", "Priority", "Status", "Subtasks", "Source"]
        };
      }
    }

    return res.json(status);
  } catch (error) {
    return next(error);
  }
}

export async function removeNotionConnection(req, res, next) {
  try {
    await disconnectNotion(req.userId);
    return res.json({ disconnected: true });
  } catch (error) {
    return next(error);
  }
}
