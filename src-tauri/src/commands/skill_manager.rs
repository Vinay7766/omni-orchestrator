use std::fs;
use std::path::PathBuf;
use std::collections::HashMap;
use crate::models::Skill;
use crate::storage::store::StorageManager;

#[derive(Clone)]
pub struct SkillManager {
    storage: StorageManager,
    states_path: PathBuf,
}

impl SkillManager {
    pub fn new(base_dir: PathBuf) -> Self {
        let storage = StorageManager::new(base_dir.clone());
        let states_path = base_dir.join("skill_states.json");
        Self { storage, states_path }
    }

    pub fn default_system() -> Self {
        let storage = StorageManager::default_system();
        let states_path = storage.get_settings_path().parent().unwrap().join("skill_states.json");
        Self { storage, states_path }
    }

    fn load_states(&self) -> HashMap<String, bool> {
        if let Ok(content) = fs::read_to_string(&self.states_path) {
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            HashMap::new()
        }
    }

    fn save_states(&self, states: &HashMap<String, bool>) -> Result<(), String> {
        let content = serde_json::to_string_pretty(states)
            .map_err(|e| format!("Failed to serialize skill states: {}", e))?;
        fs::write(&self.states_path, content).map_err(|e| format!("Failed to write skill states: {}", e))
    }

    pub fn get_default_skills(&self) -> Vec<Skill> {
        // Assembled from /skills by build.rs.
        const ALL_SKILLS_JSON: &str = include_str!(concat!(env!("OUT_DIR"), "/skills.json"));
        // The catalog is compiled in and covered by tests, so a parse failure is a
        // build defect. Fail loudly rather than silently showing zero skills.
        serde_json::from_str::<Vec<Skill>>(ALL_SKILLS_JSON)
            .unwrap_or_else(|e| panic!("bundled skill catalog does not match the Skill model: {}", e))
    }

    pub fn get_all_skills(&self) -> Result<Vec<Skill>, String> {
        let default_skills = self.get_default_skills();
        let custom_skills = self.storage.load_custom_skills().unwrap_or_default();
        let mut skill_map: HashMap<String, Skill> = HashMap::new();

        for skill in default_skills {
            skill_map.insert(skill.id.clone(), skill);
        }
        for skill in custom_skills {
            skill_map.insert(skill.id.clone(), skill);
        }

        let states = self.load_states();
        let mut result: Vec<Skill> = skill_map.into_values().collect();
        result.sort_by(|a, b| a.name.cmp(&b.name));

        for skill in &mut result {
            if let Some(&state) = states.get(&skill.id) {
                skill.enabled = state;
            }
        }

        Ok(result)
    }

    pub fn toggle_skill(&self, skill_id: &str, enabled: bool) -> Result<(), String> {
        let mut states = self.load_states();
        states.insert(skill_id.to_string(), enabled);
        self.save_states(&states)
    }

    pub fn update_skill(
        &self,
        skill_id: &str,
        new_content: String,
        new_description: String,
    ) -> Result<Skill, String> {
        let mut skills = self.get_all_skills()?;
        if let Some(skill) = skills.iter_mut().find(|s| s.id == skill_id) {
            skill.content = new_content;
            if !new_description.is_empty() {
                skill.description = new_description;
            }
            skill.is_custom = true;
            let updated = skill.clone();
            self.storage.save_custom_skill(updated.clone())?;
            return Ok(updated);
        }
        Err(format!("Skill '{}' not found", skill_id))
    }
}

#[tauri::command]
pub fn get_skills() -> Result<Vec<Skill>, String> {
    let manager = SkillManager::default_system();
    manager.get_all_skills()
}

#[tauri::command]
pub fn toggle_skill(skill_id: String, enabled: bool) -> Result<(), String> {
    let manager = SkillManager::default_system();
    manager.toggle_skill(&skill_id, enabled)
}

#[tauri::command]
pub fn update_skill_content(
    skill_id: String,
    new_content: String,
    new_description: String,
) -> Result<Skill, String> {
    let manager = SkillManager::default_system();
    manager.update_skill(&skill_id, new_content, new_description)
}
