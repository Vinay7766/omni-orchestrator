//! File access for project memory, used by @omni/core running in the desktop web view
//! (createInvokeFs). This is a security boundary: anything running in the web view can call
//! these commands, so they only reach what project memory needs.
//!
//! Policy (checked before any disk access):
//! - paths must be absolute and must not contain ".." steps;
//! - writing, creating, renaming, removing and listing only inside a folder named `.agents`;
//! - that `.agents` folder must be real: if it, or anything inside it, is a symlink that leads
//!   elsewhere, the request is refused (a cloned repository could ship such links);
//! - reading only inside `.agents`, or a file named `.agents-link` (worktree discovery);
//! - `exists` is allowed for any absolute path (reference checks); it reveals no content.

use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Component, Path, PathBuf};

const AGENTS: &str = ".agents";
const LINK_FILE: &str = ".agents-link";

#[derive(Clone, Copy, PartialEq)]
enum Access {
    Read,
    Change,
    Exists,
}

fn is_agents(component: &Component) -> bool {
    matches!(component, Component::Normal(name) if *name == AGENTS)
}

/// The path up to and including its last `.agents` component, if any.
fn agents_folder(path: &Path) -> Option<PathBuf> {
    let components: Vec<Component> = path.components().collect();
    let index = components.iter().rposition(is_agents)?;
    Some(components[..=index].iter().collect())
}

/// The nearest folder at or above `path` that exists on disk.
fn deepest_existing(path: &Path) -> Option<PathBuf> {
    let mut current = Some(path);
    while let Some(p) = current {
        if p.exists() {
            return Some(p.to_path_buf());
        }
        current = p.parent();
    }
    None
}

/// Refuses paths whose `.agents` folder, or any existing part below it, resolves elsewhere.
fn check_no_symlink_escape(path: &Path, agents: &Path) -> Result<(), String> {
    if !agents.exists() {
        return Ok(()); // first use: the folder is about to be created as a real directory
    }
    let real_agents = fs::canonicalize(agents).map_err(|e| format!("cannot resolve {}: {}", agents.display(), e))?;
    if real_agents.file_name().map(|n| n != AGENTS).unwrap_or(true) {
        return Err(format!("{} is a symlink to another folder; refusing to use it", agents.display()));
    }
    if let Some(existing) = deepest_existing(path) {
        let real = fs::canonicalize(&existing).map_err(|e| format!("cannot resolve {}: {}", existing.display(), e))?;
        if !real.starts_with(&real_agents) && !real_agents.starts_with(&real) {
            return Err(format!("{} leads outside {} through a link; refusing", path.display(), agents.display()));
        }
    }
    Ok(())
}

fn checked(path: &str, access: Access) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if !p.is_absolute() {
        return Err(format!("path must be absolute: {}", path));
    }
    if p.components().any(|c| c == Component::ParentDir) {
        return Err(format!("path must not contain '..': {}", path));
    }
    if access == Access::Exists {
        return Ok(p);
    }
    match agents_folder(&p) {
        Some(agents) => {
            check_no_symlink_escape(&p, &agents)?;
            Ok(p)
        }
        None if access == Access::Read && p.file_name().map(|n| n == LINK_FILE).unwrap_or(false) => Ok(p),
        None => Err(format!("only paths inside a .agents folder are allowed: {}", path)),
    }
}

/// Windows briefly answers "access denied" for a file that is being deleted or is held open
/// (the same behaviour the Node adapter handles). Retry such errors a few times on Windows.
fn retry<T>(mut op: impl FnMut() -> std::io::Result<T>) -> std::io::Result<T> {
    let mut attempt = 0;
    loop {
        match op() {
            Err(e) if cfg!(windows) && e.kind() == ErrorKind::PermissionDenied && attempt < 20 => {
                attempt += 1;
                std::thread::sleep(std::time::Duration::from_millis(5 + attempt * 5));
            }
            other => return other,
        }
    }
}

fn io_err(action: &str, path: &Path, e: std::io::Error) -> String {
    format!("cannot {} {}: {}", action, path.display(), e)
}

#[tauri::command]
pub fn memfs_read_text(path: String) -> Result<Option<String>, String> {
    let p = checked(&path, Access::Read)?;
    match retry(|| fs::read_to_string(&p)) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io_err("read", &p, e)),
    }
}

#[tauri::command]
pub fn memfs_write_text(path: String, content: String) -> Result<(), String> {
    let p = checked(&path, Access::Change)?;
    fs::write(&p, content).map_err(|e| io_err("write", &p, e))
}

#[tauri::command]
pub fn memfs_append_text(path: String, content: String) -> Result<(), String> {
    let p = checked(&path, Access::Change)?;
    let mut file = OpenOptions::new().create(true).append(true).open(&p).map_err(|e| io_err("open", &p, e))?;
    file.write_all(content.as_bytes()).map_err(|e| io_err("append to", &p, e))
}

#[tauri::command]
pub fn memfs_create_exclusive(path: String, content: String) -> Result<bool, String> {
    let p = checked(&path, Access::Change)?;
    match OpenOptions::new().write(true).create_new(true).open(&p) {
        Ok(mut file) => {
            file.write_all(content.as_bytes()).map_err(|e| io_err("write", &p, e))?;
            Ok(true)
        }
        Err(e) if e.kind() == ErrorKind::AlreadyExists => Ok(false),
        // A lock file being deleted on Windows: treat like an existing one; the caller retries.
        Err(e) if cfg!(windows) && e.kind() == ErrorKind::PermissionDenied => Ok(false),
        Err(e) => Err(io_err("create", &p, e)),
    }
}

#[tauri::command]
pub fn memfs_exists(path: String) -> Result<bool, String> {
    let p = checked(&path, Access::Exists)?;
    Ok(p.exists())
}

#[tauri::command]
pub fn memfs_mkdir(path: String) -> Result<(), String> {
    let p = checked(&path, Access::Change)?;
    fs::create_dir_all(&p).map_err(|e| io_err("create folder", &p, e))
}

#[tauri::command]
pub fn memfs_rename(from: String, to: String) -> Result<(), String> {
    let source = checked(&from, Access::Change)?;
    let target = checked(&to, Access::Change)?;
    retry(|| fs::rename(&source, &target)).map_err(|e| io_err("rename", &source, e))
}

#[tauri::command]
pub fn memfs_remove(path: String) -> Result<(), String> {
    let p = checked(&path, Access::Change)?;
    match retry(|| fs::remove_file(&p)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(io_err("remove", &p, e)),
    }
}

#[tauri::command]
pub fn memfs_list(path: String) -> Result<Vec<String>, String> {
    let p = checked(&path, Access::Change)?;
    match fs::read_dir(&p) {
        Ok(entries) => Ok(entries.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).collect()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(io_err("list", &p, e)),
    }
}

/// A short text that changes whenever the file's size or last-change time changes, or None
/// if the file does not exist. The desktop app checks this often to notice new events (E7)
/// without reading the whole log each time. Same path policy as reading.
#[tauri::command]
pub fn memfs_stamp(path: String) -> Result<Option<String>, String> {
    let p = checked(&path, Access::Read)?;
    match retry(|| fs::metadata(&p)) {
        Ok(info) => {
            let changed = info
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            Ok(Some(format!("{}:{}", info.len(), changed)))
        }
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io_err("check", &p, e)),
    }
}
