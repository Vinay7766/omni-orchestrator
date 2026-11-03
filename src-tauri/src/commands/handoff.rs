//! Hands the build phase to a tool the person selected (E6, PLAN-3, TOOL-2).
//!
//! The web view sends a project folder, a tool id and the AGENTS.md text (built by core). Every
//! one of those is checked here: the folder must hold project memory, the tool must be in the
//! person's team.json and be found by discovery now, and its level must be one discovery found or
//! one the person confirmed. Only our managed blocks are written, never through a link, and only a
//! program discovery found is started.
//!
//! Level 3 (MCP): MCP entry for this project + everything level 2 does.
//! Level 2 (instruction files): AGENTS.md block, pointers in the tool's own instruction files.
//! Level 1 (chat only): nothing in the tool's files; the app saves the handoff package in .agents/.
//! Every level: .gitignore keeps OmniOrchestrator's own memory files out of git.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::commands::adapters::{adapter_for, apply_block, bundled_adapters, Adapter, ManagedBlockStatus, MANAGED_BEGIN, MANAGED_END};
use crate::commands::mcp_setup::{resolve_server_command, setup_tool, ServerCommand, SetupResult};
use crate::commands::tool_discovery::{discover, DiscoveredTool, LaunchCommand, SystemView};

/// The AGENTS.md block is a summary and a next task, not a document.
pub const MAX_AGENTS_BLOCK: usize = 16 * 1024;
const MAX_TEAM_FILE: u64 = 256 * 1024;

pub const GITIGNORE_BEGIN: &str = "# omni:begin (managed by OmniOrchestrator, safe to delete)";
pub const GITIGNORE_END: &str = "# omni:end";

/// OmniOrchestrator's own files in .agents/ (ARCHITECTURE 3, 3.3). Never the whole folder: other
/// tools keep files there (for example .agents/skills/) that people may want to commit.
const OUR_MEMORY_FILES: &[&str] = &[
    ".agents/project.json",
    ".agents/events.jsonl",
    ".agents/state.json",
    ".agents/summary.md",
    ".agents/decisions.md",
    ".agents/problems.md",
    ".agents/lessons.md",
    ".agents/design-notes/",
    ".agents/triage/",
    ".agents/citations/",
    ".agents/handoff/",
    ".agents/skills.json",
    ".agents/team.json",
    ".agents/outcomes.jsonl",
    ".agents/.lock",
    ".agents/.write.*",
];

