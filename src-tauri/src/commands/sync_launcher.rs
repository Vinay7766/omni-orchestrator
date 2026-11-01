use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use serde::{Deserialize, Serialize};
use crate::models::{Skill, ToolId};
use crate::commands::tool_detector::ToolDetector;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchPayload {
    pub project_path: String,
    pub project_name: String,
    pub selected_tool: ToolId,
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

        // 1. Injects AUTONOMOUS_RUNNER.md
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
            payload
                .skills
                .iter()
                .filter(|s| s.enabled)
                .map(|s| format!("- **{}** (by {}): {}", s.name, s.attribution.name, s.description))
                .collect::<Vec<_>>()
                .join("\n")
        );
        fs::write(project_dir.join("AUTONOMOUS_RUNNER.md"), runner_content)
            .map_err(|e| format!("Failed to write AUTONOMOUS_RUNNER.md: {}", e))?;

        // 2. Injects Cross-IDE Session State (.agents/session-state.json)
        let agents_dir = project_dir.join(".agents");
        let _ = fs::create_dir_all(&agents_dir);
        let session_state = serde_json::json!({
            "projectName": payload.project_name,
            "selectedTool": payload.selected_tool,
            "currentPhase": 1,
            "equippedSkills": payload.skills.iter().filter(|s| s.enabled).map(|s| &s.id).collect::<Vec<_>>(),
            "timestamp": "2026-10-31T11:00:00Z"
        });
        fs::write(
            agents_dir.join("session-state.json"),
            serde_json::to_string_pretty(&session_state).unwrap_or_default(),
        ).map_err(|e| format!("Failed to write session-state.json: {}", e))?;

        // 3. Injects Tier 1 Micro-Rules (always-on, <1500 chars) & Tier 2 Phase-Scoped Skills
        self.inject_tool_configs(&project_dir, &payload.selected_tool, &payload.skills)?;

        let notice = format!(
            "Workspace successfully prepared at {}!\n\nConfigured:\n- Tier 1 Micro-Rules injected to prevent token bloat.\n- Autonomous Runner directives generated.\n- Cross-IDE session state saved.\n- {} skills equipped.",
            payload.project_path,
            payload.skills.iter().filter(|s| s.enabled).count()
        );

        Ok(LaunchResult {
            success: true,
            message: "Workspace prepared successfully".to_string(),
            project_path: payload.project_path.clone(),
            tool_launched: false,
            verification_notice: notice,
        })
    }

    fn inject_tool_configs(
        &self,
        project_dir: &Path,
        tool: &ToolId,
        skills: &[Skill],
    ) -> Result<(), String> {
        let micro_rules = r#"# Core Engineering Standards
- Spec before code: Always verify requirements in PRD.md before writing code.
- Red-Green-Refactor TDD: Write test first, verify failure, write minimal code, verify green.
- Never commit secrets or bypass validations.
- Maintain architecture integrity.
"#;

        match tool {
            ToolId::Cursor => {
                // Injects .cursorrules
                fs::write(project_dir.join(".cursorrules"), micro_rules)
                    .map_err(|e| format!("Failed to write .cursorrules: {}", e))?;

                // Injects skills to .cursor/skills/
                let skills_dir = project_dir.join(".cursor").join("skills");
                let _ = fs::create_dir_all(&skills_dir);
                for skill in skills.iter().filter(|s| s.enabled) {
                    let safe_name = sanitize_filename(&skill.id);
                    let skill_file = skills_dir.join(format!("{}.md", safe_name));
                    let _ = fs::write(skill_file, &skill.content);
                }
            }
            ToolId::Antigravity => {
                // Injects AGENTS.md
                fs::write(project_dir.join("AGENTS.md"), micro_rules)
                    .map_err(|e| format!("Failed to write AGENTS.md: {}", e))?;

                // Injects skills to .gemini/config/skills/
                let skills_dir = project_dir.join(".gemini").join("config").join("skills");
                let _ = fs::create_dir_all(&skills_dir);
                for skill in skills.iter().filter(|s| s.enabled) {
                    let safe_name = sanitize_filename(&skill.id);
                    let skill_file = skills_dir.join(format!("{}.md", safe_name));
                    let _ = fs::write(skill_file, &skill.content);
                }
            }
            ToolId::Vscode => {
                // Injects .github/copilot-instructions.md
                let github_dir = project_dir.join(".github");
                let _ = fs::create_dir_all(&github_dir);
                fs::write(github_dir.join("copilot-instructions.md"), micro_rules)
                    .map_err(|e| format!("Failed to write copilot-instructions.md: {}", e))?;

                // Injects skills to .agents/skills/
                let skills_dir = project_dir.join(".agents").join("skills");
                let _ = fs::create_dir_all(&skills_dir);
                for skill in skills.iter().filter(|s| s.enabled) {
                    let safe_name = sanitize_filename(&skill.id);
                    let skill_file = skills_dir.join(format!("{}.md", safe_name));
                    let _ = fs::write(skill_file, &skill.content);
                }
            }
            ToolId::Windsurf => {
                // Injects .windsurfrules
                fs::write(project_dir.join(".windsurfrules"), micro_rules)
                    .map_err(|e| format!("Failed to write .windsurfrules: {}", e))?;
            }
            ToolId::ClaudeCode => {
                // Injects CLAUDE.md
                fs::write(project_dir.join("CLAUDE.md"), micro_rules)
                    .map_err(|e| format!("Failed to write CLAUDE.md: {}", e))?;
            }
            ToolId::Ollama => {}
        }

        Ok(())
    }

    pub fn launch_tool(&self, payload: &LaunchPayload) -> Result<LaunchResult, String> {
        let mut prep_result = self.prepare_workspace(payload)?;

        let detector = ToolDetector::new();
        let tools = detector.detect_all();
        let tool_info = tools.into_iter().find(|t| t.id == payload.selected_tool);

        if let Some(tool) = tool_info {
            if tool.installed && !tool.executable_path.is_empty() {
                let mut cmd = Command::new(&tool.executable_path);
                cmd.arg(&payload.project_path);

                match cmd.spawn() {
                    Ok(_) => {
                        prep_result.tool_launched = true;
                        prep_result.message = format!("{} launched successfully!", tool.name);
                    }
                    Err(e) => {
                        prep_result.message = format!("Workspace ready, but failed to launch IDE: {}", e);
                    }
                }
            } else {
                prep_result.message = format!(
                    "Workspace prepared, but {} is not detected on PATH. You can open {} manually.",
                    tool.name, payload.project_path
                );
            }
        }

        Ok(prep_result)
    }
}

#[tauri::command]
pub fn launch_and_build(payload: LaunchPayload) -> Result<LaunchResult, String> {
    let launcher = SyncLauncher::new();
    launcher.launch_tool(&payload)
}

#[tauri::command]
pub fn prepare_project_staging(payload: LaunchPayload) -> Result<LaunchResult, String> {
    let launcher = SyncLauncher::new();
    launcher.prepare_workspace(&payload)
}
