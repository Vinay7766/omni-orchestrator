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

// ── Choosing the file, writing it, and the command ────────────────────────

use std::fs;
use std::path::{Path, PathBuf};

use crate::commands::adapters::{adapter_for, bundled_adapters, Adapter};
use crate::commands::tool_discovery::{discover, DiscoveredTool, SystemView};

/// Our entry's name in every tool's MCP config.
pub const SERVER_NAME: &str = "omni-orchestrator";

/// How a tool starts the OmniOrchestrator MCP server.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerCommand {
    pub command: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupResult {
    pub tool_id: String,
    pub config_path: String,
    pub status: MergeStatus,
    pub format: McpFormat,
    /// The original file, saved once before OmniOrchestrator first changed it.
    pub backup_path: Option<String>,
    pub message: String,
}

fn entry_for(server: &ServerCommand, project: Option<&Path>) -> Value {
    let mut args: Vec<Value> = server.args.iter().cloned().map(Value::String).collect();
    if let Some(p) = project {
        args.push(Value::String("--project".into()));
        args.push(Value::String(p.to_string_lossy().into_owned()));
    }
    let mut entry = Map::new();
    entry.insert("command".into(), Value::String(server.command.clone()));
    entry.insert("args".into(), Value::Array(args));
    Value::Object(entry)
}

/// The entry to add by hand, for every case where automatic setup does not apply.
fn manual_entry(format: McpFormat, server: &ServerCommand, project: Option<&Path>) -> String {
    let mut servers = Map::new();
    servers.insert(SERVER_NAME.into(), entry_for(server, project));
    let mut root = Map::new();
    root.insert(format.key().into(), Value::Object(servers));
    serde_json::to_string_pretty(&Value::Object(root)).unwrap_or_default()
}

/// Project config (adapter) when a project is given, else the config discovery found, else the
/// adapter's first existing user config.
fn choose_config(tool: &DiscoveredTool, adapter: Option<&Adapter>, home: &Path, project: Option<&Path>) -> Option<PathBuf> {
    let mcp = adapter.and_then(|a| a.mcp.as_ref());
    if let (Some(project), Some(rel)) = (project, mcp.and_then(|m| m.project_config.as_deref())) {
        return Some(project.join(rel));
    }
    if let Some(found) = &tool.mcp_config {
        return Some(PathBuf::from(found));
    }
    mcp?.user_config.iter().filter_map(|p| p.strip_prefix("~/")).map(|rel| home.join(rel)).find(|p| p.is_file())
}

