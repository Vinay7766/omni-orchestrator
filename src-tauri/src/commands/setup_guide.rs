//! Checks for the setup guide (E9, NTU-4): is Git installed, and opening a project folder in the
//! system's file manager. Steps on third-party sites (accounts, repositories) are explained in the
//! guide, never performed or checked here.

use std::fs;
use std::path::PathBuf;
use std::process::Command;

/// The version from `git --version` output; None when the output is not Git's.
pub fn parse_git_version(output: &str) -> Option<String> {
    output.lines().next()?.trim().strip_prefix("git version ").map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

/// The folder to open: a full path to an existing folder, not a link. A file is never opened,
/// because opening a file can run it.
pub fn folder_to_open(path: &str) -> Result<PathBuf, String> {
    let dir = PathBuf::from(path);
    if !dir.is_absolute() {
        return Err(format!("\"{}\" is not a full folder path.", path));
    }
    let meta = fs::symlink_metadata(&dir).map_err(|_| format!("{} does not exist.", dir.display()))?;
    if meta.file_type().is_symlink() {
        return Err(format!("{} is a link, so it was not opened.", dir.display()));
    }
    if !meta.is_dir() {
        return Err(format!("{} is not a folder.", dir.display()));
    }
    Ok(dir)
}

/// Git's version, or None when Git is not installed (or not on PATH).
#[tauri::command]
pub async fn git_version() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| match Command::new("git").arg("--version").output() {
        Ok(out) if out.status.success() => parse_git_version(&String::from_utf8_lossy(&out.stdout)),
        _ => None,
    })
    .await
    .map_err(|e| e.to_string())
}

/// Opens a folder in the system's file manager ("open this folder", NTU-4).
#[tauri::command]
pub async fn open_folder(path: String) -> Result<(), String> {
    let dir = folder_to_open(&path)?;
    tauri_plugin_opener::open_path(&dir, None::<&str>).map_err(|e| format!("{} could not be opened: {}", dir.display(), e))
}
