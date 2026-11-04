import React, { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "../../lib/types";
import { loadProjectDetail, loadProjects } from "../../lib/projects";
import { ProjectsList } from "./ProjectsList";
import { ProjectDetail, type DecideFns, type PlanningFns } from "./ProjectDetail";
import { approve, requestChanges, runOptional, skipOptional } from "../../lib/decisions";
import { addEntry, loadMemoryFiles, updateProjectDetails } from "../../lib/memory";
import type { Invoke } from "@omni/core";
import { discoverTools, handOffTool, loadTeam, saveTeamSelection } from "../../lib/team";
import type { TeamFns } from "../team/TeamPanel";
import type { FreshSessionFns } from "../team/FreshSessionPanel";
import { startFreshSession } from "../../lib/fresh-session";
import { watchProject } from "../../lib/live";
import { showRefInFolder } from "../../lib/refs";
import { handInBuild } from "../../lib/build";

/** The projects list wired to the app: folders come from and are saved to the app settings. */
const tauri: Invoke = (command, args) => invoke(command, args);
/** The person's decisions, recorded through @omni/core over the app's memfs commands. */
const decide: DecideFns = {
  approve: (root, phase) => approve(tauri, root, phase),
  requestChanges: (root, phase, notes) => requestChanges(tauri, root, phase, notes),
  run: (root, phase) => runOptional(tauri, root, phase),
  skip: (root, phase, reason) => skipOptional(tauri, root, phase, reason),
  handInBuild: (root) => handInBuild(tauri, root),
};

/** Files and commits in the workflow details (P-E8-02): a file's folder opens; a commit is copied. */
const refs = {
  showInFolder: (root: string, path: string) => showRefInFolder(tauri, root, path),
  copy: (text: string) => navigator.clipboard.writeText(text),
};

/** The project's name and mode, changed by the person. */
const details = { update: (root: string, changes: { name?: string; mode?: "full" | "simple" }) => updateProjectDetails(tauri, root, changes) };

/** The project's memory files and the person's own entries, over the app's memfs commands. */
const memory = {
  load: (root: string) => loadMemoryFiles(tauri, root),
  add: (root: string, entry: Parameters<typeof addEntry>[2]) => addEntry(tauri, root, entry),
};

/** Tools for the build (E6): discovery, the person's selection, and the handoff to each tool. */
const team: TeamFns = {
  discover: (fresh) => discoverTools(tauri, { fresh }),
  load: (root) => loadTeam(tauri, root),
  save: (root, selection) => saveTeamSelection(tauri, root, selection),
  handOff: (root, toolId) => handOffTool(tauri, root, toolId),
};

/** The next phase in a fresh session (E11): the project's tools, and the start command. */
const fresh: FreshSessionFns = {
  loadTeam: (root) => loadTeam(tauri, root),
  start: (root, toolId) => startFreshSession(tauri, root, toolId),
};

/** Live updates (E7): the open project follows its events.jsonl through the app's backend. */
const watch = (root: string, onChange: () => void, onError: (message: string) => void) => watchProject(tauri, root, onChange, onError);

/** `openRoot`: a project to show straight away (one just created from an idea). */
export const ProjectsView: React.FC<{ openRoot?: string; planning?: PlanningFns }> = ({ openRoot, planning }) => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(openRoot ?? null);

  useEffect(() => {
    invoke<AppSettings>("get_app_settings")
      .then(setSettings)
      .catch((e) => setFailure(`Settings could not be read: ${String(e)}`));
  }, []);

  const load = useCallback((folders: string[]) => loadProjects((command, args) => invoke(command, args), folders), []);
  const loadDetail = useCallback((root: string) => loadProjectDetail((command, args) => invoke(command, args), root), []);

  const saveFolders = async (projectFolders: string[]) => {
    if (!settings) return;
    const next = { ...settings, projectFolders };
    try {
      await invoke("save_app_settings", { settings: next });
      setSettings(next);
    } catch (e) {
      setFailure(`The folder list could not be saved: ${String(e)}`);
    }
  };

  if (failure) {
    return (
      <p role="alert" className="p-6 text-sm text-red-400">
        {failure}
      </p>
    );
  }
  if (!settings) {
    return (
      <p role="status" className="p-6 text-sm text-zinc-400">
        Loading settings...
      </p>
    );
  }
  if (opened) return <ProjectDetail root={opened} load={loadDetail} onBack={() => setOpened(null)} decide={decide} details={details} memory={memory} planning={planning} team={team} fresh={fresh} watch={watch} refs={refs} />;
  return <ProjectsList folders={settings.projectFolders ?? []} onFoldersChange={(f) => void saveFolders(f)} load={load} onOpen={setOpened} />;
};