/// Windows canonical paths start with \\?\ ; shown to people (and compared), the plain form is wanted.
fn without_verbatim_prefix(path: PathBuf) -> PathBuf {
    match path.to_str().and_then(|s| s.strip_prefix(r"\\?\")) {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => path,
    }
}

/// Adds or updates our entry in `tool`'s MCP config. Nothing is written when it is already
/// there, when the tool has no MCP support, or when the file cannot be edited safely; those
/// errors include the entry to add by hand.
pub fn setup_tool(
    tool: &DiscoveredTool,
    adapter: Option<&Adapter>,
    home: &Path,
    project: Option<&Path>,
    server: &ServerCommand,
) -> Result<SetupResult, String> {
    let preferred = adapter.and_then(|a| a.mcp.as_ref()).map(|m| m.format);
    let manual = |why: String| {
        format!(
            "{} To connect it by hand, add this to the MCP settings of {}:\n{}",
            why,
            tool.name,
            manual_entry(preferred.unwrap_or(McpFormat::McpServers), server, project)
        )
    };
    if tool.capability != Some(3) {
        return Err(format!(
            "{} has no MCP support detected, so it cannot use the MCP server. It can still follow the project through AGENTS.md and its instruction files.",
            tool.name
        ));
    }
    let Some(chosen) = choose_config(tool, adapter, home, project) else {
        return Err(manual(format!("No MCP config file is known for {}.", tool.name)));
    };
    // Write through a symlinked config (dotfile setups) instead of replacing the link.
    let path = if fs::symlink_metadata(&chosen).is_ok_and(|m| m.file_type().is_symlink()) {
        fs::canonicalize(&chosen).map(without_verbatim_prefix).unwrap_or(chosen)
    } else {
        chosen
    };
    let existing = match fs::read_to_string(&path) {
        Ok(text) => Some(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(manual(format!("{} could not be read ({}).", path.display(), e))),
    };
    let (text, status, format) = merge_mcp_entry(existing.as_deref(), preferred, SERVER_NAME, &entry_for(server, project))
        .map_err(|why| manual(format!("{}: {}.", path.display(), why)))?;

    let mut backup_path = None;
    if status != MergeStatus::Unchanged {
        if let Some(original) = &existing {
            let backup = PathBuf::from(format!("{}.omni-backup", path.display()));
            if !backup.exists() {
                fs::write(&backup, original).map_err(|e| format!("Could not save a backup of {}: {}", path.display(), e))?;
            }
            backup_path = Some(backup.to_string_lossy().into_owned());
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Could not create {}: {}", parent.display(), e))?;
        }
        let temp = PathBuf::from(format!("{}.omni-tmp", path.display()));
        fs::write(&temp, &text).map_err(|e| format!("Could not write {}: {}", temp.display(), e))?;
        if let Err(e) = fs::rename(&temp, &path) {
            let _ = fs::remove_file(&temp);
            return Err(format!("Could not replace {}: {}", path.display(), e));
        }
    }
    let message = match status {
        MergeStatus::Unchanged => format!("{} is already connected ({}).", tool.name, path.display()),
        _ => format!(
            "{} is connected: OmniOrchestrator was added to {}. Restart {} (or reload its MCP servers) to use it.",
            tool.name,
            path.display(),
            tool.name
        ),
    };
    Ok(SetupResult {
        tool_id: tool.id.clone(),
        config_path: path.to_string_lossy().into_owned(),
        status,
        format,
        backup_path,
        message,
    })
}

/// node on PATH plus the built server: `server_override` (OMNI_MCP_SERVER), else `built_main`.
pub fn resolve_server_command(server_override: Option<String>, built_main: &Path, path_dirs: &[PathBuf]) -> Result<ServerCommand, String> {
    let main = server_override.map(PathBuf::from).unwrap_or_else(|| built_main.to_path_buf());
    if !main.is_file() {
        return Err(format!(
            "The MCP server is not built yet ({} is missing). Run npm run build, then try again.",
            main.display()
        ));
    }
    let names: &[&str] = if cfg!(windows) { &["node.exe"] } else { &["node"] };
    let node = path_dirs
        .iter()
        .flat_map(|dir| names.iter().map(move |n| dir.join(n)))
        .find(|p| p.is_file())
        .ok_or_else(|| "Node.js was not found on PATH; the MCP server needs it. Install Node.js, then try again.".to_string())?;
    Ok(ServerCommand {
        command: node.to_string_lossy().into_owned(),
        args: vec![main.to_string_lossy().into_owned()],
    })
}

/// Connects a discovered tool to the OmniOrchestrator MCP server (D5). `project_path`, when
/// given, must be an existing folder; the entry then serves that project.
#[tauri::command]
pub async fn setup_mcp(tool_id: String, project_path: Option<String>) -> Result<SetupResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let view = SystemView::from_environment();
        let tools = discover(&view);
        let tool = tools
            .iter()
            .find(|t| t.id == tool_id)
            .ok_or_else(|| format!("The tool \"{}\" was not found on this computer.", tool_id))?;
        let project = match project_path {
            Some(p) => {
                let path = PathBuf::from(&p);
                if !path.is_absolute() || !path.is_dir() {
                    return Err(format!("{} is not an existing project folder.", p));
                }
                Some(path)
            }
            None => None,
        };
        let home = std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
            .map(PathBuf::from)
            .ok_or_else(|| "The home folder could not be found.".to_string())?;
        let built = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("packages").join("mcp-server").join("dist").join("main.js");
        let server = resolve_server_command(std::env::var("OMNI_MCP_SERVER").ok(), &built, &view.path_dirs)?;
        let (adapters, _) = bundled_adapters();
        setup_tool(tool, adapter_for(&tool.id, &adapters), &home, project.as_deref(), &server)
    })
    .await
    .map_err(|e| e.to_string())?
}
