use std::fs;
use tauri_app_lib::commands::sync_launcher::{SyncLauncher, LaunchPayload};
use tauri_app_lib::models::{ToolId, Skill, SkillCategory, AuthorAttribution};

#[test]
fn test_sync_launcher_injects_tiered_configs_and_state() {
    let temp_dir = std::env::temp_dir().join("agent_orchestrator_sync_test");
    if temp_dir.exists() {
        let _ = fs::remove_dir_all(&temp_dir);
    }
    fs::create_dir_all(&temp_dir).expect("Failed to create temp dir");

    let launcher = SyncLauncher::new();

    let skills = vec![
        Skill {
            id: "spec-driven-development".to_string(),
            name: "Spec-Driven Development".to_string(),
            description: "Specs before code".to_string(),
            category: SkillCategory::Architecture,
            attribution: AuthorAttribution {
                name: "Addy Osmani".to_string(),
                role: None,
                source_url: "https://github.com/addyosmani/agent-skills".to_string(),
                verified: true,
                avatar_url: None,
            },
            enabled: true,
            content: "# Spec\nFollow spec rules.".to_string(),
            is_custom: false,
            phases: vec!["prd".to_string()],
            domains: vec![],
            license: None,
        },
        Skill {
            id: "test-driven-development".to_string(),
            name: "Test-Driven Development".to_string(),
            description: "TDD red green refactor".to_string(),
            category: SkillCategory::Testing,
            attribution: AuthorAttribution {
                name: "Addy Osmani".to_string(),
                role: None,
                source_url: "https://github.com/addyosmani/agent-skills".to_string(),
                verified: true,
                avatar_url: None,
            },
            enabled: true,
            content: "# TDD\nWrite tests first.".to_string(),
            is_custom: false,
            phases: vec!["build".to_string()],
            domains: vec![],
            license: None,
        },
    ];

    let payload = LaunchPayload {
        project_path: temp_dir.to_string_lossy().to_string(),
        project_name: "MockProject".to_string(),
        selected_tool: ToolId::Cursor,
        idea_description: "Build an automated CRM system".to_string(),
        skills,
    };

    let result = launcher.prepare_workspace(&payload).expect("Workspace preparation failed");
    assert!(result.success);

    // 1. Verify AUTONOMOUS_RUNNER.md was created
    let runner_path = temp_dir.join("AUTONOMOUS_RUNNER.md");
    assert!(runner_path.exists(), "AUTONOMOUS_RUNNER.md must exist");
    let runner_content = fs::read_to_string(&runner_path).expect("Read runner failed");
    assert!(runner_content.contains("AUTONOMOUS EXECUTION DIRECTIVE"));

    // 2. Verify Cross-IDE session state (.agents/session-state.json) was written
    let state_path = temp_dir.join(".agents").join("session-state.json");
    assert!(state_path.exists(), "Session state ledger must exist");

    // 3. Verify Cursor-specific configs: .cursorrules and .cursor/skills/
    let cursor_rules_path = temp_dir.join(".cursorrules");
    assert!(cursor_rules_path.exists(), ".cursorrules must exist");
    let rules_content = fs::read_to_string(&cursor_rules_path).expect("Read cursorrules failed");
    // Verify Tier 1 micro-rules are compact (< 1500 chars to avoid token bloat)
    assert!(rules_content.len() < 1500, "Rules must be compact micro-rules to prevent token bloat");

    let cursor_skills_dir = temp_dir.join(".cursor").join("skills");
    assert!(cursor_skills_dir.exists(), ".cursor/skills dir must exist");

    // Clean up
    let _ = fs::remove_dir_all(temp_dir);
}