/// What the pointer in a tool's own instruction file says.
const POINTER: &str = "This project is prepared by OmniOrchestrator. Read AGENTS.md first: it says where the project memory is and which task is next.";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffRequest {
    pub project_path: String,
    pub tool_id: String,
    pub agents_block: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffResult {
    pub tool_id: String,
    pub level: u8,
    /// One line per file created or changed.
    pub files: Vec<String>,
    pub mcp: Option<SetupResult>,
    /// Why MCP could not be set up (with the entry to add by hand when there is one).
    pub mcp_problem: Option<String>,
    pub launched: bool,
    pub message: String,
}

/// What a handoff works with. Built from this computer in the app; made up in tests.
pub struct HandoffContext<'a> {
    pub tools: &'a [DiscoveredTool],
    pub adapters: &'a [Adapter],
    pub home: &'a Path,
    pub server: Result<ServerCommand, String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TeamFile {
    members: Vec<TeamMember>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TeamMember {
    tool_id: String,
    capability: u8,
    confirmed_by_person: bool,
}

fn is_link(path: &Path) -> bool {
    fs::symlink_metadata(path).map(|m| m.file_type().is_symlink()).unwrap_or(false)
}

/// True when `rel` itself, or any folder on the way to it inside the project, is a link.
fn passes_a_link(project: &Path, rel: &str) -> bool {
    let mut path = project.to_path_buf();
    Path::new(rel).components().any(|part| {
        path.push(part);
        is_link(&path)
    })
}

fn project_folder(path: &str) -> Result<PathBuf, String> {
    let dir = PathBuf::from(path);
    if !dir.is_absolute() {
        return Err(format!("\"{}\" is not a full folder path.", path));
    }
    if !dir.join(".agents").join("project.json").is_file() {
        return Err(format!("{} is not an OmniOrchestrator project (it has no .agents/project.json).", dir.display()));
    }
    Ok(dir)
}

fn team_member(project: &Path, tool_id: &str) -> Result<TeamMember, String> {
    let path = project.join(".agents").join("team.json");
    let not_selected = || format!("\"{}\" is not one of the tools selected for this project. Select it first.", tool_id);
    let meta = match fs::symlink_metadata(&path) {
        Ok(meta) => meta,
        Err(_) => return Err(not_selected()),
    };
    if meta.file_type().is_symlink() || meta.len() > MAX_TEAM_FILE {
        return Err("The project's team.json is a link or too large; select the tools again.".into());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("The project's team.json could not be read: {}", e))?;
    let team: TeamFile = serde_json::from_str(&text).map_err(|_| "The project's team.json is damaged; select the tools again.".to_string())?;
    let member = team.members.into_iter().find(|m| m.tool_id == tool_id).ok_or_else(not_selected)?;
    if !(1..=3).contains(&member.capability) {
        return Err("The project's team.json has a level outside 1-3; select the tools again.".into());
    }
    Ok(member)
}

/// Puts `body` in the block between `begin` and `end` of `rel`; returns a line for the person, or
/// None when nothing changed. Written through a temporary file and a rename.
fn write_block(project: &Path, rel: &str, body: &str, begin: &str, end: &str) -> Result<Option<String>, String> {
    let path = project.join(rel);
    let existing = match fs::read_to_string(&path) {
        Ok(text) => Some(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("{} could not be read: {}", rel, e)),
    };
    let (text, status) = apply_block(existing.as_deref(), body, begin, end);
    let line = match status {
        ManagedBlockStatus::Unchanged => return Ok(None),
        ManagedBlockStatus::Unterminated => {
            return Ok(Some(format!(
                "{} has an OmniOrchestrator begin marker without an end marker, so it was left unchanged. Delete that line to let it be written again.",
                rel
            )))
        }
        ManagedBlockStatus::Created => format!("{} created.", rel),
        ManagedBlockStatus::Appended | ManagedBlockStatus::Replaced => format!("{} updated (your own text in it is kept).", rel),
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Could not create the folder for {}: {}", rel, e))?;
    }
    let temp = PathBuf::from(format!("{}.omni-tmp", path.display()));
    let mut file = fs::File::create(&temp).map_err(|e| format!("Could not write {}: {}", rel, e))?;
    file.write_all(text.as_bytes()).map_err(|e| format!("Could not write {}: {}", rel, e))?;
    drop(file);
    if let Err(e) = fs::rename(&temp, &path) {
        let _ = fs::remove_file(&temp);
        return Err(format!("Could not replace {}: {}", rel, e));
    }
    Ok(Some(line))
}

fn start(tool: &DiscoveredTool, project: &str, spawn: impl Fn(&LaunchCommand, &str) -> std::io::Result<()>) -> (bool, String) {
    match &tool.launch {
        Some(cmd) => match spawn(cmd, project) {
            Ok(()) => (true, format!("{} was opened with the project.", tool.name)),
            Err(e) => (false, format!("{} could not be started ({}). Open {} in it yourself.", tool.name, e, project)),
        },
        None => {
            let how = match (&tool.executable, &tool.host_editor) {
                (Some(exe), _) => format!("run {} in a terminal inside {}", exe, project),
                (None, Some(editor)) => format!("open {} in {} and use the extension there", project, editor),
                _ => format!("open {} in {}", project, tool.name),
            };
            (false, format!("{} is not started directly: {}.", tool.name, how))
        }
    }
}

/// Sets up `request.tool_id` at the level the person selected and starts it (see module docs).
pub fn hand_off(
    request: &HandoffRequest,
    context: &HandoffContext,
    spawn: impl Fn(&LaunchCommand, &str) -> std::io::Result<()>,
) -> Result<HandoffResult, String> {
    // 1. Check everything before writing anything.
    let project = project_folder(&request.project_path)?;
    let member = team_member(&project, &request.tool_id)?;
    let tool = context
        .tools
        .iter()
        .find(|t| t.id == request.tool_id)
        .ok_or_else(|| format!("\"{}\" was not found on this computer any more.", request.tool_id))?;
    let level = member.capability;
    if !member.confirmed_by_person && !tool.capability.is_some_and(|found| level <= found) {
        return Err(format!(
            "{} was not found to support level {}. Confirm the level in the tool list first.",
            tool.name, level
        ));
    }
    let block = request.agents_block.trim();
    if level >= 2 {
        if block.is_empty() || block.len() > MAX_AGENTS_BLOCK {
            return Err(format!("The AGENTS.md text must be between 1 and {} characters.", MAX_AGENTS_BLOCK));
        }
        if block.contains("omni:begin") || block.contains("omni:end") {
            return Err("The AGENTS.md text may not contain OmniOrchestrator's block markers.".into());
        }
    }
    let adapter = adapter_for(&tool.id, context.adapters);
    let mut targets = vec![".gitignore".to_string()];
    if level >= 2 {
        targets.push("AGENTS.md".into());
        targets.extend(adapter.map(|a| a.instruction_files.clone()).unwrap_or_default());
    }
    if let Some(linked) = targets.iter().find(|rel| passes_a_link(&project, rel)) {
        return Err(format!("{} is a link to another file, so it was not changed. Replace the link with a plain file.", linked));
    }

    // 2. Write.
    let mut files = Vec::new();
    files.extend(write_block(&project, ".gitignore", &gitignore_body(), GITIGNORE_BEGIN, GITIGNORE_END)?);
    if level >= 2 {
        files.extend(write_block(&project, "AGENTS.md", block, MANAGED_BEGIN, MANAGED_END)?);
        for rel in adapter.map(|a| a.instruction_files.as_slice()).unwrap_or_default() {
            files.extend(write_block(&project, rel, POINTER, MANAGED_BEGIN, MANAGED_END)?);
        }
    }
    let (mut mcp, mut mcp_problem) = (None, None);
    if level == 3 {
        // A level the person confirmed counts as MCP support for setting it up.
        let mut connected = tool.clone();
        connected.capability = Some(3);
        match &context.server {
            Ok(server) => match setup_tool(&connected, adapter, context.home, Some(&project), server) {
                Ok(result) => mcp = Some(result),
                Err(why) => mcp_problem = Some(why),
            },
            Err(why) => mcp_problem = Some(why.clone()),
        }
    }

    // 3. Start the tool.
    let project_text = project.to_string_lossy().into_owned();
    let (launched, message) = start(tool, &project_text, spawn);
    Ok(HandoffResult { tool_id: tool.id.clone(), level, files, mcp, mcp_problem, launched, message })
}

fn gitignore_body() -> String {
    let mut lines = vec!["# OmniOrchestrator's project memory (summaries of your sessions), kept out of git by default.".to_string()];
    lines.extend(OUR_MEMORY_FILES.iter().map(|f| f.to_string()));
    lines.join("\n")
}

/// The handoff on this computer: discovered tools, shipped adapters, the built MCP server.
#[tauri::command]
pub async fn hand_off_tool(request: HandoffRequest) -> Result<HandoffResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let view = SystemView::from_environment();
        let tools = discover(&view);
        let (adapters, _) = bundled_adapters();
        let home = std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
            .map(PathBuf::from)
            .ok_or_else(|| "The home folder could not be found.".to_string())?;
        let built = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("packages").join("mcp-server").join("dist").join("main.js");
        let server = resolve_server_command(std::env::var("OMNI_MCP_SERVER").ok(), &built, &view.path_dirs);
        let context = HandoffContext { tools: &tools, adapters: &adapters, home: &home, server };
        // The program comes from the tool's own install folder (discovery), never from the web view.
        hand_off(&request, &context, |cmd, project| Command::new(&cmd.program).args(&cmd.args).arg(project).spawn().map(|_| ()))
    })
    .await
    .map_err(|e| e.to_string())?
}
