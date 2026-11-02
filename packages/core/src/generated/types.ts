// GENERATED from /schemas by scripts/generate-contract.mjs. Do not edit by hand.

/**
 * Version of this file format. Changes are additive; a breaking change increments this.
 *
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "common_formatVersion".
 */
export type CommonFormatVersion = 1;
/**
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "common_id".
 */
export type CommonId = string;
/**
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "common_nonEmptyText".
 */
export type CommonNonEmptyText = string;
/**
 * A path in the user's home folder: starts with ~/, forward slashes, no '..' steps.
 *
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "adapter_homePath".
 */
export type AdapterHomePath = string;
/**
 * Path relative to the project root, forward slashes, never absolute, never leaving the project.
 *
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "common_relPath".
 */
export type CommonRelPath = string;
/**
 * One line of .agents/events.jsonl. The append-only event log is the source of truth; state.json is rebuilt from it.
 *
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "Event".
 */
export type Event = Event1;
/**
 * RFC 3339 timestamp with timezone. A pattern rather than format: date-time so every validator checks it identically (calendar validity such as Feb 30 is checked in code where it matters).
 *
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "common_timestamp".
 */
export type CommonTimestamp = string;
/**
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "common_commitSha".
 */
export type CommonCommitSha = string;
/**
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "common_flow".
 */
export type CommonFlow = "build" | "pitch";
/**
 * A phase id from schemas/phases.json (checked in code; schemas cannot read that list).
 *
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "common_phaseId".
 */
export type CommonPhaseId = string;
/**
 * skills/catalog.json: metadata for every bundled skill. Content lives in skills/<id>/SKILL.md. Read by the Rust build (embedded in the app) and the TypeScript core.
 *
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "SkillCatalog".
 */
export type SkillCatalog = {
  /**
   * Also the folder name under skills/.
   */
  id: string;
  name: string;
  description: string;
  category:
    | "engineering"
    | "architecture"
    | "testing"
    | "security"
    | "strategy"
    | "marketing"
    | "research"
    | "custom";
  attribution: {
    name: string;
    role?: string;
    sourceUrl: string;
    verified: boolean;
  };
  enabled: boolean;
  isCustom: boolean;
  /**
   * SPDX id, or "unverified" until checked.
   */
  license: string;
  /**
   * @minItems 1
   */
  phases: [
    (CommonPhaseId | "all") & string & (CommonPhaseId | "all") & string,
    ...((CommonPhaseId | "all") & string & (CommonPhaseId | "all") & string)[]
  ];
  /**
   * @minItems 1
   */
  domains: [string, ...string[]];
}[];
/**
 * Path relative to the project root, forward slashes, never absolute, never leaving the project.
 */
export type CommonRelPath1 = string;
/**
 * Path relative to the project root, forward slashes, never absolute, never leaving the project.
 */
export type CommonRelPath2 = string;

/**
 * Every project-memory file type, keyed by schema name.
 */
export interface MemoryFileTypes {
  adapter: Adapter;
  "agents-link": AgentsLink;
  "design-note": DesignNote;
  event: Event;
  project: Project;
  "skill-catalog": SkillCatalog;
  "skills-config": SkillsConfig;
  state: State;
}
/**
 * Optional known details for one AI tool (TOOL-5): packages/core/adapters/<id>.json. Discovery and integration work without any adapter; an adapter only adds details checked against the tool's own docs.
 *
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "Adapter".
 */
export interface Adapter {
  formatVersion: CommonFormatVersion;
  id: CommonId;
  name: CommonNonEmptyText;
  /**
   * Ids that tool discovery gives this tool (from its own files); the adapter applies to any of them.
   *
   * @minItems 1
   */
  matches: [string, ...string[]];
  mcp?: {
    /**
     * Top-level key the tool's MCP config uses for its servers.
     */
    format: "mcpServers" | "servers";
    /**
     * Per-user config files, first existing one wins (tools move them between versions).
     *
     * @minItems 1
     */
    userConfig?: [AdapterHomePath, ...AdapterHomePath[]];
    projectConfig?: CommonRelPath;
  };
  /**
   * Project files the tool reads instructions from, besides AGENTS.md. A pointer to project memory is written inside a managed block.
   *
   * @minItems 1
   */
  instructionFiles?: [CommonRelPath, ...CommonRelPath[]];
  /**
   * Where each detail was checked. At least one.
   *
   * @minItems 1
   */
  sources: [
    {
      url: string;
      checked: string;
      /**
       * @minItems 1
       */
      covers: ["mcp" | "instructionFiles", ...("mcp" | "instructionFiles")[]];
    },
    ...{
      url: string;
      checked: string;
      /**
       * @minItems 1
       */
      covers: ["mcp" | "instructionFiles", ...("mcp" | "instructionFiles")[]];
    }[]
  ];
}
/**
 * .agents-link in a git worktree (or any secondary checkout): points at the folder whose .agents/ holds the shared project memory.
 *
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "AgentsLink".
 */
