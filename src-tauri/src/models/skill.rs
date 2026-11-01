use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthorAttribution {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    pub source_url: String,
    pub verified: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SkillCategory {
    Engineering,
    Architecture,
    Testing,
    Security,
    Strategy,
    Marketing,
    Research,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: SkillCategory,
    pub attribution: AuthorAttribution,
    pub enabled: bool,
    pub content: String,
    pub is_custom: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase_scope: Option<String>,
    /// SPDX license id, or "unverified" when not yet checked.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
}
