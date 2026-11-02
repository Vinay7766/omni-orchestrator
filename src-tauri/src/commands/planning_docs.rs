//! Planning documents in the user's project (E5, PLAN-2). The planning workspace writes each
//! phase's document to `docs/planning/<name>.md`. The web view gets no wider file access:
//! - the project folder must be absolute and already hold `.agents/project.json`;
//! - `name` is a plain file name: lowercase letters, digits and '-', ending in ".md";
//! - `docs`, `docs/planning` and the file itself may not be links (a cloned repository could
//!   ship a link that points elsewhere);
//! - documents are capped in size.

use std::fs;
use std::path::{Path, PathBuf};

const MAX_DOCUMENT_BYTES: usize = 2_000_000;

fn is_link(path: &Path) -> bool {
    fs::symlink_metadata(path).map(|m| m.file_type().is_symlink()).unwrap_or(false)
}

fn valid_name(name: &str) -> bool {
    match name.strip_suffix(".md") {
        Some(stem) => {
            !stem.is_empty()
                && stem.len() <= 80
                && stem.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        }
        None => false,
    }
}

/// The checked path of `docs/planning/<name>` in the project at `root`.
fn document_path(root: &str, name: &str) -> Result<PathBuf, String> {
    let root = Path::new(root);
    if !root.is_absolute() {
        return Err(format!("the project folder must be an absolute path: {}", root.display()));
    }
    if !root.join(".agents").join("project.json").is_file() {
        return Err(format!("{} is not an OmniOrchestrator project (no .agents/project.json)", root.display()));
    }
    if !valid_name(name) {
        return Err(format!(
            "\"{}\" is not a planning document name: use lowercase letters, digits and '-', ending in .md",
            name
        ));
    }
    let docs = root.join("docs");
    let planning = docs.join("planning");
    let file = planning.join(name);
    for part in [&docs, &planning, &file] {
        if is_link(part) {
            return Err(format!("{} is a link; planning documents are not written through links", part.display()));
        }
    }
    Ok(file)
}

#[tauri::command]
pub fn write_planning_document(root: String, name: String, content: String) -> Result<(), String> {
    let file = document_path(&root, &name)?;
    if content.len() > MAX_DOCUMENT_BYTES {
        return Err(format!("{} is too large ({} bytes; the limit is {})", name, content.len(), MAX_DOCUMENT_BYTES));
    }
    let planning = file.parent().ok_or("no parent folder")?;
    fs::create_dir_all(planning).map_err(|e| format!("cannot create {}: {}", planning.display(), e))?;
    fs::write(&file, content).map_err(|e| format!("cannot write {}: {}", file.display(), e))
}

/// The document's text, or None if it has not been written yet.
#[tauri::command]
pub fn read_planning_document(root: String, name: String) -> Result<Option<String>, String> {
    let file = document_path(&root, &name)?;
    match fs::read_to_string(&file) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("cannot read {}: {}", file.display(), e)),
    }
}
