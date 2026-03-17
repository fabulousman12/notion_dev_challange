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

const DEFAULT_EXPECTED_PROPERTIES = [
  "Title",
  ...Object.values(REQUIRED_NOTION_PROPERTIES).map((definition) => definition.name)
];

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

function normalizeId(id) {
  return String(id || "").trim();
}

function stripCollectionPrefix(id) {
  return normalizeId(id).replace(/^collection:\/\//i, "");
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
      findByKeywords(properties, ["priority"], ["select", "status", "rich_text", "text"])?.name ||
      REQUIRED_NOTION_PROPERTIES.priority.name,
    statusProperty:
      findByName(properties, "Status")?.name ||
      findByKeywords(properties, ["status", "state"], ["select", "status", "rich_text", "text"])?.name ||
      REQUIRED_NOTION_PROPERTIES.status.name,
    subtasksProperty:
      findByName(properties, "Subtasks")?.name ||
      findByKeywords(properties, ["subtask", "tasks", "notes"], ["rich_text", "text"])?.name ||
      REQUIRED_NOTION_PROPERTIES.subtasks.name,
    sourceProperty:
      findByName(properties, "Source")?.name ||
      findByKeywords(properties, ["source", "url", "link", "github"], ["url", "rich_text", "text"])?.name ||
      REQUIRED_NOTION_PROPERTIES.source.name,
    availableProperties: properties
  };
}

