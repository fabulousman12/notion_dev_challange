import { withNotionClient } from "./notionMcpClient.js";

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

function buildPagePayload(task, issue, user) {
  return {
    properties: {
      [user.notion.titleProperty]: task.task,
      [user.notion.priorityProperty]: task.priority,
      [user.notion.statusProperty]: user.notion.statusValue,
      [user.notion.subtasksProperty]: task.subtasks.join(" | "),
      [user.notion.sourceProperty]: issue.url
    },
    content: buildPageContent(task, issue)
  };
}

function buildCreateToolArguments(tool, pagePayload, user) {
  const properties = tool?.inputSchema?.properties || {};
  const args = {};

  if (properties.parent) {
    args.parent = user.notion.targetId;
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

function parseCreatePageResult(result) {
  const text = extractTextBlocks(result);

  if (/^MCP error/i.test(text)) {
    throw new Error(text);
  }

  const structured = extractFromStructuredContent(result.structuredContent);
  const urlMatch = text.match(/https?:\/\/[^\s]+/);
  const pageId = structured?.id || `mcp-${Date.now()}`;
  const pageUrl = normalizeNotionUrl(structured?.url || urlMatch?.[0] || "", pageId);

  return {
    id: pageId,
    url: pageUrl,
    mode: "live",
    toolUsed: "notion-create-pages",
    rawText: text
  };
}

export async function createNotionTask(user, task, issue) {
  const hasTarget = Boolean(user.notion.targetId);

  if (!hasTarget) {
    return {
      id: `mock-${issue.id || Date.now()}`,
      url: `https://notion.so/mock-${issue.number || "task"}`,
      mode: "mock",
      toolUsed: "mock-notion-create-pages"
    };
  }

  return withNotionClient(String(user.id || user._id), async (client) => {
    const toolList = await client.listTools();
    const createTool = toolList.tools.find((tool) => tool.name === "notion-create-pages");

    if (!createTool) {
      throw new Error("The connected Notion MCP server did not expose notion-create-pages");
    }

    const pagePayload = buildPagePayload(task, issue, user);
    const result = await client.callTool({
      name: createTool.name,
      arguments: buildCreateToolArguments(createTool, pagePayload, user)
    });

    return parseCreatePageResult(result);
  });
}
