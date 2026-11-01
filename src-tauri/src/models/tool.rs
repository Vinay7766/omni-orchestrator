use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ToolId {
    Antigravity,
    Cursor,
    Vscode,
    Windsurf,
    ClaudeCode,
    Ollama,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledTool {
    pub id: ToolId,
    pub name: String,
    pub executable_path: String,
    pub installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub config_directory: String,
    pub command_snippet: String,
}