function buildMissingStatements(properties) {
  const statements = [];
  const propertyNames = new Set(properties.map((property) => property.name.toLowerCase()));

  Object.values(REQUIRED_NOTION_PROPERTIES).forEach((definition) => {
    if (!propertyNames.has(definition.name.toLowerCase())) {
      statements.push(definition.ddl);
    }
  });

  if (!findByType(properties, "title")) {
    throw new Error("Notion target could not be resolved to a usable data source with a title property");
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

function extractCollectionIds(text) {
  return Array.from(text.matchAll(/collection:\/\/([0-9a-f-]{32,36})/gi)).map((match) => stripCollectionPrefix(match[1]));
}

function extractDatabaseIds(text) {
  return Array.from(text.matchAll(/(?<!collection:\/\/)([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f-]{27})/gi)).map((match) => normalizeId(match[1]));
}

function buildTargetVariants(targetId, text) {
  const normalized = normalizeId(targetId);
  const variants = [];
  const seen = new Set();

  function add(value, kind) {
    const id = normalizeId(value);

    if (!id || seen.has(id)) {
      return;
    }

    seen.add(id);
    variants.push({
      raw: id,
      fetchId: kind === "data_source_id" && !/^collection:\/\//i.test(id) ? `collection://${id}` : id,
      id: stripCollectionPrefix(id),
      kind
    });
  }

  add(normalized, "database_id");
  add(`collection://${stripCollectionPrefix(normalized)}`, "data_source_id");
  extractCollectionIds(text || "").forEach((id) => add(id, "data_source_id"));

  return variants;
}

async function fetchTargetSnapshot(client, id) {
  const result = await callOptionalTool(client, "notion-fetch", { id });
  return {
    result,
    text: result ? extractTextBlocks(result) : ""
  };
}

function buildInspectionFromSnapshot(snapshot, target) {
  const structuredProperties = snapshot.result
    ? uniqueProperties(collectPropertyObjects(snapshot.result.structuredContent))
    : [];
  const textProperties = parsePropertiesFromText(snapshot.text);
  const properties = uniqueProperties([...structuredProperties, ...textProperties]);

  return {
    properties,
    resolved: buildResolvedSchema(properties),
    rawText: snapshot.text,
    target
  };
}

export async function resolveNotionTarget(client, targetId) {
  const initial = await fetchTargetSnapshot(client, targetId);
  const variants = buildTargetVariants(targetId, initial.text);
  let fallbackInspection = null;

  for (const variant of variants) {
    const snapshot = variant.fetchId === normalizeId(targetId) ? initial : await fetchTargetSnapshot(client, variant.fetchId);
    const inspection = buildInspectionFromSnapshot(snapshot, variant);

    if (!fallbackInspection) {
      fallbackInspection = inspection;
    }

    if (findByType(inspection.properties, "title")) {
      return inspection;
    }
  }

  return fallbackInspection || {
    properties: [],
    resolved: buildResolvedSchema([]),
    rawText: "",
    target: {
      raw: targetId,
      fetchId: targetId,
      id: stripCollectionPrefix(targetId),
      kind: "database_id"
    }
  };
}

function buildCreateDatabaseSchema() {
  return `CREATE TABLE ("Task" TITLE, "Priority" SELECT('High':red, 'Medium':yellow, 'Normal':blue, 'Low':gray), "Status" SELECT('Open':gray, 'In Progress':blue, 'Done':green, 'Blocked':red), "Subtasks" RICH_TEXT, "Source" URL)`;
}

function buildDefaultDatabaseName(user) {
  return user?.notion?.databaseName || `${user?.name || "User"} AI Developer Tasks`;
}

function parseCreatedDatabaseTarget(result, databaseName) {
  const text = extractTextBlocks(result);
  const collectionId = extractCollectionIds(text)[0] || "";
  const databaseId = extractDatabaseIds(text)[0] || "";

  return {
    databaseName,
    targetId: databaseId || collectionId,
    resolvedTargetId: collectionId || databaseId,
    resolvedTargetKind: collectionId ? "data_source_id" : "database_id",
    rawText: text
  };
}

export async function createNotionTaskDatabase(client, user) {
  const databaseName = buildDefaultDatabaseName(user);
  const result = await callOptionalTool(client, "notion-create-database", {
    title: databaseName,
    schema: buildCreateDatabaseSchema()
  });

  if (!result) {
    throw new Error("The connected Notion MCP server did not expose notion-create-database");
  }

  return parseCreatedDatabaseTarget(result, databaseName);
}

async function findExistingDatabaseTarget(client, databaseName) {
  const result = await callOptionalTool(client, "notion-search", {
    query: databaseName,
    query_type: "internal",
    page_size: 10,
    max_highlight_length: 0
  });

  if (!result) {
    return null;
  }

  const text = extractTextBlocks(result);
  const seen = new Set();
  const candidateIds = [
    ...extractCollectionIds(text).map((id) => ({ id, kind: "data_source_id" })),
    ...extractDatabaseIds(text).map((id) => ({ id, kind: "database_id" }))
  ].filter((candidate) => {
    const key = `${candidate.kind}:${candidate.id}`;

    if (!candidate.id || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });

  for (const candidate of candidateIds) {
    const inspection = await resolveNotionTarget(
      client,
      candidate.kind === "data_source_id" ? `collection://${candidate.id}` : candidate.id
    );

    if (findByType(inspection.properties, "title")) {
      return {
        ...inspection,
        databaseName,
        expectedProperties: DEFAULT_EXPECTED_PROPERTIES
      };
    }
  }

  return null;
}

export async function ensureNotionWorkspace(client, user) {
  const configuredTarget = user?.notion?.resolvedTargetId || user?.notion?.targetId;

  if (!configuredTarget) {
    const existing = await findExistingDatabaseTarget(client, buildDefaultDatabaseName(user));

    if (existing) {
      return existing;
    }

    const created = await createNotionTaskDatabase(client, user);
    const inspection = await resolveNotionTarget(client, created.resolvedTargetId || created.targetId);

    return {
      ...inspection,
      databaseName: created.databaseName,
      expectedProperties: DEFAULT_EXPECTED_PROPERTIES,
      target: {
        id: created.resolvedTargetId || created.targetId,
        kind: created.resolvedTargetKind,
        raw: created.resolvedTargetId || created.targetId,
        fetchId:
          created.resolvedTargetKind === "data_source_id"
            ? `collection://${created.resolvedTargetId}`
            : created.targetId
      },
      createdDatabase: created
    };
  }

  let inspection = await resolveNotionTarget(client, configuredTarget);
  const statements = buildMissingStatements(inspection.properties);

  if (statements.length > 0 && inspection.target.kind === "data_source_id") {
    const updateResult = await callOptionalTool(client, "notion-update-data-source", {
      data_source_id: inspection.target.id,
      statements: statements.join("; ")
    });

    if (updateResult) {
      inspection = await resolveNotionTarget(client, inspection.target.id);
    }
  }

  return {
    ...inspection,
    databaseName: buildDefaultDatabaseName(user),
    expectedProperties: DEFAULT_EXPECTED_PROPERTIES,
    createdDatabase: null
  };
}
