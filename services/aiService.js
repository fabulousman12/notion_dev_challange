import { getAppConfig } from "../config/appConfig.js";

const config = getAppConfig();
const geminiApiKey = config.geminiApiKey;
const model = config.geminiModel;

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

function extractGeminiText(data) {
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];

  return parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
}

async function requestGeminiAnalysis(issue) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [
          {
            text: "You convert GitHub issues into structured developer tasks. Return only valid JSON with keys task, priority, suggestedRole, and subtasks."
          }
        ]
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Issue title: ${issue.title}\nIssue body: ${issue.body || "No body provided"}\nRepository: ${issue.repository}\n\nReturn JSON in this format:\n{\n  \"task\": \"string\",\n  \"priority\": \"High | Medium | Normal | Low\",\n  \"suggestedRole\": \"Backend Engineer | Frontend Engineer | Full-Stack Engineer | QA Engineer | DevOps Engineer | Product Engineer\",\n  \"subtasks\": [\"string\"]\n}`
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json"
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || `Gemini request failed with status ${response.status}`);
  }

  const content = extractGeminiText(data) || "{}";
  return safeParseJson(content);
}

export async function analyzeIssue(issue) {
  if (!geminiApiKey) {
    return normalizeResult(buildFallbackTask(issue), issue);
  }

  try {
    const parsed = await requestGeminiAnalysis(issue);
    return normalizeResult(parsed, issue);
  } catch (error) {
    console.warn("AI processing failed, falling back to local parser:", error.message);
    return normalizeResult(buildFallbackTask(issue), issue);
  }
}
