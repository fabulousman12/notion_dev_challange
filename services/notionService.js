import { withNotionClient } from "./notionMcpClient.js";

function buildParentObject(user) {
  return {
    database_id: user.notion.targetId
  };
}

function buildPagePayload(task, issue, user) {
  return {
    parent: buildParentObject(user),
    properties: {
      [user.notion.titleProperty]: {
        title: [
          {
            text: {
              content: task.task
            }
          }
        ]
      },
      [user.notion.priorityProperty]: {
        select: {
          name: task.priority
        }
      },
      [user.notion.statusProperty]: {
        select: {
          name: user.notion.statusValue
        }
      },
      [user.notion.subtasksProperty]: {
        rich_text: [
          {
            text: {
              content: task.subtasks.join(" | ")
            }
          }
        ]
      },
      [user.notion.sourceProperty]: {
        url: issue.url
      }
    },
    children: [
      {
        object: "block",
        type: "heading_2",
        heading_2: {
          rich_text: [{ type: "text", text: { content: "AI Issue Breakdown" } }]
        }
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: `Suggested role: ${task.suggestedRole}` } }]
        }
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: { content: `Repository: ${issue.repository} | Issue #${issue.number}` }
            }
          ]
        }
      },
      ...task.subtasks.map((subtask) => ({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [{ type: "text", text: { content: subtask } }]
        }
      }))
    ]
  };
}

function buildCreateToolArguments(tool, pagePayload) {
  const properties = tool?.inputSchema?.properties || {};

  if (properties.pages) {
    return { pages: [pagePayload] };
  }

  if (properties.page) {
    return { page: pagePayload };
  }

  return pagePayload;
}

function extractFromStructuredContent(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (typeof value.url === "string") {
    return { url: value.url, id: value.id || value.pageId || null };
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

function parseCreatePageResult(result) {
  const structured = extractFromStructuredContent(result.structuredContent);
  const text = extractTextBlocks(result);
  const urlMatch = text.match(/https?:\/\/[^\s]+/);

  return {
    id: structured?.id || `mcp-${Date.now()}`,
    url: structured?.url || urlMatch?.[0] || "",
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

  return withNotionClient(user.id, async (client) => {
    const toolList = await client.listTools();
    const createTool = toolList.tools.find((tool) => tool.name === "notion-create-pages");

    if (!createTool) {
      throw new Error("The connected Notion MCP server did not expose notion-create-pages");
    }

    const pagePayload = buildPagePayload(task, issue, user);
    const result = await client.callTool({
      name: createTool.name,
      arguments: buildCreateToolArguments(createTool, pagePayload)
    });

    return parseCreatePageResult(result);
  });
}
