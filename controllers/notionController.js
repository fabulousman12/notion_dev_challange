import {
  beginNotionOAuthFlow,
  completeNotionOAuthFlow,
  disconnectNotion,
  getNotionConnectionStatus
} from "../services/notionAuthService.js";

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
