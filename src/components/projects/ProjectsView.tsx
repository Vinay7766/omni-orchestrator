import React, { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "../../lib/types";
import { loadProjectDetail, loadProjects } from "../../lib/projects";
import { ProjectsList } from "./ProjectsList";
import { ProjectDetail } from "./ProjectDetail";

/** The projects list wired to the app: folders come from and are saved to the app settings. */
export const ProjectsView: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);

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
  if (opened) return <ProjectDetail root={opened} load={loadDetail} onBack={() => setOpened(null)} />;
  return <ProjectsList folders={settings.projectFolders ?? []} onFoldersChange={(f) => void saveFolders(f)} load={load} onOpen={setOpened} />;
};
