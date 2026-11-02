import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  TrackType,
  ChatMessage,
  Skill,
  TeardownResponse,
  DiscoveredTool,
  LaunchResult,
  BYOKConfig,
  ByokState,
  KeyStorageStatus,
} from "./lib/types";
import { ChatContainer } from "./components/chat/ChatContainer";
import { PromptInput } from "./components/chat/PromptInput";
import { PreLaunchStagingModal } from "./components/track-a/PreLaunchStagingModal";
import { TeardownViewer } from "./components/track-b/TeardownViewer";
import { BYOKSettings } from "./components/track-b/BYOKSettings";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SkillCard } from "./components/skills/SkillCard";
import { SkillDetailModal } from "./components/skills/SkillDetailModal";
import { Terminal, Search, Sliders, X, FolderOpen, MessageSquare } from "lucide-react";
import { ProjectsView } from "./components/projects/ProjectsView";

export function App() {
  const [currentTrack, setCurrentTrack] = useState<TrackType>("track-a");
  const [view, setView] = useState<"workspace" | "projects">("workspace");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [byokConfig, setByokConfig] = useState<BYOKConfig>({});
  const [keyStorage, setKeyStorage] = useState<KeyStorageStatus | undefined>(undefined);
  const [byokLoadError, setByokLoadError] = useState<string | undefined>(undefined);

  // Modals & Panels
  const [showStaging, setShowStaging] = useState(false);
  const [stagingPrompt, setStagingPrompt] = useState("");
  const [currentTeardown, setCurrentTeardown] = useState<TeardownResponse | null>(null);
  const [showSkillsModal, setShowSkillsModal] = useState(false);
  const [selectedSkillForDetail, setSelectedSkillForDetail] = useState<Skill | null>(null);
  const [skillModalMode, setSkillModalMode] = useState<"view" | "edit">("view");
  const [skillSearchQuery, setSkillSearchQuery] = useState("");

  // System State
  const [skills, setSkills] = useState<Skill[]>([]);
  const [tools, setTools] = useState<DiscoveredTool[]>([]);
  const [activeTool, setActiveTool] = useState<string>("None found");
  const [defaultProjectPath, setDefaultProjectPath] = useState<string>("");

  useEffect(() => {
    loadInitialData();
  }, []);

  // Saves BYOK settings: keys go to the OS credential store, the rest to settings.json.
  const saveByok = async (config: BYOKConfig) => {
    const status = await invoke<KeyStorageStatus>("save_byok_config", { byok: config });
    setByokConfig(config);
    setKeyStorage(status);
    setByokLoadError(undefined);
  };

  const loadInitialData = async () => {
    try {
      const state = await invoke<ByokState>("get_byok_config");
      setByokConfig(state.config);
      setKeyStorage(state.keyStorage);
    } catch (e) {
      setByokLoadError(String(e));
    }

    try {
      const toolList = await invoke<DiscoveredTool[]>("discover_tools");
      setTools(toolList);
      const startable = toolList.find((t) => t.launch) ?? toolList[0];
      if (startable) {
        setActiveTool(startable.name);
      }
    } catch {
      setActiveTool("Discovery failed");
    }

    try {
      const skillList = await invoke<Skill[]>("get_skills");
      setSkills(skillList);
    } catch {
      // Fallback
    }

    try {
      const path = await invoke<string>("get_default_project_path");
      setDefaultProjectPath(path);
    } catch {
      setDefaultProjectPath("");
    }
  };

  const handleToggleSkill = async (id: string, enabled: boolean) => {
    setSkills((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled } : s))
    );
    try {
      await invoke("toggle_skill", { skillId: id, enabled });
    } catch {
      // Handled
    }
  };

  const handleSaveSkillModification = async (
    skillId: string,
    newContent: String,
    newDescription: string
  ) => {
    try {
      const updated = await invoke<Skill>("update_skill_content", {
        skillId,
        newContent,
        newDescription,
      });
      setSkills((prev) => prev.map((s) => (s.id === skillId ? updated : s)));
    } catch {
      setSkills((prev) =>
        prev.map((s) =>
          s.id === skillId
            ? { ...s, content: newContent as string, description: newDescription, isCustom: true }
            : s
        )
      );
    }
  };

  const handleSubmitPrompt = async (prompt: string, track: TrackType) => {
    const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: "user",
      content: prompt,
      timestamp,
      track,
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    if (track === "track-a") {
      try {
        const brief = await invoke<string>("generate_project_brief", { idea: prompt });
        const assistantMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          sender: "assistant",
          content: brief,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          track: "track-a",
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setStagingPrompt(prompt);
      } catch (err) {
        // Honest error state: no fabricated brief when the backend fails.
        const detail = typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
        const errorMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          sender: "assistant",
          content: `### Brief Generation Failed\n\nCould not generate the project brief:\n\n\`\`\`\n${detail}\n\`\`\`\n\nPlease try again.`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          track: "track-a",
          isError: true,
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsLoading(false);
      }
    } else {
      try {
        const teardown = await invoke<TeardownResponse>("execute_strategic_teardown", {
          request: {
            targetProductOrCompany: prompt,
            analysisType: "full-teardown",
            byok: byokConfig,
          },
        });
        setCurrentTeardown(teardown);

        const assistantMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          sender: "assistant",
          content: `### Executive Teardown Complete: ${teardown.targetName}\n\nDeconstructed core users, JTBD, habit loops, and monetization friction using **Yan Liu's** framework.\n\nCold outreach sequence prepared for leadership pitch using **Corey Haines'** customer research principles.${teardown.source ? `\n\n_Source: ${teardown.source === "offline" ? "offline template (no provider configured)" : `${teardown.source} API`}_` : ""}`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          track: "track-b",
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err) {
        // Honest error state: surface the provider failure instead of fabricating a report.
        const detail = typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
        setCurrentTeardown(null);
        const errorMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          sender: "assistant",
          content: `### Teardown Failed\n\nThe configured LLM provider could not complete the request:\n\n\`\`\`\n${detail}\n\`\`\`\n\nCheck your API key and model in BYOK settings, then try again.`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          track: "track-b",
          isError: true,
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleOpenStaging = (promptContent: string) => {
    setStagingPrompt(promptContent);
    setShowStaging(true);
  };

  const filteredSkillsForModal = skills.filter((s) => {
    if (!skillSearchQuery) return true;
    const q = skillSearchQuery.toLowerCase();
    return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.id.toLowerCase().includes(q);
  });

  return (
    <div className="flex flex-col h-screen w-full bg-zinc-950 text-zinc-100 font-sans selection:bg-zinc-800 selection:text-white antialiased">
      {/* Top Navbar */}
      <header className="h-14 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-md px-6 flex items-center justify-between shrink-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-300 shadow-sm">
            <Terminal className="w-4 h-4 text-zinc-300" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-white flex items-center gap-2">
              OmniOrchestrator
              <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-zinc-900 text-zinc-400 border border-zinc-800 font-normal">
                Apache 2.0
              </span>
            </h1>
          </div>
        </div>

        {/* Center Indicators */}
        <div className="hidden md:flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>Target Tool:</span>
            <span className="font-semibold text-white">{activeTool}</span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 font-mono text-[11px]">
            <span>Ledger:</span>
            <span className="text-zinc-200">.agents/session-state.json</span>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView(view === "projects" ? "workspace" : "projects")}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 transition-colors flex items-center gap-1.5"
          >
            {view === "projects" ? <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" /> : <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />}
            <span>{view === "projects" ? "Workspace" : "Projects"}</span>
          </button>
          <button
            onClick={() => setShowSkillsModal(true)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 transition-colors flex items-center gap-1.5"
            aria-label="Open Skill Catalog"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Skills</span>
            <span className="px-1.5 py-0.2 bg-zinc-800 rounded text-[10px] font-mono text-emerald-400">
              {skills.filter((s) => s.enabled).length}
            </span>
          </button>
        </div>
      </header>

      {view === "projects" && (
        <main className="flex-1 overflow-y-auto">
          <ErrorBoundary panelName="Projects">
            <ProjectsView />
          </ErrorBoundary>
        </main>
      )}

      {/* Main Content Area with Chat Flow */}
      <main className={`flex-1 flex flex-col overflow-hidden relative ${view === "projects" ? "hidden" : ""}`}>
        <ChatContainer
          messages={messages}
          onOpenStaging={() => handleOpenStaging(stagingPrompt || "Autonomous build task")}
          onOpenTeardown={() => currentTeardown && setCurrentTeardown({ ...currentTeardown })}
          onSelectPhaseAction={(action) => handleSubmitPrompt(action, currentTrack)}
        />

        {/* Bottom Floating Prompt Bar */}
        <div className="p-4 bg-gradient-to-t from-zinc-950 via-zinc-950/90 to-transparent shrink-0">
          <PromptInput
            currentTrack={currentTrack}
            onTrackChange={setCurrentTrack}
            onSubmit={handleSubmitPrompt}
            isLoading={isLoading}
          />
          {currentTrack === "track-b" && (
            <div className="px-4 pb-2 pt-2">
              <ErrorBoundary panelName="BYOK Settings">
                <BYOKSettings config={byokConfig} onChange={saveByok} keyStorage={keyStorage} loadError={byokLoadError} />
              </ErrorBoundary>
            </div>
          )}
        </div>
      </main>

      {/* Track A Pre-Launch Staging Modal */}
      <PreLaunchStagingModal
        isOpen={showStaging}
        projectName={stagingPrompt.slice(0, 30) || "Agent Orchestrator Project"}
        projectPath={defaultProjectPath}
        detectedTools={tools}
        initialSkills={skills}
        onClose={() => setShowStaging(false)}
        onLaunch={async (selectedTool, activeSkills, finalProjectPath) => {
          setDefaultProjectPath(finalProjectPath);
          let result: LaunchResult;
          try {
            result = await invoke<LaunchResult>("launch_and_build", {
              payload: {
                projectPath: finalProjectPath,
                projectName: stagingPrompt.slice(0, 30) || "GeneratedApp",
                selectedTool,
                ideaDescription: stagingPrompt,
                skills: activeSkills,
              },
            });
          } catch (err) {
            const detail = typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
            setShowStaging(false);
            setMessages((prev) => [
              ...prev,
              {
                id: Date.now().toString(),
                sender: "assistant",
                content: `### Launch Failed\n\nCould not launch **${selectedTool}** at \`${finalProjectPath}\`:\n\n\`\`\`\n${detail}\n\`\`\``,
                timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                track: "track-a",
                isError: true,
              },
            ]);
            return;
          }
          setShowStaging(false);
          const noticeMsg: ChatMessage = {
            id: Date.now().toString(),
            sender: "assistant",
            // What the backend actually did: launched, or prepared with instructions to open.
            content: `${result.message}\n\n${result.verificationNotice}`,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            track: "track-a",
          };
          setMessages((prev) => [...prev, noticeMsg]);
        }}
      />

      {/* Track B Strategic Teardown Viewer */}
      {currentTeardown && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <ErrorBoundary panelName="Teardown Viewer" onClose={() => setCurrentTeardown(null)}>
              <TeardownViewer
                teardown={currentTeardown}
                onClose={() => setCurrentTeardown(null)}
              />
            </ErrorBoundary>
          </div>
        </div>
      )}

      {/* Skills Catalog Modal with Search, View & Edit */}
      {showSkillsModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl max-w-4xl w-full p-6 shadow-2xl flex flex-col gap-4 max-h-[88vh]">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <span>Engineering Skill Catalog</span>
                  <span className="text-xs px-2 py-0.5 rounded font-mono bg-zinc-900 border border-zinc-800 text-emerald-400">
                    {skills.length} Loaded
                  </span>
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Inspect, toggle, or modify any skill with author attributions.
                </p>
              </div>
              <button
                onClick={() => setShowSkillsModal(false)}
                className="p-1 text-zinc-400 hover:text-white rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search within Skills */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                value={skillSearchQuery}
                onChange={(e) => setSkillSearchQuery(e.target.value)}
                placeholder={`Search across all ${skills.length} loaded skills (e.g. TDD, Spec, GCP, Security, Vibe)...`}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-4 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Skill Cards Grid */}
            <div className="overflow-y-auto space-y-3 pr-1 max-h-[55vh]">
              {filteredSkillsForModal.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  onToggle={handleToggleSkill}
                  onView={(s) => {
                    setSelectedSkillForDetail(s);
                    setSkillModalMode("view");
                  }}
                  onEdit={(s) => {
                    setSelectedSkillForDetail(s);
                    setSkillModalMode("edit");
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Skill Detail / Viewer / Editor Modal */}
      {selectedSkillForDetail && (
        <SkillDetailModal
          skill={selectedSkillForDetail}
          onClose={() => setSelectedSkillForDetail(null)}
          onSave={handleSaveSkillModification}
          initialEditMode={skillModalMode === "edit"}
        />
      )}
    </div>
  );
}

export default App;
