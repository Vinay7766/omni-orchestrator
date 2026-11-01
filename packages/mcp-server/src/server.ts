/**
 * The agent channel (ARCHITECTURE 5): an MCP server any MCP-capable tool can start.
 * Transport-free: main.ts connects it over stdio, tests over an in-memory pair.
 * API per @modelcontextprotocol/sdk 1.32.1 (McpServer.registerTool with input/output schemas).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import { buildContext, type ContextDeps } from "./context.js";
import { getPhaseSkills, submitPhase } from "./phase-tools.js";
import { createTasks, markTaskTrivial, submitDesignNote } from "./task-tools.js";
import type { Event } from "@omni/core";
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

const projectFile = z.string().min(1).describe("Project-relative path, forward slashes.");

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

  server.registerTool(
    "submit_phase",
    {
      title: "Submit the phase for review",
      description:
        "Hand the current phase in for the user's review. Include the documents you produced, every skill you used with " +
        "evidence, the files you updated in the project memory (memoryUpdate), and for planning phases the confirmed " +
        "Understanding check. Afterwards show the user the documents and the returned reviewQuestion. Only the user can " +
        "approve or request changes, in the OmniOrchestrator app or extension; there is no tool for that.",
      inputSchema: {
        projectPath: projectPathInput,
        phase: z.string().min(1).describe("The phase being submitted, e.g. the current phase from get_context."),
        documents: z.array(projectFile).min(1).describe("Documents produced in this phase."),
        skillsUsed: z
          .array(z.object({ skill: z.string().min(1), evidence: z.string().min(1) }))
          .min(1)
          .describe("Each skill followed, with concrete evidence of how (a name alone is not enough)."),
        understandingCheck: projectFile.optional().describe("File with the user-confirmed Understanding check (planning phases)."),
        memoryUpdate: z
          .object({ files: z.array(projectFile).min(1) })
          .optional()
          .describe("Memory files updated for this phase. Needed unless the memory update was already recorded."),
        model: z.string().min(1).max(200).optional().describe("The model doing the work, recorded with the submission."),
      },
      outputSchema: {
        phase: z.string(),
        status: z.literal("awaiting_review"),
        eventId: z.string(),
        reviewQuestion: z.string(),
        warning: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ model, ...input }) =>
      toolResult("submit_phase", () => submitPhase(deps, agentActor(server, model), input)),
  );

  server.registerTool(
    "create_tasks",
    {
      title: "Create build tasks",
      description:
        "Create the build tasks from the approved architecture, in order. The whole list is checked first: if any task is " +
        "rejected (repeated or existing id, phase under review), none are created.",
      inputSchema: {
        projectPath: projectPathInput,
        tasks: z
          .array(
            z.object({
              taskId: z.string().regex(/^[A-Za-z0-9._:-]{1,200}$/).describe("Short id, e.g. T-1."),
              title: z.string().min(1).max(300),
              requirements: z.array(z.string().min(1)).optional().describe("Requirement ids this task delivers."),
            }),
          )
          .min(1),
      },
      outputSchema: { created: z.array(z.string()) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ projectPath, tasks }) =>
      toolResult("create_tasks", () => createTasks(deps, agentActor(server), { projectPath, tasks })),
  );

  server.registerTool(
    "submit_design_note",
    {
      title: "Submit a task's design note",
      description:
        "Attach the design note a coding task needs before it can start (solution-design). Fields: formatVersion 1, " +
        "taskId, problem, constraints[], approaches[{name, idea, complexity, risks}] (two or more, or singleApproachReason), " +
        "chosen, reason, switchIf, edgeCases[], generalisationCheck, assumptions[]. Invalid notes are rejected with the " +
        "problems listed and nothing saved.",
      inputSchema: {
        projectPath: projectPathInput,
        note: z.record(z.string(), z.unknown()).describe("The design note (validated against the design-note schema)."),
      },
      outputSchema: { taskId: z.string(), status: z.literal("designed"), notePath: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ projectPath, note }) =>
      toolResult("submit_design_note", () => submitDesignNote(deps, agentActor(server), { projectPath, note })),
  );

  server.registerTool(
    "mark_task_trivial",
    {
      title: "Mark a task trivial",
      description:
        "For a genuinely trivial task (a rename, a typo, a config value), record why it needs no design note so it can start. " +
        "Only a task that has no design yet can be marked trivial.",
      inputSchema: {
        projectPath: projectPathInput,
        taskId: z.string().min(1),
        reason: z.string().min(1).describe("Why no design note is needed."),
      },
      outputSchema: { taskId: z.string(), status: z.literal("designed") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ projectPath, taskId, reason }) =>
      toolResult("mark_task_trivial", () => markTaskTrivial(deps, agentActor(server), { projectPath, taskId, reason })),
  );

  return server;
}

/**
 * Whoever calls through MCP is an agent, named by the client's own clientInfo. Nothing a client
 * sends can make it a person, so approval stays with the user (GATE-2).
 */
function agentActor(server: McpServer, model?: string): Event["actor"] {
  const name = server.server.getClientVersion()?.name?.trim().slice(0, 200);
  return { kind: "agent", tool: name || "unnamed-mcp-client", ...(model ? { model } : {}) };
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
