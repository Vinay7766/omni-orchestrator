//! Automatic MCP setup (D5, TOOL-3): adds OmniOrchestrator's server entry to another tool's MCP
//! config. These files belong to other programs, so only our own entry is ever added or updated,
//! every other key and value is kept in its order, and anything we cannot edit safely (comments,
//! other formats, unexpected shapes) is refused so the user can add the entry by hand.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// The top-level key a tool's MCP config keeps its servers under.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum McpFormat {
    #[serde(rename = "mcpServers")]
    McpServers,
    #[serde(rename = "servers")]
    Servers,
}

impl McpFormat {
    pub fn key(self) -> &'static str {
        match self {
            McpFormat::McpServers => "mcpServers",
            McpFormat::Servers => "servers",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MergeStatus {
    /// No file (or an empty one): it becomes just our entry.
    Created,
    /// Our entry was added next to whatever was there.
    Added,
    /// Our earlier entry was replaced.
    Updated,
    /// Our entry is already exactly this; nothing to write.
    Unchanged,
}

/// Returns the new file text with our entry under `name`, the status, and the format used.
/// Format: the key already in the file, else `preferred` (an adapter's), else mcpServers.
pub fn merge_mcp_entry(
    existing: Option<&str>,
    preferred: Option<McpFormat>,
    name: &str,
    entry: &Value,
) -> Result<(String, MergeStatus, McpFormat), String> {
    let existing = existing.filter(|t| !t.trim().is_empty());
    let crlf = existing.is_some_and(|t| t.contains("\r\n"));
    let mut root: Map<String, Value> = match existing {
        None => Map::new(),
        Some(text) => match serde_json::from_str::<Value>(text) {
            Ok(Value::Object(map)) => map,
            Ok(_) => return Err("the file is not a JSON object, so it was left unchanged".to_string()),
            Err(_) => {
                return Err(if looks_like_json_with_comments(text) {
                    "the file has comments (JSON with comments), which would be lost; it was left unchanged".to_string()
                } else {
                    "the file is not plain JSON (for example TOML or YAML), so it was left unchanged".to_string()
                })
            }
        },
    };

    let has = |f: McpFormat| root.contains_key(f.key());
    let format = match (has(McpFormat::McpServers), has(McpFormat::Servers)) {
        (true, true) => return Err("the file has both mcpServers and servers; it was left unchanged".to_string()),
        (true, false) => McpFormat::McpServers,
        (false, true) => McpFormat::Servers,
        (false, false) => {
            if root.contains_key("mcp") {
                return Err("the file lists servers under \"mcp\" in a shape other than mcpServers/servers; it was left unchanged".to_string());
            }
            preferred.unwrap_or(McpFormat::McpServers)
        }
    };

    let was_empty = root.is_empty();
    let servers = root.entry(format.key()).or_insert_with(|| Value::Object(Map::new()));
    let Value::Object(servers) = servers else {
        return Err(format!("\"{}\" in the file is not an object of servers; it was left unchanged", format.key()));
    };
    let status = match servers.get(name) {
        Some(current) if current == entry => MergeStatus::Unchanged,
        Some(_) => MergeStatus::Updated,
        None if was_empty => MergeStatus::Created,
        None => MergeStatus::Added,
    };
    if status == MergeStatus::Unchanged {
        return Ok((existing.unwrap_or_default().to_string(), status, format));
    }
    servers.insert(name.to_string(), entry.clone());

    let mut text = serde_json::to_string_pretty(&Value::Object(root)).map_err(|e| e.to_string())? + "\n";
    if crlf {
        text = text.replace('\n', "\r\n");
    }
    Ok((text, status, format))
}

/// Line or block comments outside strings: JSON-with-comments, which a JSON rewrite would drop.
fn looks_like_json_with_comments(text: &str) -> bool {
    let mut in_string = false;
    let mut escaped = false;
    let mut prev = '\0';
    for c in text.chars() {
        if in_string {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
        } else if c == '"' {
            in_string = true;
        } else if prev == '/' && (c == '/' || c == '*') {
            return true;
        }
        prev = if in_string { '\0' } else { c };
    }
    false
}
