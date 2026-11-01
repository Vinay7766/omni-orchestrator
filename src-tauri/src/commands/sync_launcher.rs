use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use serde::{Deserialize, Serialize};
use crate::models::Skill;
use crate::commands::tool_discovery::{discover, DiscoveredTool, LaunchCommand, SystemView};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchPayload {
    pub project_path: String,
    pub project_name: String,
    /// Id of a tool from discover_tools (open: any discovered tool).
    pub selected_tool: String,
    pub idea_description: String,
    pub skills: Vec<Skill>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchResult {
    pub success: bool,
    pub message: String,
    pub project_path: String,
    pub tool_launched: bool,
    pub verification_notice: String,
}

#[derive(Default, Clone)]
pub struct SyncLauncher;

fn validate_safe_path(path_str: &str) -> Result<PathBuf, String> {
    if path_str.trim().is_empty() {
        return Err("Project path cannot be empty".to_string());
    }
    if path_str.contains('\0') {
        return Err("Project path contains invalid null characters".to_string());
    }
    let path = PathBuf::from(path_str);
    let mut depth: isize = 0;
    for component in path.components() {
        match component {
            std::path::Component::ParentDir => {
                depth -= 1;
                if depth < 0 && !path.is_absolute() {
                    return Err("Path traversal attempt detected with relative '..'".to_string());
                }
            }
            std::path::Component::Normal(_) => {
                depth += 1;
            }
            _ => {}
        }
    }
    Ok(path)
}

fn sanitize_filename(id: &str) -> String {
    let sanitized: String = id
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if sanitized.is_empty() {
        "custom-skill".to_string()
    } else {
        sanitized
    }
}

/// Writes `name` (relative to the project) only if it does not exist yet; otherwise records it
/// in `kept`. The user's own files are never overwritten.
fn write_new(project_dir: &Path, name: &str, content: &str, kept: &mut Vec<String>) -> Result<(), String> {
    match fs::OpenOptions::new().write(true).create_new(true).open(project_dir.join(name)) {
        Ok(mut file) => file.write_all(content.as_bytes()).map_err(|e| format!("Failed to write {}: {}", name, e)),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            kept.push(name.to_string());
            Ok(())
        }
        Err(e) => Err(format!("Failed to write {}: {}", name, e)),
    }
}

const MICRO_RULES: &str = r#"# Core Engineering Standards
- Spec before code: Always verify requirements in PRD.md before writing code.
- Red-Green-Refactor TDD: Write test first, verify failure, write minimal code, verify green.
- Never commit secrets or bypass validations.
- Maintain architecture integrity.
"#;

impl SyncLauncher {
    pub fn new() -> Self {
        Self
    }

