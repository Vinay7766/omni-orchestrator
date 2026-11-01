use serde::{Deserialize, Serialize};
use super::tool::ToolId;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TrackType {
    TrackA,
    TrackB,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct BYOKConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gemini_api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anthropic_api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub openai_api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ollama_endpoint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preferred_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub default_track: TrackType,
    pub theme: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_tool_id: Option<ToolId>,
    pub byok: BYOKConfig,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_skills_directory: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            default_track: TrackType::TrackA,
            theme: "dark".to_string(),
            active_tool_id: Some(ToolId::Cursor),
            byok: BYOKConfig::default(),
            custom_skills_directory: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSession {
    pub id: String,
    pub name: String,
    pub track: TrackType,
    pub project_path: String,
    pub current_phase: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prd_path: Option<String>,
    pub equipped_skills: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}