export interface AgentsLink {
  formatVersion: CommonFormatVersion;
  /**
   * Path to the main project folder: relative to the folder containing this file (preferred), or absolute.
   */
  projectRoot: string;
}
/**
 * .agents/design-notes/<task>.json: the solution-design output required before coding a task (DSN-1..3, UND-3).
 *
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "DesignNote".
 */
export interface DesignNote {
  formatVersion: CommonFormatVersion;
  taskId: CommonId;
  problem: CommonNonEmptyText;
  /**
   * @minItems 1
   */
  constraints: [CommonNonEmptyText, ...CommonNonEmptyText[]];
  /**
   * @minItems 1
   */
  approaches: [
    {
      name: string;
      idea: CommonNonEmptyText;
      complexity: CommonNonEmptyText;
      risks: CommonNonEmptyText;
    },
    ...{
      name: string;
      idea: CommonNonEmptyText;
      complexity: CommonNonEmptyText;
      risks: CommonNonEmptyText;
    }[]
  ];
  singleApproachReason?: CommonNonEmptyText;
  /**
   * Name of the chosen approach (must match one of approaches[].name; checked in code).
   */
  chosen: string;
  reason: CommonNonEmptyText;
  switchIf: CommonNonEmptyText;
  /**
   * @minItems 1
   */
  edgeCases: [CommonNonEmptyText, ...CommonNonEmptyText[]];
  generalisationCheck: CommonNonEmptyText;
  assumptions: CommonNonEmptyText[];
}
export interface Event1 {
  formatVersion: CommonFormatVersion;
  id: CommonId;
  time: CommonTimestamp;
  type:
    | "project_created"
    | "project_updated"
    | "tools_selected"
    | "phase_started"
    | "phase_submitted"
    | "phase_approved"
    | "phase_skipped"
    | "changes_requested"
    | "task_created"
    | "design_note_submitted"
    | "task_marked_trivial"
    | "task_started"
    | "task_completed"
    | "task_reopened"
    | "decision_recorded"
    | "problem_recorded"
    | "lesson_recorded"
    | "memory_updated";
  actor: CommonActor;
  payload: {};
  /**
   * Files and commits this event concerns (MEM-4).
   */
  refs?: {
    files?: CommonRelPath[];
    commits?: CommonCommitSha[];
  };
}
/**
 * Who caused an event. Tool and model are free text: no fixed tool or model list.
 *
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "common_actor".
 */
export interface CommonActor {
  kind: "agent" | "human";
  tool: string;
  model?: string;
}
/**
 * .agents/project.json: identity and settings of one project.
 *
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "Project".
 */
export interface Project {
  formatVersion: CommonFormatVersion;
  id: CommonId;
  name: string;
  createdAt: CommonTimestamp;
  /**
   * simple = one tool, plain-language errors (NTU-2).
   */
  mode: "full" | "simple";
  flow: CommonFlow;
}
/**
 * .agents/skills.json: per-project overrides of the skill catalog (SKL-5).
 *
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "SkillsConfig".
 */
export interface SkillsConfig {
  formatVersion: CommonFormatVersion;
  skills: {
    [k: string]: {
      enabled?: boolean;
      /**
       * @minItems 1
       */
      phases?: [
        (CommonPhaseId | "all") & string & (CommonPhaseId | "all") & string,
        ...((CommonPhaseId | "all") & string & (CommonPhaseId | "all") & string)[]
      ];
    };
  };
}
/**
 * .agents/state.json: current snapshot rebuilt from events.jsonl. Never the source of truth; safe to delete and rebuild.
 *
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "State".
 */
export interface State {
  formatVersion: CommonFormatVersion;
  flow: CommonFlow;
  currentPhase: CommonPhaseId | null;
  phases: {
    [k: string]: {
      status:
        | "not_started"
        | "in_progress"
        | "awaiting_review"
        | "changes_requested"
        | "approved"
        | "skipped";
      submittedAt?: CommonTimestamp;
      decidedAt?: CommonTimestamp;
    };
  };
  tasks: {
    id: CommonId;
    title: string;
    status: "todo" | "designed" | "in_progress" | "done";
    designNote?: CommonRelPath;
    trivialReason?: CommonNonEmptyText;
    assignedTool?: CommonId;
  }[];
  lastEventId: CommonId | null;
}
/**
 * A skill the agent followed, with evidence (SKL-8). A name alone is not enough.
 *
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "common_skillUse".
 */
