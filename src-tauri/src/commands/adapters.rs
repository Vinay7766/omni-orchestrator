//! Optional adapters (TOOL-5): known details for one tool each, kept as data in
//! packages/core/adapters/ and bundled by build.rs. Nothing here is needed for a tool to work;
//! an adapter only adds the project files that tool reads instructions from (and its MCP
//! locations, used by the TypeScript core). Mirrors packages/core/src/adapters/adapters.ts.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::commands::mcp_setup::McpFormat;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Adapter {
    pub id: String,
    pub name: String,
    /// Ids tool discovery gives this tool.
    pub matches: Vec<String>,
    /// Project-relative files the tool reads instructions from, besides AGENTS.md.
    #[serde(default)]
    pub instruction_files: Vec<String>,
    /// Where the tool keeps its MCP servers, if known (used by automatic MCP setup, D5).
    pub mcp: Option<AdapterMcp>,
    /// How the tool, started in a terminal, takes a fresh session's first prompt (HND-7).
    pub start_prompt: Option<AdapterStartPrompt>,
}

/// Arguments with exactly one "{prompt}", replaced by a fixed sentence (never by memory text).
#[derive(Debug, Clone, Deserialize)]
pub struct AdapterStartPrompt {
    pub args: Vec<String>,
}

pub const PROMPT_PLACEHOLDER: &str = "{prompt}";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterMcp {
    pub format: McpFormat,
    /// "~/..." paths; the first that exists wins (tools move them between versions).
    #[serde(default)]
    pub user_config: Vec<String>,
    /// Project-relative config file.
    pub project_config: Option<String>,
}

/// One adapter file: its file name and raw text.
#[derive(Debug, Clone, Deserialize)]
pub struct AdapterFile {
    pub name: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdapterIssue {
    pub file: String,
    pub message: String,
}

/// The schema (schemas/adapter.schema.json) is the full contract and is checked against every
/// shipped adapter in the tests. At run time the launcher re-checks only what it acts on: the
/// instruction-file paths it writes to must stay inside the project.
fn is_safe_relative_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains('\\')
        && !path.contains(':')
        && !path.contains('\0')
        && path.split('/').all(|step| step != ".." && !step.is_empty())
}

/// Parses adapter files. Invalid ones are reported and left out; the rest are returned.
pub fn parse_adapters(files: &[AdapterFile]) -> (Vec<Adapter>, Vec<AdapterIssue>) {
    let mut adapters = Vec::new();
    let mut issues = Vec::new();
    let mut claimed: HashMap<String, String> = HashMap::new();
    for f in files {
        let mut report = |message: String| issues.push(AdapterIssue { file: f.name.clone(), message });
        let adapter: Adapter = match serde_json::from_str(&f.text) {
            Ok(a) => a,
            Err(e) => {
                report(format!("not a valid adapter: {}", e));
                continue;
            }
        };
        if f.name != format!("{}.json", adapter.id) {
            report(format!("the file for adapter \"{}\" must be named {}.json", adapter.id, adapter.id));
            continue;
        }
        if let Some(bad) = adapter.instruction_files.iter().find(|p| !is_safe_relative_path(p)) {
            report(format!("instruction file \"{}\" must be a path inside the project", bad));
            continue;
        }
        if let Some(mcp) = &adapter.mcp {
            if let Some(bad) = mcp.project_config.iter().find(|p| !is_safe_relative_path(p)) {
                report(format!("MCP project config \"{}\" must be a path inside the project", bad));
                continue;
            }
            if let Some(bad) = mcp.user_config.iter().find(|p| !p.strip_prefix("~/").is_some_and(is_safe_relative_path)) {
                report(format!("MCP user config \"{}\" must be a path in the home folder starting with ~/", bad));
                continue;
            }
        }
        if let Some(start) = &adapter.start_prompt {
            let placeholders = start.args.iter().filter(|a| a.as_str() == PROMPT_PLACEHOLDER).count();
            if placeholders != 1 || start.args.len() > 8 || start.args.iter().any(|a| a.is_empty() || a.len() > 100 || a.contains('\0')) {
                report("startPrompt args must be 1-8 short arguments with exactly one \"{prompt}\"".to_string());
                continue;
            }
        }
        if let Some(taken) = adapter.matches.iter().find(|id| claimed.contains_key(*id)) {
            report(format!("tool id \"{}\" is already covered by adapter \"{}\"", taken, claimed[taken]));
            continue;
        }
        for id in &adapter.matches {
            claimed.insert(id.clone(), adapter.id.clone());
        }
        adapters.push(adapter);
    }
    (adapters, issues)
}

/// The adapters shipped with the app (empty when the adapters folder was empty at build time).
pub fn bundled_adapters() -> (Vec<Adapter>, Vec<AdapterIssue>) {
    let files: Vec<AdapterFile> =
        serde_json::from_str(include_str!(concat!(env!("OUT_DIR"), "/adapters.json"))).unwrap_or_default();
    parse_adapters(&files)
}

/// The adapter for a discovered tool id, if any.
pub fn adapter_for<'a>(tool_id: &str, adapters: &'a [Adapter]) -> Option<&'a Adapter> {
    adapters.iter().find(|a| a.matches.iter().any(|m| m == tool_id))
}

pub const MANAGED_BEGIN: &str = "<!-- omni:begin (managed by OmniOrchestrator, safe to delete) -->";
pub const MANAGED_END: &str = "<!-- omni:end -->";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ManagedBlockStatus {
    Created,
    Appended,
    Replaced,
    Unchanged,
    Unterminated,
}

/// Puts `body` inside the managed block of an instruction file. The user's content outside the
/// markers is never changed; a begin marker without an end marker is left alone, not guessed.
/// Behaviour is pinned by packages/core/test-data/managed-block-cases.json (shared with core).
pub fn apply_managed_block(existing: Option<&str>, body: &str) -> (String, ManagedBlockStatus) {
    apply_block(existing, body, MANAGED_BEGIN, MANAGED_END)
}

/// Like apply_managed_block, with the markers given (files where HTML comments are not
/// comments, such as .gitignore, need their own).
pub fn apply_block(existing: Option<&str>, body: &str, begin_marker: &str, end_marker: &str) -> (String, ManagedBlockStatus) {
    let nl = if existing.is_some_and(|e| e.contains("\r\n")) { "\r\n" } else { "\n" };
    let block = format!("{begin_marker}{nl}{body}{nl}{end_marker}{nl}");
    let Some(existing) = existing else {
        return (block, ManagedBlockStatus::Created);
    };
    if let Some(begin) = existing.find(begin_marker) {
        let Some(end_offset) = existing[begin..].find(end_marker) else {
            return (existing.to_string(), ManagedBlockStatus::Unterminated);
        };
        let mut end = begin + end_offset + end_marker.len();
        if existing[end..].starts_with(nl) {
            end += nl.len();
        }
        let text = format!("{}{}{}", &existing[..begin], block, &existing[end..]);
        let status = if text == existing { ManagedBlockStatus::Unchanged } else { ManagedBlockStatus::Replaced };
        return (text, status);
    }
    if existing.is_empty() {
        return (block, ManagedBlockStatus::Appended);
    }
    let ending = if existing.ends_with(nl) { "" } else { nl };
    (format!("{existing}{ending}{nl}{block}"), ManagedBlockStatus::Appended)
}
