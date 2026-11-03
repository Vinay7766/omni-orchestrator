/**
 * The agent channel (ARCHITECTURE 5): an MCP server any MCP-capable tool can start.
 * Transport-free: main.ts connects it over stdio, tests over an in-memory pair.
 * API per @modelcontextprotocol/sdk 1.32.1 (McpServer.registerTool with input/output schemas).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import { buildContext, type ContextDeps } from "./context.js";
import { getPhaseSkills, submitPhase } from "./phase-tools.js";
import { completeTask, createTasks, markTaskTrivial, startTask, submitDesignNote } from "./task-tools.js";
import { recordDecision, recordLesson, recordProblem } from "./record-tools.js";
import { STACK_ADR_PHASES, STACK_ADR_SECTIONS, type Event } from "@omni/core";
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
        "Understanding check. For the " + STACK_ADR_PHASES.join(", ") + " phase, also the stack decision record (stackAdr) " +
        "written with the stack-selection skill. Afterwards show the user the documents and the returned reviewQuestion. Only the user can " +
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
        stackAdr: projectFile
          .optional()
          .describe(
            `Stack ADR with the sections ${STACK_ADR_SECTIONS.join(", ")} (Sources with links). ` +
              `Needed for the ${STACK_ADR_PHASES.join(", ")} phase.`,
          ),
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
              kinds: z
                .array(z.string().regex(/^[a-z][a-z0-9-]{0,39}$/))
                .min(1)
                .max(8)
                .optional()
                .describe("Kinds of work it involves, as short lowercase tags (for example backend, interface, tests)."),
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

  server.registerTool(
    "start_task",
    {
      title: "Start a task",
      description:
        "Start a designed task. The first call returns the task's declared skills in full and does not start it: read and " +
        "follow them, then call again with acknowledgedSkills listing every one. Completing the task later needs evidence " +
        "for each declared skill.",
      inputSchema: {
        projectPath: projectPathInput,
        taskId: z.string().min(1),
        acknowledgedSkills: z.array(z.string().min(1)).optional().describe("Ids of the declared skills you have read and will follow."),
      },
      outputSchema: {
        taskId: z.string(),
        started: z.boolean(),
        declaredSkills: z.array(z.object({ id: z.string(), name: z.string(), content: z.string().optional() })),
        message: z.string(),
        warnings: z.array(z.string()),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ projectPath, taskId, acknowledgedSkills }) =>
      toolResult("start_task", () =>
        startTask(deps, agentActor(server), { projectPath, taskId, ...(acknowledgedSkills ? { acknowledgedSkills } : {}) }),
      ),
  );

  server.registerTool(
    "complete_task",
    {
      title: "Complete a task",
      description:
        "Complete an in-progress task with: a summary; every skill used with evidence (each declared skill needs some); the " +
        "test command you actually ran with its exit code and the last lines of output (recorded as reported by you; a " +
        "failing run keeps the task in progress); the files and commits you touched; and the memory files you updated. " +
        "Everything is checked before anything is saved.",
      inputSchema: {
        projectPath: projectPathInput,
        taskId: z.string().min(1),
        summary: z.string().min(1),
        skillsUsed: z.array(z.object({ skill: z.string().min(1), evidence: z.string().min(1) })).min(1),
        tests: z.object({
          command: z.string().min(1).describe("The exact command you ran."),
          exitCode: z.number().int(),
          outputTail: z.string().describe("The last lines of its output."),
        }),
        refs: z.object({ files: z.array(projectFile).optional(), commits: z.array(z.string().min(1)).optional() }),
        memoryUpdate: z
          .object({ files: z.array(projectFile).min(1) })
          .optional()
          .describe("Memory files updated for this task. Needed unless the memory update was already recorded."),
        model: z.string().min(1).max(200).optional(),
      },
      outputSchema: {
        taskId: z.string(),
        status: z.literal("done"),
        eventId: z.string(),
        testsNote: z.string(),
        warnings: z.array(z.string()),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ model, ...input }) => toolResult("complete_task", () => completeTask(deps, agentActor(server, model), input)),
  );

  const refsInput = z.object({
    files: z.array(projectFile).optional().describe("Project files this entry concerns."),
    commits: z.array(z.string().min(1)).optional().describe("Commit SHAs this entry concerns."),
  });
  const recordedOutput = { eventId: z.string(), type: z.string(), warnings: z.array(z.string()) };
  const recordAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

  server.registerTool(
    "record_decision",
    {
      title: "Record a decision",
      description:
        "Add a decision to the project memory (decisions.md) with the reason and the alternatives considered. It must point " +
        "to at least one real file or commit it concerns; references are checked and invalid ones are rejected.",
      inputSchema: {
        projectPath: projectPathInput,
        title: z.string().min(1),
        decision: z.string().min(1),
        reason: z.string().min(1),
        alternatives: z.array(z.string().min(1)).optional(),
        refs: refsInput,
      },
      outputSchema: recordedOutput,
      annotations: recordAnnotations,
    },
    async (input) => toolResult("record_decision", () => recordDecision(deps, agentActor(server), input)),
  );

  server.registerTool(
    "record_problem",
    {
      title: "Record a problem",
      description:
        "Add a known problem to the project memory (problems.md), or update one: recording the same title again replaces " +
        "its details and status (open, resolved, wont_fix). It must point to at least one real file or commit.",
      inputSchema: {
        projectPath: projectPathInput,
        title: z.string().min(1).describe("Same title as an earlier problem to update it."),
        details: z.string().min(1),
        status: z.enum(["open", "resolved", "wont_fix"]),
        refs: refsInput,
      },
      outputSchema: { ...recordedOutput, status: z.string() },
      annotations: recordAnnotations,
    },
    async (input) => toolResult("record_problem", () => recordProblem(deps, agentActor(server), input)),
  );

  server.registerTool(
    "record_lesson",
    {
      title: "Record a lesson",
      description:
        "When the user corrects how you understood the request, record the correction as a lesson (lessons.md). Every tool " +
        "working on the project receives it through get_context. References are optional and checked when given.",
      inputSchema: {
        projectPath: projectPathInput,
        lesson: z.string().min(1).describe("The correction, in a sentence the next tool can apply."),
        context: z.string().optional().describe("Where it came up, e.g. the phase."),
        refs: refsInput.optional(),
      },
      outputSchema: recordedOutput,
      annotations: recordAnnotations,
    },
    async (input) => toolResult("record_lesson", () => recordLesson(deps, agentActor(server), input)),
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
