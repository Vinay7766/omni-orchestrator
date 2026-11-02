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
    /// The provider to use. When unset, the first one set up is used (in the order of
    /// `ByokProvider`). Only that provider is called: a model name belongs to one provider.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_provider: Option<ByokProvider>,
}

impl BYOKConfig {
    /// The fields that hold API keys, by their saved (camelCase) names. They are kept in the
    /// OS credential store under these names and never written to settings.json (NFR-10).
    pub const SECRET_FIELDS: [&'static str; 4] = ["geminiApiKey", "anthropicApiKey", "openaiApiKey", "compatibleApiKey"];

    /// The key field called `name` (one of `SECRET_FIELDS`).
    pub fn secret_mut(&mut self, name: &str) -> Option<&mut Option<String>> {
        match name {
            "geminiApiKey" => Some(&mut self.gemini_api_key),
            "anthropicApiKey" => Some(&mut self.anthropic_api_key),
            "openaiApiKey" => Some(&mut self.openai_api_key),
            "compatibleApiKey" => Some(&mut self.compatible_api_key),
            _ => None,
        }
    }

    /// A copy with every key field removed.
    pub fn without_secrets(&self) -> Self {
        let mut copy = self.clone();
        for name in Self::SECRET_FIELDS {
            if let Some(field) = copy.secret_mut(name) {
                *field = None;
            }
        }
        copy
    }
}

/// Whether API keys can be kept between app starts (NFR-10).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KeyStorageStatus {
    pub available: bool,
    /// Why keys are not kept, when `available` is false.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// BYOK settings as the app shows them: saved fields plus keys from the credential store.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ByokState {
    pub config: BYOKConfig,
    pub key_storage: KeyStorageStatus,
}

/// The protocols BYOK speaks. Which servers and models are used is the user's data (TOOL-6):
/// `Compatible` covers any OpenAI-compatible server.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ByokProvider {
    Gemini,
    Claude,
    Openai,
    Compatible,
    Ollama,
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
    /// Folders the dashboard looks in for OmniOrchestrator projects (absolute paths, E2).
    #[serde(default)]
    pub project_folders: Vec<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            default_track: TrackType::TrackA,
            theme: "dark".to_string(),
            active_tool_id: None,
            byok: BYOKConfig::default(),
            custom_skills_directory: None,
            project_folders: Vec::new(),
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
