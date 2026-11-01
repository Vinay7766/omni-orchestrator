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
  phaseScope?: "discovery" | "spec" | "architecture" | "build" | "review";
}

export type ToolId = 
  | "antigravity"
  | "cursor"
  | "vscode"
  | "windsurf"
  | "claude-code"
  | "ollama";

export interface InstalledTool {
  id: ToolId;
  name: string;
  executablePath: string;
  installed: boolean;
  version?: string;
  configDirectory: string;
  commandSnippet: string;
}

export interface DiscoveredSkill {
  id: string;
  name: string;
  description: string;
  sourceUrl: string;
  author: string;
  domain: string;
  starsOrUpvotes?: number;
  content: string;
  imported: boolean;
}

export interface ResearchQuery {
  domainOrCategory?: string;
  keyword: string;
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
