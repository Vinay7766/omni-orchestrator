/**
 * The agent channel (ARCHITECTURE 5): an MCP server any MCP-capable tool can start.
 * Transport-free: main.ts connects it over stdio, tests over an in-memory pair.
 * API per @modelcontextprotocol/sdk 1.32.1 (McpServer.registerTool with input/output schemas).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import { buildContext, type ContextDeps } from "./context.js";
import { getPhaseSkills } from "./phase-tools.js";
import { SERVER_INFO } from "./info.js";

const task = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["todo", "designed", "in_progress", "done"]),
  designNote: z.string().optional(),
  trivialReason: z.string().optional(),
  assignedTool: z.string().optional(),
});

const contextShape = {
  project: z.object({
    id: z.string(),
    name: z.string(),
    flow: z.string(),
    mode: z.string(),
    root: z.string(),
    linkedFrom: z.string().optional(),
  }),
  phase: z.object({ id: z.string().nullable(), status: z.string().nullable() }),
  tasks: z.object({ inProgress: z.array(task), next: task.nullable(), done: z.number(), total: z.number() }),
  summary: z.string(),
  recentDecisions: z.array(z.object({ title: z.string(), decision: z.string(), reason: z.string(), time: z.string() })),
  lessons: z.array(z.string()),
  skills: z.array(
    z.object({ id: z.string(), name: z.string(), description: z.string(), reason: z.enum(["phase", "all-phases"]) }),
  ),
  warnings: z.array(z.string()),
};

const projectPathInput = z
  .string()
  .min(1)
  .optional()
  .describe("Project folder, if the server was not started inside it. Absolute, or relative to where the server started.");

const errorResult = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

export function createServer(deps: ContextDeps): McpServer {
  const server = new McpServer({ name: SERVER_INFO.name, version: SERVER_INFO.version });

  server.registerTool(
    "get_context",
    {
      title: "Get project context",
      description:
        "Call this first. Returns the project's summary, current phase and its status, tasks in progress and the next task, " +
        "recent decisions, lessons every tool must apply, and the current phase's skills (descriptions; full text comes " +
        "from get_phase_skills). Reads only; changes nothing.",
      inputSchema: {
        projectPath: projectPathInput,
      },
      outputSchema: contextShape,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ projectPath }) =>
      toolResult("get_context", async () => {
        const result = await buildContext(deps, projectPath === undefined ? {} : { projectPath });
        return result.ok ? { ok: true as const, value: result.context } : result;
      }),
  );

  server.registerTool(
    "get_phase_skills",
    {
      title: "Get the current phase's skills",
      description:
        "Full instructions of the skills for the current phase only (never the whole catalog). Read and follow them; " +
        "when you submit the phase, list each skill you used with evidence. Pass ids to load only some of them.",
      inputSchema: {
        projectPath: projectPathInput,
        ids: z.array(z.string().min(1)).min(1).optional().describe("Load only these skills (they must belong to the current phase)."),
      },
      outputSchema: {
        phase: z.string(),
        skills: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            reason: z.enum(["phase", "all-phases"]),
            license: z.string(),
            content: z.string(),
          }),
        ),
        warnings: z.array(z.string()),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ projectPath, ids }) =>
      toolResult("get_phase_skills", () => getPhaseSkills(deps, { projectPath, ...(ids ? { ids } : {}) })),
  );

  return server;
}

/** A core result as an MCP tool result: data as structuredContent and text, or an actionable error. */
async function toolResult<T extends object>(
  name: string,
  run: () => Promise<{ ok: true; value: T } | { ok: false; message: string }>,
) {
  try {
    const result = await run();
    if (!result.ok) return errorResult(result.message);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }],
      structuredContent: { ...result.value } as Record<string, unknown>,
    };
  } catch (error) {
    // Message only: stack traces are not useful to the agent and can leak local paths.
    return errorResult(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
