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

#[tauri::command]
pub fn get_default_project_path() -> String {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| "C:\\Users\\User".to_string());
    format!("{}\\Projects\\MyApp", home)
}

#[tauri::command]
pub fn generate_project_brief(idea: String) -> Result<String, String> {
    if idea.trim().is_empty() {
        return Err("Idea cannot be empty".to_string());
    }
    
    let brief = format!(
        "### Specification Brief Initialized\n\n**Idea:** {}\n\n**Next Steps:**\n- Structured PRD will be generated\n- Tools will be detected on your system\n- Skills will be configured for your project\n\nClick **Configure & Stage Run** to choose your project folder, target IDE, and customize which skills are active before launching.",
        idea.trim()
    );
    Ok(brief)
}
