use serde::{Deserialize, Serialize};

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
    /// Any OpenAI-compatible server (local runner, gateway, other provider): its base URL,
    /// e.g. "http://localhost:8080/v1". TOOL-6: no list of such servers in code.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compatible_base_url: Option<String>,
    /// Key for that server, if it needs one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compatible_api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preferred_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub default_track: TrackType,
    pub theme: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Id of a discovered tool (open; no fixed list).
    pub active_tool_id: Option<String>,
    pub byok: BYOKConfig,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_skills_directory: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            default_track: TrackType::TrackA,
            theme: "dark".to_string(),
            active_tool_id: None,
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