export interface CommonSkillUse {
  skill: CommonId;
  evidence: CommonNonEmptyText;
}
/**
 * Proof that tests actually ran (HON-4).
 *
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "common_testEvidence".
 */
export interface CommonTestEvidence {
  command: CommonNonEmptyText;
  exitCode: number;
  outputTail: string;
}
/**
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "event_projectCreated".
 */
export interface EventProjectCreated {
  name: string;
  flow: CommonFlow;
}
/**
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "event_toolsSelected".
 */
export interface EventToolsSelected {
  /**
   * @minItems 1
   */
  tools: [
    {
      id: CommonId;
      name: string;
      /**
       * 3 = MCP, 2 = reads instruction files, 1 = chat only.
       */
      capabilityLevel: 1 | 2 | 3;
      models?: string[];
    },
    ...{
      id: CommonId;
      name: string;
      /**
       * 3 = MCP, 2 = reads instruction files, 1 = chat only.
       */
      capabilityLevel: 1 | 2 | 3;
      models?: string[];
    }[]
  ];
}
/**
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "event_phaseOnly".
 */
export interface EventPhaseOnly {
  phase: CommonPhaseId;
}
/**
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "event_phaseSubmitted".
 */
export interface EventPhaseSubmitted {
  phase: CommonPhaseId;
  /**
   * @minItems 1
   */
  documents: [CommonRelPath, ...CommonRelPath[]];
  /**
   * @minItems 1
   */
  skillsUsed: [CommonSkillUse, ...CommonSkillUse[]];
  understandingCheck?: CommonRelPath1;
  stackAdr?: CommonRelPath2;
}
/**
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "event_changesRequested".
 */
export interface EventChangesRequested {
  phase: CommonPhaseId;
  notes: CommonNonEmptyText;
}
/**
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "event_taskStarted".
 */
export interface EventTaskStarted {
  taskId: CommonId;
  /**
   * Skills declared for this task when it started, each acknowledged by the agent (SKL-4). Completion needs evidence for each (SKL-8). Absent in logs written before this field existed. Duplicates are removed by the task engine.
   */
  declaredSkills?: CommonId[];
}
/**
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "event_taskCreated".
 */
export interface EventTaskCreated {
  taskId: CommonId;
  title: string;
  requirements?: string[];
}
/**
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "event_designNoteSubmitted".
 */
export interface EventDesignNoteSubmitted {
  taskId: CommonId;
  notePath: CommonRelPath;
}
/**
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "event_taskWithReason".
 */
export interface EventTaskWithReason {
  taskId: CommonId;
  reason: CommonNonEmptyText;
}
/**
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "event_taskCompleted".
 */
export interface EventTaskCompleted {
  taskId: CommonId;
  summary: CommonNonEmptyText;
  /**
   * @minItems 1
   */
  skillsUsed: [CommonSkillUse, ...CommonSkillUse[]];
  tests: CommonTestEvidence;
}
/**
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "event_decisionRecorded".
 */
export interface EventDecisionRecorded {
  title: CommonNonEmptyText;
  decision: CommonNonEmptyText;
  reason: CommonNonEmptyText;
  alternatives?: string[];
}
/**
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "event_problemRecorded".
 */
export interface EventProblemRecorded {
  title: CommonNonEmptyText;
  details: CommonNonEmptyText;
  status: "open" | "resolved" | "wont_fix";
}
/**
 * A correction the user made to the AI's understanding (UND-5).
 *
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "event_lessonRecorded".
 */
export interface EventLessonRecorded {
  lesson: CommonNonEmptyText;
  context?: string;
}
/**
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "event_memoryUpdated".
 */
export interface EventMemoryUpdated {
  /**
   * @minItems 1
   */
  files: [CommonRelPath, ...CommonRelPath[]];
}
/**
 * A person declined an optional phase (schemas/phases.json "optional"; which phases are optional is checked in code).
 *
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "event_phaseSkipped".
 */
export interface EventPhaseSkipped {
  phase: CommonPhaseId;
  reason?: CommonNonEmptyText;
}
/**
 * A person changed the project's name and/or mode (project.json is rewritten with the same values).
 *
 * This interface was referenced by `MemoryFileTypes`'s JSON-Schema
 * via the `definition` "event_projectUpdated".
 */
export interface EventProjectUpdated {
  name?: string;
  mode?: "full" | "simple";
}
