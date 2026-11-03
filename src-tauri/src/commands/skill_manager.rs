//! The skill catalog the app shows (SKL-5, SKL-6): the bundled skills, plus the person's own
//! skills folder, which the MCP server reads too (`--user-skills`), so a skill added, edited or
//! switched off here reaches every AI tool. The folder is laid out like the bundled one:
//! `catalog.json` (same schema as skills/catalog.json, without the text) and `<id>/SKILL.md` for
//! added or edited skills, and `skills.json` (the skills-config schema) for on/off switches.
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::models::{AuthorAttribution, Skill, SkillCategory};
use crate::storage::store::StorageManager;

/// A skill's text is instructions for AI tools; anything larger is not a skill.
pub const MAX_SKILL_TEXT: usize = 128 * 1024;
const USER_DIR: &str = "skills";

/// What the person enters to add a skill of their own.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSkill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub content: String,
    pub phases: Vec<String>,
    pub author: String,
    pub source_url: String,
    pub license: String,
}

/// One entry of the person's catalog.json: the bundled catalog's fields, without the text.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogEntry {
    id: String,
    name: String,
    description: String,
    category: SkillCategory,
    attribution: AuthorAttribution,
    enabled: bool,
    is_custom: bool,
    license: String,
    phases: Vec<String>,
    domains: Vec<String>,
}

impl CatalogEntry {
    fn from_skill(skill: &Skill) -> Self {
        let mut attribution = skill.attribution.clone();
        attribution.avatar_url = None;
        Self {
            id: skill.id.clone(),
            name: skill.name.clone(),
            description: skill.description.clone(),
            category: skill.category.clone(),
            attribution,
            enabled: skill.enabled,
            is_custom: true,
            license: skill.license.clone().unwrap_or_else(|| "unverified".into()),
            phases: if skill.phases.is_empty() { vec!["all".into()] } else { skill.phases.clone() },
            domains: if skill.domains.is_empty() { vec!["general".into()] } else { skill.domains.clone() },
        }
    }

    fn into_skill(self, content: String) -> Skill {
        Skill {
            id: self.id,
            name: self.name,
            description: self.description,
            category: self.category,
            attribution: self.attribution,
            enabled: self.enabled,
            content,
            is_custom: self.is_custom,
            phases: self.phases,
            domains: self.domains,
            license: Some(self.license),
        }
    }
}

/// Every phase id in the shared contract, plus "all".
fn known_phases() -> Vec<String> {
    let doc: Value = serde_json::from_str(include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../schemas/phases.json"))).unwrap_or(Value::Null);
    let mut ids: Vec<String> = doc["flows"]
        .as_object()
        .map(|flows| flows.values().flat_map(|f| f.as_array().cloned().unwrap_or_default()).filter_map(|p| p.as_str().map(String::from)).collect())
        .unwrap_or_default();
    ids.push("all".into());
    ids
}

/// The catalog schema's id rule; also a single safe folder name.
fn valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit())
        && id.len() <= 100
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Writes through a temporary file and a rename, so a reader never sees half a file.
fn write_atomic(path: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Could not create {}: {}", parent.display(), e))?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, text).map_err(|e| format!("Could not write {}: {}", path.display(), e))?;
    fs::rename(&tmp, path).map_err(|e| format!("Could not save {}: {}", path.display(), e))
}

#[derive(Clone)]
pub struct SkillManager {
    storage: StorageManager,
    base_dir: PathBuf,
}

impl SkillManager {
    pub fn new(base_dir: PathBuf) -> Self {
        let storage = StorageManager::new(base_dir.clone());
        Self { storage, base_dir }
    }

    pub fn default_system() -> Self {
        let storage = StorageManager::default_system();
        let base_dir = storage.get_settings_path().parent().map(Path::to_path_buf).unwrap_or_default();
        Self { storage, base_dir }
    }

    /// The person's own skills folder, also given to the MCP server (`--user-skills`).
    pub fn user_skills_dir(&self) -> PathBuf {
        self.base_dir.join(USER_DIR)
    }

    fn user_catalog_path(&self) -> PathBuf {
        self.user_skills_dir().join("catalog.json")
    }

    fn states_path(&self) -> PathBuf {
        self.user_skills_dir().join("skills.json")
    }

