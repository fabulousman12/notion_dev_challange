const REQUIRED_NOTION_PROPERTIES = {
  priority: {
    name: "Priority",
    ddl: "ADD COLUMN \"Priority\" SELECT('High':red, 'Medium':yellow, 'Normal':blue, 'Low':gray)"
  },
  status: {
    name: "Status",
    ddl: "ADD COLUMN \"Status\" SELECT('Open':gray, 'In Progress':blue, 'Done':green, 'Blocked':red)"
  },
  subtasks: {
    name: "Subtasks",
    ddl: "ADD COLUMN \"Subtasks\" RICH_TEXT"
  },
  source: {
    name: "Source",
    ddl: "ADD COLUMN \"Source\" URL"
  }
};

function extractTextBlocks(result) {
  return (result.content || [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function normalizeType(value) {
  if (!value) {
    return "";
  }

  return String(value).toLowerCase();
}

function looksLikePropertyObject(value) {
  return Boolean(value && typeof value === "object" && (value.type || value.name));
}

function collectPropertyObjects(value, results = []) {
  if (!value || typeof value !== "object") {
    return results;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectPropertyObjects(item, results));
    return results;
  }

  if (value.properties && typeof value.properties === "object") {
    Object.entries(value.properties).forEach(([fallbackName, propertyValue]) => {
      if (looksLikePropertyObject(propertyValue)) {
        results.push({
          id: propertyValue.id || fallbackName,
          name: propertyValue.name || fallbackName,
          type: normalizeType(propertyValue.type)
        });
      }
    });
  }

  Object.values(value).forEach((child) => collectPropertyObjects(child, results));
  return results;
}

function uniqueProperties(properties) {
  const seen = new Map();

  properties.forEach((property) => {
    if (!property?.name) {
      return;
    }

    const key = property.name.toLowerCase();

    if (!seen.has(key)) {
      seen.set(key, property);
    }
  });

  return Array.from(seen.values());
}

function parsePropertiesFromText(text) {
  const matches = Array.from(text.matchAll(/"name"\s*:\s*"([^"]+)"\s*,\s*"type"\s*:\s*"([^"]+)"/g));

  return uniqueProperties(
    matches.map((match) => ({
      id: match[1],
      name: match[1],
      type: normalizeType(match[2])
    }))
  );
}

function findByName(properties, targetName) {
  const normalizedTarget = targetName.toLowerCase();
  return properties.find((property) => property.name.toLowerCase() === normalizedTarget) || null;
}

function findByType(properties, targetType) {
  return properties.find((property) => property.type === targetType) || null;
}

function findByKeywords(properties, keywords, allowedTypes = []) {
  const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase());

  return (
    properties.find((property) => {
      const name = property.name.toLowerCase();
      const keywordMatch = normalizedKeywords.some((keyword) => name.includes(keyword));
      const typeMatch = allowedTypes.length === 0 || allowedTypes.includes(property.type);
      return keywordMatch && typeMatch;
    }) || null
  );
}

function buildResolvedSchema(properties) {
  const titleProperty =
    findByType(properties, "title") ||
    findByName(properties, "Task") ||
    findByName(properties, "Name") ||
    findByName(properties, "Title");

  return {
    titleProperty: titleProperty?.name || "Name",
    priorityProperty:
      findByName(properties, "Priority")?.name ||
      findByKeywords(properties, ["priority"], ["select", "status", "rich_text", "text"] )?.name ||
      REQUIRED_NOTION_PROPERTIES.priority.name,
    statusProperty:
      findByName(properties, "Status")?.name ||
      findByKeywords(properties, ["status", "state"], ["select", "status", "rich_text", "text"] )?.name ||
      REQUIRED_NOTION_PROPERTIES.status.name,
    subtasksProperty:
      findByName(properties, "Subtasks")?.name ||
      findByKeywords(properties, ["subtask", "tasks", "notes"], ["rich_text", "text"] )?.name ||
      REQUIRED_NOTION_PROPERTIES.subtasks.name,
    sourceProperty:
      findByName(properties, "Source")?.name ||
      findByKeywords(properties, ["source", "url", "link", "github"], ["url", "rich_text", "text"] )?.name ||
      REQUIRED_NOTION_PROPERTIES.source.name,
    availableProperties: properties
  };
}

function buildMissingStatements(schema, properties) {
  const statements = [];
  const propertyNames = new Set(properties.map((property) => property.name.toLowerCase()));

  Object.values(REQUIRED_NOTION_PROPERTIES).forEach((definition) => {
    if (!propertyNames.has(definition.name.toLowerCase())) {
      statements.push(definition.ddl);
    }
  });

  if (!findByType(properties, "title")) {
    throw new Error("Notion data source is missing a title property and cannot be used");
  }

  return statements;
}

async function callOptionalTool(client, toolName, args) {
  const toolList = await client.listTools();
  const tool = toolList.tools.find((candidate) => candidate.name === toolName);

  if (!tool) {
    return null;
  }

  return client.callTool({
    name: toolName,
    arguments: args
  });
}

export async function inspectNotionSchema(client, targetId) {
  const result = await callOptionalTool(client, "notion-fetch", { id: targetId });

  if (!result) {
    return {
      properties: [],
      resolved: buildResolvedSchema([]),
      rawText: ""
    };
  }

  const structuredProperties = uniqueProperties(collectPropertyObjects(result.structuredContent));
  const text = extractTextBlocks(result);
  const textProperties = parsePropertiesFromText(text);
  const properties = uniqueProperties([...structuredProperties, ...textProperties]);

  return {
    properties,
    resolved: buildResolvedSchema(properties),
    rawText: text
  };
}

export async function ensureNotionSchema(client, targetId) {
  let inspection = await inspectNotionSchema(client, targetId);
  const statements = buildMissingStatements(inspection.resolved, inspection.properties);

  if (statements.length > 0) {
    const updateResult = await callOptionalTool(client, "notion-update-data-source", {
      data_source_id: targetId,
      statements: statements.join("; ")
    });

    if (updateResult) {
      inspection = await inspectNotionSchema(client, targetId);
    }
  }

  return {
    ...inspection,
    expectedProperties: Object.values(REQUIRED_NOTION_PROPERTIES).map((definition) => definition.name)
  };
}
