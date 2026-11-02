import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  TrackType,
  ChatMessage,
  Skill,
  TeardownResponse,
  BYOKConfig,
  ByokState,
  KeyStorageStatus,
  AppSettings,
} from "./lib/types";
import { ChatArea } from "./components/chat/ChatArea";
import { TeardownViewer } from "./components/track-b/TeardownViewer";
import { BYOKSettings } from "./components/track-b/BYOKSettings";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SkillCatalog } from "./components/skills/SkillCatalog";
import { Terminal } from "lucide-react";
import { ProjectsView } from "./components/projects/ProjectsView";
import { AreaNav, type Area } from "./components/layout/AreaNav";
import { StartFromIdea } from "./components/planning/StartFromIdea";
import { createProjectFromIdea, hasProvider } from "./lib/planning";
import { runPhase } from "./lib/phase-runner";
import type { PlanningFns } from "./components/projects/ProjectDetail";

const tauri = (command: string, args?: Record<string, unknown>) => invoke(command, args);

export function App() {
  const [area, setArea] = useState<Area>("projects");
  // A project to open when the Projects area shows (one just created from an idea).
  const [openRoot, setOpenRoot] = useState<string | undefined>(undefined);
  // Pitch mode's conversation (the idea area is a form, not a chat, since E5).
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingTrack, setLoadingTrack] = useState<TrackType | null>(null);
  const [byokConfig, setByokConfig] = useState<BYOKConfig>({});
  const [keyStorage, setKeyStorage] = useState<KeyStorageStatus | undefined>(undefined);
  const [byokLoadError, setByokLoadError] = useState<string | undefined>(undefined);

  const [currentTeardown, setCurrentTeardown] = useState<TeardownResponse | null>(null);

  // System State
  const [skills, setSkills] = useState<Skill[]>([]);
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
      const skillList = await invoke<Skill[]>("get_skills");
      setSkills(skillList);
    } catch {
      // Fallback
    }

    try {
      const path = await invoke<string>("get_default_project_path");
      setDefaultProjectPath(path.replace(/\\/g, "/"));
    } catch {
      setDefaultProjectPath("");
    }
  };

  // A project created from an idea: its parent folder joins the Projects folder list (so it is
  // listed there), then it opens in Projects, where its planning phases run.
  const handleProjectCreated = async (root: string, parent: string) => {
    try {
      const settings = await invoke<AppSettings>("get_app_settings");
      const folders = settings.projectFolders ?? [];
      if (!folders.includes(parent)) {
        await invoke("save_app_settings", { settings: { ...settings, projectFolders: [...folders, parent] } });
      }
    } catch {
      // The project exists and still opens below; it is listed once its folder is added in Projects.
    }
    setOpenRoot(root);
    setArea("projects");
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

  // Pitch mode: a teardown with the provider set up in Settings.
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
  };

  // Planning phases run with the model set up in Settings and the skill catalog (E5).
  const planning = useMemo<PlanningFns>(() => ({
    providerReady: hasProvider(byokConfig),
    run: async (root) => {
      const r = await runPhase(tauri, root, { byok: byokConfig, skills });
      if (!r.ok) return { ok: false, message: r.error };
      const note = r.trimmed.length > 0 ? ` Left out of the prompt for length: ${r.trimmed.join(", ")}.` : "";
      return { ok: true, message: r.message + note };
    },
    readDocument: (root, name) => invoke<string | null>("read_planning_document", { root, name }),
  }), [byokConfig, skills]);

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
        <AreaNav
          current={area}
          onChange={(next) => {
            setOpenRoot(undefined);
            setArea(next);
          }}
        />

        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {area === "projects" && (
            <div className="flex-1 overflow-y-auto">
              <ErrorBoundary panelName="Projects">
                <ProjectsView openRoot={openRoot} planning={planning} />
              </ErrorBoundary>
            </div>
          )}

          {area === "idea" && (
            <div className="flex-1 overflow-y-auto">
              <ErrorBoundary panelName="Start from an idea">
                <StartFromIdea
                  key={defaultProjectPath}
                  defaultParent={defaultProjectPath}
                  providerReady={hasProvider(byokConfig)}
                  create={(input) => createProjectFromIdea(tauri, input)}
                  onCreated={(root, parent) => void handleProjectCreated(root, parent)}
                  onOpenSettings={() => setArea("settings")}
                />
              </ErrorBoundary>
            </div>
          )}

          {area === "pitch" && (
            <ChatArea
              track="track-b"
              messages={messages}
              loading={loadingTrack}
              onSubmit={handleSubmitPrompt}
              onOpenTeardown={() => currentTeardown && setCurrentTeardown({ ...currentTeardown })}
              aside={
                <ErrorBoundary panelName="BYOK Settings">
                  <BYOKSettings config={byokConfig} onChange={saveByok} keyStorage={keyStorage} loadError={byokLoadError} />
                </ErrorBoundary>
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
