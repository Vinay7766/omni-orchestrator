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
import { ChatArea } from "./components/chat/ChatArea";
import { PreLaunchStagingModal } from "./components/track-a/PreLaunchStagingModal";
import { TeardownViewer } from "./components/track-b/TeardownViewer";
import { BYOKSettings } from "./components/track-b/BYOKSettings";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SkillCatalog } from "./components/skills/SkillCatalog";
import { Terminal } from "lucide-react";
import { ProjectsView } from "./components/projects/ProjectsView";
import { AreaNav, type Area } from "./components/layout/AreaNav";

export function App() {
  const [area, setArea] = useState<Area>("projects");
  // One list for both conversations; each area shows only its own track's messages.
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingTrack, setLoadingTrack] = useState<TrackType | null>(null);
  const [byokConfig, setByokConfig] = useState<BYOKConfig>({});
  const [keyStorage, setKeyStorage] = useState<KeyStorageStatus | undefined>(undefined);
  const [byokLoadError, setByokLoadError] = useState<string | undefined>(undefined);

  // Modals & Panels
  const [showStaging, setShowStaging] = useState(false);
  const [stagingPrompt, setStagingPrompt] = useState("");
  const [currentTeardown, setCurrentTeardown] = useState<TeardownResponse | null>(null);

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
    newContent: string,
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
            ? { ...s, content: newContent, description: newDescription, isCustom: true }
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
    setLoadingTrack(track);

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
        setLoadingTrack(null);
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
        setLoadingTrack(null);
      }
    }
  };

  const handleOpenStaging = (promptContent: string) => {
    setStagingPrompt(promptContent);
    setShowStaging(true);
  };

  return (
    <div className="flex flex-col h-screen w-full bg-zinc-950 text-zinc-100 font-sans selection:bg-zinc-800 selection:text-white antialiased">
      <header className="h-12 border-b border-zinc-800 bg-zinc-950 px-4 flex items-center gap-3 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center">
          <Terminal className="w-4 h-4 text-zinc-300" aria-hidden="true" />
        </div>
        <h1 className="text-sm font-semibold tracking-tight text-zinc-100 flex items-center gap-2">
          OmniOrchestrator
          <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-zinc-900 text-zinc-400 border border-zinc-800 font-normal">
            Apache 2.0
          </span>
        </h1>
      </header>

      <div className="flex flex-1 min-h-0">
        <AreaNav current={area} onChange={setArea} />

        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {area === "projects" && (
            <div className="flex-1 overflow-y-auto">
              <ErrorBoundary panelName="Projects">
                <ProjectsView />
              </ErrorBoundary>
            </div>
          )}

          {(area === "idea" || area === "pitch") && (
            <ChatArea
              track={area === "idea" ? "track-a" : "track-b"}
              messages={messages}
              loading={loadingTrack}
              onSubmit={handleSubmitPrompt}
              onOpenStaging={() => handleOpenStaging(stagingPrompt || "Autonomous build task")}
              onOpenTeardown={() => currentTeardown && setCurrentTeardown({ ...currentTeardown })}
              aside={
                area === "idea" ? (
                  <p className="text-xs text-zinc-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" aria-hidden="true" />
                    Tool to launch: <span className="font-semibold text-zinc-100">{activeTool}</span>
                  </p>
                ) : (
                  <ErrorBoundary panelName="BYOK Settings">
                    <BYOKSettings config={byokConfig} onChange={saveByok} keyStorage={keyStorage} loadError={byokLoadError} />
                  </ErrorBoundary>
                )
              }
            />
          )}

          {area === "skills" && (
            <div className="flex-1 overflow-y-auto">
              <SkillCatalog skills={skills} onToggle={handleToggleSkill} onSave={handleSaveSkillModification} />
            </div>
          )}

          {area === "settings" && (
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-4xl mx-auto w-full p-6 space-y-4">
                <div>
                  <h2 className="text-base font-semibold text-zinc-100">Settings</h2>
                  <p className="text-xs text-zinc-400 mt-0.5">Your own model provider (BYOK), used by pitch mode and planning. Project folders are set in Projects.</p>
                </div>
                <ErrorBoundary panelName="BYOK Settings">
                  <BYOKSettings config={byokConfig} onChange={saveByok} keyStorage={keyStorage} loadError={byokLoadError} />
                </ErrorBoundary>
              </div>
            </div>
          )}
        </main>
      </div>

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

    </div>
  );
}

export default App;
