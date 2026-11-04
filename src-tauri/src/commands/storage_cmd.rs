use crate::models::{AppSettings, BYOKConfig, ByokState, KeyStorageStatus, Skill, ProjectSession};
use crate::storage::secrets::KeyringStore;
use crate::storage::store::StorageManager;

/// App settings without API keys.
#[tauri::command]
pub fn get_app_settings() -> Result<AppSettings, String> {
    let storage = StorageManager::default_system();
    storage.load_settings()
}

/// Saves app settings; BYOK settings are left as saved (they change through `save_byok_config`).
#[tauri::command]
pub fn save_app_settings(settings: AppSettings) -> Result<(), String> {
    let storage = StorageManager::default_system();
    storage.save_settings_keeping_byok(&settings)
}

/// BYOK settings with keys from the OS credential store, and whether keys can be kept.
#[tauri::command]
pub fn get_byok_config() -> Result<ByokState, String> {
    StorageManager::default_system().load_byok(&KeyringStore)
}

/// Saves BYOK settings: keys to the OS credential store, the rest to settings.json (NFR-10).
#[tauri::command]
pub fn save_byok_config(byok: BYOKConfig) -> Result<KeyStorageStatus, String> {
    StorageManager::default_system().save_byok(&byok, &KeyringStore)
}

#[tauri::command]
pub fn get_custom_skills() -> Result<Vec<Skill>, String> {
    let storage = StorageManager::default_system();
    storage.load_custom_skills()
}

#[tauri::command]
pub fn save_custom_skill(skill: Skill) -> Result<(), String> {
    let storage = StorageManager::default_system();
    storage.save_custom_skill(skill)
}

#[tauri::command]
pub fn delete_custom_skill(skill_id: String) -> Result<(), String> {
    let storage = StorageManager::default_system();
    storage.delete_custom_skill(&skill_id)
}

#[tauri::command]
pub fn get_session_state() -> Result<Option<ProjectSession>, String> {
    let storage = StorageManager::default_system();
    storage.load_session_state()
}

#[tauri::command]
pub fn save_session_state(session: ProjectSession) -> Result<(), String> {
    let storage = StorageManager::default_system();
    storage.save_session_state(&session)
}

/// Writes an exported document to the path the person chose in the save dialog, adding ".md"
/// when they typed no extension (retest bug 4). Returns where it was written.
pub fn write_export(path: &std::path::Path, content: &str) -> Result<std::path::PathBuf, String> {
    let path = if path.extension().is_none() { path.with_extension("md") } else { path.to_path_buf() };
    std::fs::write(&path, content).map_err(|e| format!("Could not write {}: {}", path.display(), e))?;
    Ok(path)
}

/// Saves a Markdown export through the system's save dialog, opened here in Rust, so the web view
/// never chooses a path to write (retest bug 4). Returns the path written, or None when cancelled.
#[tauri::command]
pub async fn export_markdown(app: tauri::AppHandle, file_name: String, content: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    // Only a file name is offered to the dialog: never a folder from the web view.
    let name: String = file_name.chars().filter(|c| !matches!(c, '/' | '\\' | ':')).take(120).collect();
    let picked = tauri::async_runtime::spawn_blocking(move || app.dialog().file().set_file_name(name).add_filter("Markdown", &["md"]).blocking_save_file())
        .await
        .map_err(|e| e.to_string())?;
    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let written = tauri::async_runtime::spawn_blocking(move || write_export(&path, &content)).await.map_err(|e| e.to_string())??;
    Ok(Some(written.to_string_lossy().into_owned()))
}

/// The person's unsaved drafts (issue B), read on start and saved as they type.
#[tauri::command]
pub async fn load_ui_state() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| StorageManager::default_system().load_ui_state()).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_ui_state(text: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || StorageManager::default_system().save_ui_state(&text)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_default_project_path() -> String {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| "C:\\Users\\User".to_string());
    format!("{}\\Projects\\MyApp", home)
}