    pub fn get_default_skills(&self) -> Vec<Skill> {
        // Assembled from /skills by build.rs.
        const ALL_SKILLS_JSON: &str = include_str!(concat!(env!("OUT_DIR"), "/skills.json"));
        // The catalog is compiled in and covered by tests, so a parse failure is a
        // build defect. Fail loudly rather than silently showing zero skills.
        serde_json::from_str::<Vec<Skill>>(ALL_SKILLS_JSON)
            .unwrap_or_else(|e| panic!("bundled skill catalog does not match the Skill model: {}", e))
    }


    fn read_user_catalog(&self) -> Result<Vec<CatalogEntry>, String> {
        let path = self.user_catalog_path();
        match fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str(&text).map_err(|e| format!("{} is not a valid skill catalog: {}", path.display(), e)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(e) => Err(format!("Could not read {}: {}", path.display(), e)),
        }
    }

    fn write_user_catalog(&self, entries: &[CatalogEntry]) -> Result<(), String> {
        let text = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;
        write_atomic(&self.user_catalog_path(), &(text + "\n"))
    }

    fn read_states(&self) -> Result<BTreeMap<String, bool>, String> {
        let path = self.states_path();
        let text = match fs::read_to_string(&path) {
            Ok(text) => text,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(BTreeMap::new()),
            Err(e) => return Err(format!("Could not read {}: {}", path.display(), e)),
        };
        let doc: Value = serde_json::from_str(&text).map_err(|e| format!("{} is not valid JSON: {}", path.display(), e))?;
        Ok(doc["skills"]
            .as_object()
            .map(|skills| skills.iter().filter_map(|(id, v)| v["enabled"].as_bool().map(|on| (id.clone(), on))).collect())
            .unwrap_or_default())
    }

    fn write_states(&self, states: &BTreeMap<String, bool>) -> Result<(), String> {
        let skills: serde_json::Map<String, Value> = states.iter().map(|(id, on)| (id.clone(), json!({ "enabled": on }))).collect();
        let text = serde_json::to_string_pretty(&json!({ "formatVersion": 1, "skills": skills })).map_err(|e| e.to_string())?;
        write_atomic(&self.states_path(), &(text + "\n"))
    }

    fn write_user_skill(&self, skill: &Skill) -> Result<(), String> {
        write_atomic(&self.user_skills_dir().join(&skill.id).join("SKILL.md"), &skill.content)?;
        let mut entries = self.read_user_catalog()?;
        let entry = CatalogEntry::from_skill(skill);
        match entries.iter().position(|e| e.id == skill.id) {
            Some(i) => entries[i] = entry,
            None => entries.push(entry),
        }
        self.write_user_catalog(&entries)
    }

