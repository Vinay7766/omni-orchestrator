use std::fs;
use std::path::PathBuf;
use crate::models::{AppSettings, Skill, ProjectSession};

#[derive(Clone)]
pub struct StorageManager {
    base_dir: PathBuf,
}

impl Default for StorageManager {
    fn default() -> Self {
        Self::default_system()
    }
}

impl StorageManager {
    pub fn new(base_dir: PathBuf) -> Self {
        if !base_dir.exists() {
            let _ = fs::create_dir_all(&base_dir);
        }
        Self { base_dir }
    }

    pub fn default_system() -> Self {
        let dir = Self::resolve_default_dir();
        Self::new(dir)
    }

    fn resolve_default_dir() -> PathBuf {
        if let Ok(appdata) = std::env::var("APPDATA") {
            PathBuf::from(appdata).join("AgentOrchestrator")
        } else if let Ok(home) = std::env::var("HOME") {
            PathBuf::from(home).join(".config").join("AgentOrchestrator")
        } else {
            PathBuf::from(".agent-orchestrator")
        }
    }

    pub fn get_settings_path(&self) -> PathBuf {
        self.base_dir.join("settings.json")
    }

    pub fn get_custom_skills_path(&self) -> PathBuf {
        self.base_dir.join("custom_skills.json")
    }

    pub fn get_session_state_path(&self) -> PathBuf {
        self.base_dir.join("session_state.json")
    }

    pub fn load_settings(&self) -> Result<AppSettings, String> {
        let path = self.get_settings_path();
        if !path.exists() {
            let default_settings = AppSettings::default();
            self.save_settings(&default_settings)?;
            return Ok(default_settings);
        }

        let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read settings: {}", e))?;
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse settings JSON: {}", e))
    }

    pub fn save_settings(&self, settings: &AppSettings) -> Result<(), String> {
        let path = self.get_settings_path();
        let content = serde_json::to_string_pretty(settings)
            .map_err(|e| format!("Failed to serialize settings: {}", e))?;
        fs::write(&path, content).map_err(|e| format!("Failed to write settings: {}", e))
    }

    pub fn load_custom_skills(&self) -> Result<Vec<Skill>, String> {
        let path = self.get_custom_skills_path();
        if !path.exists() {
            return Ok(Vec::new());
        }

        let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read custom skills: {}", e))?;
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse custom skills JSON: {}", e))
    }

    pub fn save_custom_skill(&self, skill: Skill) -> Result<(), String> {
        let mut skills = self.load_custom_skills()?;
        if let Some(pos) = skills.iter().position(|s| s.id == skill.id) {
            skills[pos] = skill;
        } else {
            skills.push(skill);
        }

        let path = self.get_custom_skills_path();
        let content = serde_json::to_string_pretty(&skills)
            .map_err(|e| format!("Failed to serialize skills: {}", e))?;
        fs::write(&path, content).map_err(|e| format!("Failed to write custom skills: {}", e))
    }

    pub fn delete_custom_skill(&self, skill_id: &str) -> Result<(), String> {
        let mut skills = self.load_custom_skills()?;
        skills.retain(|s| s.id != skill_id);

        let path = self.get_custom_skills_path();
        let content = serde_json::to_string_pretty(&skills)
            .map_err(|e| format!("Failed to serialize skills: {}", e))?;
        fs::write(&path, content).map_err(|e| format!("Failed to write custom skills: {}", e))
    }

    pub fn save_session_state(&self, session: &ProjectSession) -> Result<(), String> {
        let path = self.get_session_state_path();
        let content = serde_json::to_string_pretty(session)
            .map_err(|e| format!("Failed to serialize session state: {}", e))?;
        fs::write(&path, content).map_err(|e| format!("Failed to write session state: {}", e))
    }

    pub fn load_session_state(&self) -> Result<Option<ProjectSession>, String> {
        let path = self.get_session_state_path();
        if !path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read session state: {}", e))?;
        let session = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse session state JSON: {}", e))?;
        Ok(Some(session))
    }
}
