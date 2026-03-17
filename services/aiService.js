import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
const model = process.env.OPENAI_MODEL || "gpt-5.1";

function safeParseJson(content) {
  const cleaned = content.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

function inferPriority(text) {
  const source = text.toLowerCase();

  if (source.includes("critical") || source.includes("fails") || source.includes("urgent")) {
    return "High";
  }

  if (source.includes("improve") || source.includes("enhancement")) {
    return "Medium";
  }

  return "Normal";
}

function buildFallbackSubtasks(issue) {
  return [
    "Review the reported issue details",
    `Reproduce issue #${issue.number || "N/A"} locally`,
    "Implement the required fix or improvement",
    "Verify behavior and add tests"
  ];
}

function buildFallbackTask(issue) {
  return {
    task: issue.title
      .replace(/^bug:\s*/i, "Fix ")
      .replace(/^feature:\s*/i, "Implement ")
      .trim(),
    priority: inferPriority(`${issue.title} ${issue.body}`),
    suggestedRole: "Backend Engineer",
    subtasks: buildFallbackSubtasks(issue)
  };
}

function normalizeResult(result, issue) {
  return {
    task: result.task || buildFallbackTask(issue).task,
    priority: result.priority || inferPriority(`${issue.title} ${issue.body}`),
    suggestedRole: result.suggestedRole || "Backend Engineer",
    subtasks:
      Array.isArray(result.subtasks) && result.subtasks.length > 0
        ? result.subtasks
        : buildFallbackSubtasks(issue)
  };
}

export async function analyzeIssue(issue) {
  if (!openai) {
    return normalizeResult(buildFallbackTask(issue), issue);
  }

  try {
    const response = await openai.chat.completions.create({
      model,
      response_format: {
        type: "json_object"
      },
      messages: [
        {
          role: "system",
          content:
            "You convert GitHub issues into structured developer tasks. Return only valid JSON with keys task, priority, suggestedRole, and subtasks."
        },
        {
          role: "user",
          content: `Issue title: ${issue.title}
Issue body: ${issue.body || "No body provided"}
Repository: ${issue.repository}

Return JSON in this format:
{
  "task": "string",
  "priority": "High | Medium | Normal | Low",
  "suggestedRole": "Backend Engineer | Frontend Engineer | Full-Stack Engineer | QA Engineer | DevOps Engineer | Product Engineer",
  "subtasks": ["string"]
}`
        }
      ]
    });

    const content = response.choices[0]?.message?.content || "{}";
    const parsed = safeParseJson(content);

    return normalizeResult(parsed, issue);
  } catch (error) {
    console.warn("AI processing failed, falling back to local parser:", error.message);
    return normalizeResult(buildFallbackTask(issue), issue);
  }
}