    pub fn prepare_workspace(&self, payload: &LaunchPayload) -> Result<LaunchResult, String> {
        let project_dir = validate_safe_path(&payload.project_path)?;
        if !project_dir.exists() {
            fs::create_dir_all(&project_dir)
                .map_err(|e| format!("Failed to create project dir: {}", e))?;
        }
        let enabled: Vec<&Skill> = payload.skills.iter().filter(|s| s.enabled).collect();
        let mut kept: Vec<String> = Vec::new();

        // 1. AUTONOMOUS_RUNNER.md
        let runner_content = format!(
            r#"# AUTONOMOUS EXECUTION DIRECTIVE: {}

## Project Idea
"{}"

## SYSTEM RULES (ANTI-VIBE-CODING PROTOCOL)
You are the Autonomous Senior Engineering Team. You MUST execute this project phase-by-phase without requiring prompt copy-pasting:
- **Phase 1 & 2 (Discovery & Reality Check):** Review idea, confirm scope, check dependencies.
- **Phase 3 (Spec & PRD):** Follow `spec-driven-development` to verify PRD.md.
- **Phase 4 & 5 (Architecture & TDD Build):** Red-Green-Refactor TDD. Prove every task with passing tests.
- **Phase 6 & 7 (Review & Security):** 5-axis code review and OWASP hardening.
- **Phase 8 (Handover):** Plain-English walkthrough.

## EQUIPPED SKILLS
{}
"#,
            payload.project_name,
            payload.idea_description,
            enabled
                .iter()
                .map(|s| format!("- **{}** (by {}): {}", s.name, s.attribution.name, s.description))
                .collect::<Vec<_>>()
                .join("\n")
        );
        write_new(&project_dir, "AUTONOMOUS_RUNNER.md", &runner_content, &mut kept)?;

        // 2. Cross-tool session state (.agents/session-state.json), refreshed on every launch
        let agents_dir = project_dir.join(".agents");
        fs::create_dir_all(agents_dir.join("skills")).map_err(|e| format!("Failed to create .agents: {}", e))?;
        let prepared_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let session_state = serde_json::json!({
            "projectName": payload.project_name,
            "selectedTool": payload.selected_tool,
            "currentPhase": 1,
            "equippedSkills": enabled.iter().map(|s| &s.id).collect::<Vec<_>>(),
            "preparedAtUnixSeconds": prepared_at
        });
        fs::write(
            agents_dir.join("session-state.json"),
            serde_json::to_string_pretty(&session_state).unwrap_or_default(),
        ).map_err(|e| format!("Failed to write session-state.json: {}", e))?;

        // 3. Files any agent can read. Tool-specific files are optional adapters (C13), not code.
        write_new(&project_dir, "AGENTS.md", MICRO_RULES, &mut kept)?;
        for skill in &enabled {
            let name = format!(".agents/skills/{}.md", sanitize_filename(&skill.id));
            write_new(&project_dir, &name, &skill.content, &mut kept)?;
        }

        let mut notice = format!(
            "Workspace successfully prepared at {}!\n\nConfigured:\n- Tier 1 Micro-Rules (AGENTS.md) to prevent token bloat.\n- Autonomous Runner directives generated.\n- Cross-tool session state saved.\n- {} skills equipped (.agents/skills).",
            payload.project_path,
            enabled.len()
        );
        if !kept.is_empty() {
            notice.push_str(&format!("\n\nKept your existing files (not overwritten): {}", kept.join(", ")));
        }

        Ok(LaunchResult {
            success: true,
            message: "Workspace prepared successfully".to_string(),
            project_path: payload.project_path.clone(),
            tool_launched: false,
            verification_notice: notice,
        })
    }

    /// Prepares the workspace, then starts the tool found by discovery on this machine.
    pub fn launch_tool(&self, payload: &LaunchPayload) -> Result<LaunchResult, String> {
        let tools = discover(&SystemView::from_environment());
        self.launch_with(payload, &tools, |cmd, project| {
            // The program comes from the tool's own install folder (discovery), never from the
            // web view, which only sends an id.
            Command::new(&cmd.program).args(&cmd.args).arg(project).spawn().map(|_| ())
        })
    }

    /// Like launch_tool, with the discovered tools and the way to start a program given.
    pub fn launch_with(
        &self,
        payload: &LaunchPayload,
        tools: &[DiscoveredTool],
        spawn: impl Fn(&LaunchCommand, &str) -> std::io::Result<()>,
    ) -> Result<LaunchResult, String> {
        let mut result = self.prepare_workspace(payload)?;
        let Some(tool) = tools.iter().find(|t| t.id == payload.selected_tool) else {
            result.message = format!(
                "Workspace prepared, but the tool \"{}\" was not found on this computer. Open {} in your tool manually.",
                payload.selected_tool, payload.project_path
            );
            return Ok(result);
        };
        match &tool.launch {
            Some(cmd) => match spawn(cmd, &payload.project_path) {
                Ok(()) => {
                    result.tool_launched = true;
                    result.message = format!("{} launched successfully!", tool.name);
                }
                Err(e) => result.message = format!("Workspace ready, but {} could not be started: {}", tool.name, e),
            },
            None => {
                let how = match (&tool.executable, &tool.host_editor) {
                    (Some(exe), _) => format!("run {} in a terminal inside {}", exe, payload.project_path),
                    (None, Some(editor)) => format!("open {} in {} and use the extension there", payload.project_path, editor),
                    _ => format!("open {} in {}", payload.project_path, tool.name),
                };
                result.message = format!("Workspace prepared. {} is not started directly: {}.", tool.name, how);
            }
        }
        Ok(result)
    }
}

#[tauri::command]
pub fn launch_and_build(payload: LaunchPayload) -> Result<LaunchResult, String> {
    SyncLauncher::new().launch_tool(&payload)
}

#[tauri::command]
pub fn prepare_project_staging(payload: LaunchPayload) -> Result<LaunchResult, String> {
    SyncLauncher::new().prepare_workspace(&payload)
}
