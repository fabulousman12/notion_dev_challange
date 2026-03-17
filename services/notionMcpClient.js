import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getAppConfig } from "../config/appConfig.js";
import { ensureFreshNotionTokens } from "./notionAuthService.js";
import { PersistentNotionOAuthProvider } from "./notionOAuthProvider.js";

export class NotionConnectionRequiredError extends Error {
  constructor(message = "Notion MCP authorization required") {
    super(message);
    this.name = "NotionConnectionRequiredError";
  }
}

export async function withNotionClient(userId, callback) {
  const config = getAppConfig();
  const provider = new PersistentNotionOAuthProvider(userId);
  await ensureFreshNotionTokens(userId);

  if (!(await provider.tokens())) {
    throw new NotionConnectionRequiredError(
      "Notion MCP is not connected for this user. Visit /api/notion/connect to authorize."
    );
  }

  const client = new Client(
    {
      name: `ai-developer-command-center-${userId}`,
      version: config.appVersion
    },
    {
      capabilities: {}
    }
  );

  const transport = new StreamableHTTPClientTransport(new URL(config.notion.mcpServerUrl), {
    authProvider: provider
  });

  try {
    await client.connect(transport);
    return await callback(client);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw new NotionConnectionRequiredError(
        "Stored Notion MCP credentials are no longer valid for this user. Reconnect at /api/notion/connect."
      );
    }

    throw error;
  } finally {
    await transport.close().catch(() => undefined);
  }
}
