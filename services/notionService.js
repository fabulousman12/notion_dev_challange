import { withNotionClient } from "./notionMcpClient.js";
import { ensureNotionWorkspace } from "./notionSchemaService.js";
import { saveResolvedNotionTarget } from "./userService.js";

function buildPageContent(task, issue) {
  const subtaskLines = task.subtasks.map((subtask) => `- ${subtask}`).join("\n");

  return [
    "## AI Issue Breakdown",
    `Suggested role: ${task.suggestedRole}`,
    `Repository: ${issue.repository}`,
    `Issue: #${issue.number}`,
    "",
    "## Suggested Subtasks",
    subtaskLines
  ].join("\n");
}

function buildParentObject(workspace) {
  if (workspace.target.kind === "data_source_id") {
    return {
      data_source_id: workspace.target.id
    };
  }

  return {
    database_id: workspace.target.id
  };
}

function buildPagePayload(task, issue, resolvedSchema) {
  return {
    properties: {
      [resolvedSchema.titleProperty]: task.task,
      [resolvedSchema.priorityProperty]: task.priority,
      [resolvedSchema.statusProperty]: "Open",
      [resolvedSchema.subtasksProperty]: task.subtasks.join(" | "),
      [resolvedSchema.sourceProperty]: issue.url
    },
    content: buildPageContent(task, issue)
  };
}

function buildCreateToolArguments(tool, pagePayload, workspace) {
  const properties = tool?.inputSchema?.properties || {};
  const args = {};

  if (properties.parent) {
    args.parent = buildParentObject(workspace);
  }

  if (properties.pages) {
    args.pages = [pagePayload];
    return args;
  }

  if (properties.page) {
    args.page = pagePayload;
    return args;
  }

  return {
    ...args,
    ...pagePayload
  };
}

function extractFromStructuredContent(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (typeof value.url === "string") {
    return { url: value.url, id: value.id || value.pageId || null };
  }

  if (typeof value.id === "string") {
    return { url: value.url || "", id: value.id };
  }

  if (Array.isArray(value.results) && value.results[0]) {
    return extractFromStructuredContent(value.results[0]);
  }

  if (Array.isArray(value.pages) && value.pages[0]) {
    return extractFromStructuredContent(value.pages[0]);
  }

  return null;
}

function extractTextBlocks(result) {
  return (result.content || [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function normalizeNotionUrl(url, id) {
  if (typeof url === "string" && /^https?:\/\//i.test(url)) {
    return url;
  }

  const rawId = typeof id === "string" ? id.trim() : "";
  const compactId = rawId.replace(/-/g, "");

  if (/^[a-f0-9]{32}$/i.test(compactId)) {
    return `https://www.notion.so/${compactId}`;
  }

  return "";
}

function parseEmbeddedError(text) {
  if (!text) {
    return null;
  }

  if (/^MCP error/i.test(text)) {
    return text;
  }

  try {
    const parsed = JSON.parse(text);
    const body = typeof parsed.body === "string" ? JSON.parse(parsed.body) : parsed.body;
    return body?.message || parsed.message || null;
  } catch {
    return null;
  }
}

function parseCreatePageResult(result) {
  const text = extractTextBlocks(result);
  const embeddedError = parseEmbeddedError(text);

  if (embeddedError) {
    throw new Error(embeddedError);
  }

  const structured = extractFromStructuredContent(result.structuredContent);
  const urlMatch = text.match(/https?:\/\/[^\s]+/);
  const pageId = structured?.id || `mcp-${Date.now()}`;
  const pageUrl = normalizeNotionUrl(structured?.url || urlMatch?.[0] || "", pageId);

  if (!pageUrl) {
    throw new Error("Notion MCP did not return a page URL");
  }

  return {
    id: pageId,
    url: pageUrl,
    mode: "live",
    toolUsed: "notion-create-pages",
    rawText: text
  };
}

export async function createNotionTask(user, task, issue) {
  return withNotionClient(String(user.id || user._id), async (client) => {
    const toolList = await client.listTools();
    const createTool = toolList.tools.find((tool) => tool.name === "notion-create-pages");

    if (!createTool) {
      throw new Error("The connected Notion MCP server did not expose notion-create-pages");
    }

    const workspace = await ensureNotionWorkspace(client, user);
    await saveResolvedNotionTarget(String(user.id || user._id), {
      databaseName: workspace.databaseName,
      targetId: workspace.createdDatabase?.targetId || user?.notion?.targetId || workspace.target.id,
      resolvedTargetId: workspace.target.id,
      resolvedTargetKind: workspace.target.kind,
      target: workspace.target
    });

    const pagePayload = buildPagePayload(task, issue, workspace.resolved);
    const result = await client.callTool({
      name: createTool.name,
      arguments: buildCreateToolArguments(createTool, pagePayload, workspace)
    });

    return parseCreatePageResult(result);
  });
}
