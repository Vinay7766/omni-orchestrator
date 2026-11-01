use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredSkill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub source_url: String,
    pub author: String,
    pub domain: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stars_or_upvotes: Option<u64>,
    pub content: String,
    pub imported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResearchQuery {
    pub domain_or_category: Option<String>,
    pub keyword: String,
}
