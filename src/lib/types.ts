// Core Domain Models for Agent Orchestrator

export type TrackType = "track-a" | "track-b";

export interface AuthorAttribution {
  name: string;
  role?: string;
  sourceUrl: string;
  verified: boolean;
  avatarUrl?: string;
}

export type SkillCategory = 
  | "engineering"
  | "architecture"
  | "testing"
  | "security"
  | "strategy"
  | "marketing"
  | "research"
  | "custom";

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  attribution: AuthorAttribution;
  enabled: boolean;
  content: string;
  isCustom: boolean;
  /** Phase ids from schemas/phases.json, or ["all"] for every phase. */
  phases?: string[];
  /** SPDX license id, or "unverified" when not yet checked. */
  license?: string;
}

/** Id of a discovered tool. Open on purpose: any tool discovery finds, no fixed list. */
export type ToolId = string;

export type ToolCategory = "editor" | "editor-extension" | "command-line" | "desktop-app" | "unknown";

/** A program and its leading arguments; the project folder is added last. */
export interface LaunchCommand {
  program: string;
  args: string[];
}

/** What launch_and_build reports (Rust LaunchResult). */
export interface LaunchResult {
  success: boolean;
  message: string;
  projectPath: string;
  toolLaunched: boolean;
  verificationNotice: string;
}

/** One AI coding tool found on this computer (Rust discover_tools, tool_discovery.rs). */
export interface DiscoveredTool {
  id: ToolId;
  name: string;
  category: ToolCategory;
  /** 3 when the tool is shown to support MCP; null when unknown (the user confirms). */
  capability: number | null;
  /** Where the tool was found, for the user to check. */
  evidence: string[];
  /** True when the only evidence is the tool's own description of itself. */
  needsConfirmation: boolean;
  launch?: LaunchCommand | null;
  executable?: string | null;
  installDir?: string | null;
  mcpConfig?: string | null;
  dataFolder?: string | null;
  hostEditor?: string | null;
}

export interface BYOKConfig {
  geminiApiKey?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  ollamaEndpoint?: string;
  preferredModel?: string;
}

export interface AppSettings {
  defaultTrack: TrackType;
  theme: "dark" | "light";
  activeToolId?: ToolId;
  byok: BYOKConfig;
  customSkillsDirectory?: string;
}

export interface ChatMessage {
  id: string;
  sender: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  track: TrackType;
  /** True for failure replies — the UI hides follow-up actions (stage run, open report). */
  isError?: boolean;
}

export interface ProjectSession {
  id: string;
  name: string;
  track: TrackType;
  projectPath: string;
  currentPhase: number;
  prdPath?: string;
  equippedSkills: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TeardownRequest {
  targetProductOrCompany: string;
  analysisType: string;
  byok: BYOKConfig;
}

export interface TeardownResponse {
  targetName: string;
  markdownReport: string;
  coldOutreachSequence: string;
  strategicGrowthLevers: string[];
  authorAttributions: string[];
  /** "gemini" | "claude" | "openai" | "ollama" | "offline" */
  source?: string;
}
