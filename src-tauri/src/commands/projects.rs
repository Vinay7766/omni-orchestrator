//! Finds OmniOrchestrator projects under the folders the person configured (E2, APP-1).
//! Returns project roots only: their memory is read by @omni/core in the app (through the
//! memfs commands), so the phase rules exist once. Read-only and bounded: folders such as a
//! home folder or a projects folder full of node_modules stay quick.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// The configured folder, its children and grandchildren (~/Projects/<p>, ~/Projects/<group>/<p>).
const MAX_DEPTH: usize = 2;
const MAX_ENTRIES_PER_FOLDER: usize = 200;
const MAX_PROJECTS: usize = 500;

/// Kinds of folder that hold dependencies, build output or tool caches, never a project root.
const SKIP: &[&str] = &["node_modules", "target", "dist", "build", "out", "vendor", "venv", "__pycache__"];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FoundProjects {
    /// Project roots (folders holding .agents/project.json), sorted, each once.
    pub roots: Vec<String>,
    /// Configured folders that could not be searched, with the reason.
    pub errors: Vec<String>,
}

fn is_project(dir: &Path) -> bool {
    dir.join(".agents").join("project.json").is_file()
}

fn search(dir: &Path, depth: usize, found: &mut BTreeSet<String>) {
    if found.len() >= MAX_PROJECTS {
        return;
    }
    if is_project(dir) {
        found.insert(dir.to_string_lossy().into_owned());
        return; // a project's own subfolders are its code, not more projects
    }
    if depth == MAX_DEPTH {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.filter_map(|e| e.ok()).take(MAX_ENTRIES_PER_FOLDER) {
        // file_type does not follow symlinks: a linked folder is not searched.
        if !entry.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if name.starts_with('.') || SKIP.contains(&name.as_str()) {
            continue;
        }
        search(&entry.path(), depth + 1, found);
    }
}

/// Searches each folder (absolute, existing) for projects.
pub fn find_projects_in(folders: &[String]) -> FoundProjects {
    let mut found = BTreeSet::new();
    let mut errors = Vec::new();
    for folder in folders {
        let path = PathBuf::from(folder.trim());
        if folder.trim().is_empty() || !path.is_absolute() {
            errors.push(format!("\"{}\" is not an absolute folder path.", folder));
        } else if !path.is_dir() {
            errors.push(format!("{} does not exist or is not a folder.", folder));
        } else {
            search(&path, 0, &mut found);
        }
    }
    FoundProjects { roots: found.into_iter().collect(), errors }
}

/// The app's list of the person's projects, in its data folder, read by the MCP server: besides
/// the project it was started in, the only projects it may open (RT-14, RT-15).
pub const REGISTRY_FILE: &str = "projects.json";

/// Writes the registered projects for the MCP server (`{"formatVersion":1,"roots":[...]}`).
pub fn write_registry(app_dir: &Path, roots: &[String]) -> Result<(), String> {
    fs::create_dir_all(app_dir).map_err(|e| e.to_string())?;
    let body = serde_json::json!({ "formatVersion": 1, "roots": roots });
    let path = app_dir.join(REGISTRY_FILE);
    let tmp = app_dir.join(format!("{}.tmp", REGISTRY_FILE));
    fs::write(&tmp, serde_json::to_string_pretty(&body).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn find_projects(folders: Vec<String>) -> Result<FoundProjects, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let found = find_projects_in(&folders);
        // The list the person sees is the list the MCP server may serve. A failed write leaves the
        // previous list, which can only be narrower than or equal to what the person registered.
        let _ = write_registry(&crate::commands::mcp_setup::app_data_dir(), &found.roots);
        found
    })
    .await
    .map_err(|e| e.to_string())
}