    /// Moves skills edited and switches set before the shared folder existed into it, once. The
    /// old files are renamed, not deleted, so nothing is lost if something goes wrong.
    fn migrate_old_files(&self) -> Result<(), String> {
        let old_skills = self.storage.get_custom_skills_path();
        if old_skills.exists() {
            for skill in self.storage.load_custom_skills()? {
                self.write_user_skill(&skill)?;
            }
            fs::rename(&old_skills, old_skills.with_extension("json.moved")).map_err(|e| e.to_string())?;
        }
        let old_states = self.base_dir.join("skill_states.json");
        if old_states.exists() {
            let old: HashMap<String, bool> = serde_json::from_str(&fs::read_to_string(&old_states).map_err(|e| e.to_string())?).unwrap_or_default();
            let mut states = self.read_states()?;
            for (id, on) in old {
                states.entry(id).or_insert(on);
            }
            self.write_states(&states)?;
            fs::rename(&old_states, old_states.with_extension("json.moved")).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn get_all_skills(&self) -> Result<Vec<Skill>, String> {
        self.migrate_old_files()?;
        let mut skill_map: HashMap<String, Skill> = self.get_default_skills().into_iter().map(|s| (s.id.clone(), s)).collect();
        for entry in self.read_user_catalog()? {
            let path = self.user_skills_dir().join(&entry.id).join("SKILL.md");
            let content = match fs::read_to_string(&path) {
                Ok(text) => text.replace("\r\n", "\n"),
                // An entry without its own text keeps the bundled text, as the MCP server does.
                Err(_) => skill_map.get(&entry.id).map(|s| s.content.clone()).unwrap_or_default(),
            };
            skill_map.insert(entry.id.clone(), entry.into_skill(content));
        }
        let states = self.read_states()?;
        let mut result: Vec<Skill> = skill_map.into_values().collect();
        result.sort_by(|a, b| a.name.cmp(&b.name));
        for skill in &mut result {
            if let Some(&on) = states.get(&skill.id) {
                skill.enabled = on;
            }
        }
        Ok(result)
    }

    pub fn toggle_skill(&self, skill_id: &str, enabled: bool) -> Result<(), String> {
        self.migrate_old_files()?;
        let mut states = self.read_states()?;
        states.insert(skill_id.to_string(), enabled);
        self.write_states(&states)
    }

    pub fn update_skill(&self, skill_id: &str, new_content: String, new_description: String) -> Result<Skill, String> {
        if new_content.trim().is_empty() || new_content.len() > MAX_SKILL_TEXT {
            return Err(format!("A skill's text must be between 1 and {} KB.", MAX_SKILL_TEXT / 1024));
        }
        let mut skill = self
            .get_all_skills()?
            .into_iter()
            .find(|s| s.id == skill_id)
            .ok_or_else(|| format!("Skill '{}' not found", skill_id))?;
        skill.content = new_content;
        if !new_description.trim().is_empty() {
            if new_description.trim().chars().count() < 20 {
                return Err("The description must be at least 20 characters, so tools know when to use the skill.".into());
            }
            skill.description = new_description.trim().to_string();
        }
        skill.is_custom = true;
        self.write_user_skill(&skill)?;
        Ok(skill)
    }

    /// Adds the person's own skill (SKL-5) with its author, source and license (SKL-6). Refuses,
    /// with the reason, anything the catalog schema would not accept; nothing is written then.
    pub fn add_skill(&self, input: NewSkill) -> Result<Skill, String> {
        let id = input.id.trim().to_string();
        if !valid_id(&id) {
            return Err("The id must be lowercase letters, digits and dashes, starting with a letter or digit (for example my-review-checklist).".into());
        }
        if self.get_all_skills()?.iter().any(|s| s.id == id) {
            return Err(format!("A skill called '{}' already exists. Edit it instead, or choose another id.", id));
        }
        let name = input.name.trim();
        if name.is_empty() || name.chars().count() > 100 {
            return Err("The name must be between 1 and 100 characters.".into());
        }
        if input.description.trim().chars().count() < 20 {
            return Err("The description must be at least 20 characters, so tools know when to use the skill.".into());
        }
        if input.content.trim().is_empty() || input.content.len() > MAX_SKILL_TEXT {
            return Err(format!("A skill's text must be between 1 and {} KB.", MAX_SKILL_TEXT / 1024));
        }
        if input.author.trim().is_empty() {
            return Err("Name the skill's author (yourself, if you wrote it).".into());
        }
        if !input.source_url.trim().starts_with("https://") {
            return Err("The source link must start with https:// (where the skill comes from).".into());
        }
        if input.license.trim().is_empty() {
            return Err("Name the skill's license (for example MIT), or write unverified.".into());
        }
        if input.phases.is_empty() {
            return Err("Choose at least one phase the skill is for.".into());
        }
        let known = known_phases();
        if let Some(bad) = input.phases.iter().find(|p| !known.contains(p)) {
            return Err(format!("'{}' is not a phase.", bad));
        }
        let skill = Skill {
            id,
            name: name.to_string(),
            description: input.description.trim().to_string(),
            category: SkillCategory::Custom,
            attribution: AuthorAttribution {
                name: input.author.trim().to_string(),
                role: None,
                source_url: input.source_url.trim().to_string(),
                verified: false,
                avatar_url: None,
            },
            enabled: true,
            content: input.content.replace("\r\n", "\n"),
            is_custom: true,
            phases: input.phases,
            domains: vec!["general".into()],
            license: Some(input.license.trim().to_string()),
        };
        self.write_user_skill(&skill)?;
        Ok(skill)
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

#[tauri::command]
pub fn add_skill(skill: NewSkill) -> Result<Skill, String> {
    SkillManager::default_system().add_skill(skill)
}
