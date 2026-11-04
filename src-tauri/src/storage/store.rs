use std::fs;
use std::path::PathBuf;
use crate::models::{AppSettings, BYOKConfig, ByokState, KeyStorageStatus, Skill, ProjectSession};
use crate::storage::secrets::SecretStore;

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

    /// What the person typed but has not saved into a project yet (issue B): one JSON document,
    /// written through a temporary file and a rename, so a crash never leaves half of it.
    pub fn load_ui_state(&self) -> Result<Option<String>, String> {
        match fs::read_to_string(self.base_dir.join("ui-state.json")) {
            Ok(text) => Ok(Some(text)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("Could not read the saved drafts: {}", e)),
        }
    }

    pub fn save_ui_state(&self, text: &str) -> Result<(), String> {
        const MAX: usize = 2 * 1024 * 1024;
        if text.len() > MAX {
            return Err(format!("The drafts are over {} MB and were not saved.", MAX / (1024 * 1024)));
        }
        serde_json::from_str::<serde_json::Value>(text).map_err(|e| format!("The drafts are not valid JSON: {}", e))?;
        fs::create_dir_all(&self.base_dir).map_err(|e| format!("Could not create {}: {}", self.base_dir.display(), e))?;
        let path = self.base_dir.join("ui-state.json");
        let temp = self.base_dir.join("ui-state.json.tmp");
        fs::write(&temp, text).map_err(|e| format!("Could not save the drafts: {}", e))?;
        fs::rename(&temp, &path).map_err(|e| format!("Could not save the drafts: {}", e))
    }

    pub fn get_session_state_path(&self) -> PathBuf {
        self.base_dir.join("session_state.json")
    }

    /// App settings without API keys (keys are only read through `load_byok`).
    pub fn load_settings(&self) -> Result<AppSettings, String> {
        if !self.get_settings_path().exists() {
            let default_settings = AppSettings::default();
            self.save_settings(&default_settings)?;
            return Ok(default_settings);
        }
        let mut settings = self.read_settings()?;
        settings.byok = settings.byok.without_secrets();
        Ok(settings)
    }

    /// Writes settings. API keys are always removed first, whatever the caller passed (NFR-10).
    pub fn save_settings(&self, settings: &AppSettings) -> Result<(), String> {
        let mut stripped = settings.clone();
        stripped.byok = stripped.byok.without_secrets();
        let content = serde_json::to_string_pretty(&stripped)
            .map_err(|e| format!("Failed to serialize settings: {}", e))?;
        fs::write(self.get_settings_path(), content).map_err(|e| format!("Failed to write settings: {}", e))
    }

    /// Saves settings from screens other than BYOK: their copy of `byok` may be stale, so the
    /// saved BYOK settings are kept (they change only through `save_byok`).
    pub fn save_settings_keeping_byok(&self, settings: &AppSettings) -> Result<(), String> {
        let mut next = settings.clone();
        next.byok = self.read_settings()?.byok;
        self.save_settings(&next)
    }

    /// BYOK settings for the app: saved fields plus keys from the credential store. A key
    /// still in settings.json from an older version is moved to the store and removed from
    /// the file (kept for this session only when there is no store).
    pub fn load_byok(&self, secrets: &dyn SecretStore) -> Result<ByokState, String> {
        let mut settings = self.read_settings()?;
        let mut config = settings.byok.without_secrets();
        let mut legacy = Vec::new();
        for name in BYOKConfig::SECRET_FIELDS {
            if let Some(value) = settings.byok.secret_mut(name).and_then(|v| v.take()).filter(|v| !v.trim().is_empty()) {
                legacy.push((name, value));
            }
        }

        let key_storage = match secrets.status() {
            Ok(()) => {
                for name in BYOKConfig::SECRET_FIELDS {
                    if let Some(value) = secrets.get(name)? {
                        *config.secret_mut(name).expect("known field") = Some(value);
                    }
                }
                for (name, value) in &legacy {
                    let field = config.secret_mut(name).expect("known field");
                    if field.is_none() {
                        secrets.set(name, value)?;
                        *field = Some(value.clone());
                    }
                }
                KeyStorageStatus { available: true, message: None }
            }
            Err(message) => {
                for (name, value) in &legacy {
                    *config.secret_mut(name).expect("known field") = Some(value.clone());
                }
                KeyStorageStatus { available: false, message: Some(message) }
            }
        };

        if !legacy.is_empty() {
            self.save_settings(&settings)?;
        }
        Ok(ByokState { config, key_storage })
    }

    /// Saves BYOK settings: keys to the credential store (an empty key is removed), the rest
    /// to settings.json. Without a store, keys are not kept and the status says why.
    pub fn save_byok(&self, byok: &BYOKConfig, secrets: &dyn SecretStore) -> Result<KeyStorageStatus, String> {
        let mut settings = self.read_settings()?;
        settings.byok = byok.without_secrets();
        self.save_settings(&settings)?;

        if let Err(message) = secrets.status() {
            return Ok(KeyStorageStatus { available: false, message: Some(message) });
        }
        let mut byok = byok.clone();
        for name in BYOKConfig::SECRET_FIELDS {
            match byok.secret_mut(name).expect("known field").as_deref().map(str::trim) {
                Some(value) if !value.is_empty() => secrets.set(name, value)?,
                _ => secrets.delete(name)?,
            }
        }
        Ok(KeyStorageStatus { available: true, message: None })
    }

    /// Settings exactly as saved (defaults when there is no file yet).
    fn read_settings(&self) -> Result<AppSettings, String> {
        let path = self.get_settings_path();
        if !path.exists() {
            return Ok(AppSettings::default());
        }
        let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read settings: {}", e))?;
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse settings JSON: {}", e))
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
