use std::fs;
use std::cell::RefCell;
use tauri_app_lib::commands::sync_launcher::{SyncLauncher, LaunchPayload};
use tauri_app_lib::commands::tool_discovery::{DiscoveredTool, LaunchCommand, ToolCategory};
use tauri_app_lib::models::{Skill, SkillCategory, AuthorAttribution};

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
        selected_tool: "a-tool-nobody-named".to_string(),
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

    // 3. Generic files any tool can read; tool-specific files are optional adapters (C13)
    let rules = fs::read_to_string(temp_dir.join("AGENTS.md")).expect("AGENTS.md must exist");
    assert!(rules.len() < 1500, "Rules must be compact micro-rules to prevent token bloat");
    assert!(temp_dir.join(".agents").join("skills").join("test-driven-development.md").exists());

    // Clean up
    let _ = fs::remove_dir_all(temp_dir);
}

fn payload_for(dir: &std::path::Path, tool: &str) -> LaunchPayload {
    LaunchPayload {
        project_path: dir.to_string_lossy().to_string(),
        project_name: "P".to_string(),
        selected_tool: tool.to_string(),
        idea_description: "An idea".to_string(),
        skills: vec![],
    }
}
fn temp(name: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("omni-launch-{}-{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}
fn tool(id: &str, category: ToolCategory, launch: Option<LaunchCommand>) -> DiscoveredTool {
    DiscoveredTool { id: id.to_string(), name: format!("{} app", id), category, launch, ..Default::default() }
}

#[test]
fn never_overwrites_files_the_user_already_has() {
    let dir = temp("keep");
    fs::write(dir.join("AGENTS.md"), "my own rules").unwrap();
    let result = SyncLauncher::new().prepare_workspace(&payload_for(&dir, "x")).unwrap();
    assert_eq!(fs::read_to_string(dir.join("AGENTS.md")).unwrap(), "my own rules");
    assert!(result.verification_notice.contains("AGENTS.md"), "the user is told which files were kept");
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn launches_the_discovered_tool_with_the_project_folder() {
    let dir = temp("spawn");
    let spawned = RefCell::new(Vec::new());
    let tools = vec![tool("nebula", ToolCategory::Editor, Some(LaunchCommand { program: "/opt/nebula/bin/nebula".into(), args: vec![] }))];
    let result = SyncLauncher::new()
        .launch_with(&payload_for(&dir, "nebula"), &tools, |cmd, project| {
            spawned.borrow_mut().push((cmd.program.clone(), project.to_string()));
            Ok(())
        })
        .unwrap();
    assert!(result.tool_launched);
    assert_eq!(spawned.borrow().as_slice(), &[("/opt/nebula/bin/nebula".to_string(), dir.to_string_lossy().to_string())]);
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn an_unknown_tool_is_reported_and_nothing_is_started() {
    let dir = temp("unknown");
    let result = SyncLauncher::new().launch_with(&payload_for(&dir, "not-installed"), &[], |_, _| panic!("must not spawn")).unwrap();
    assert!(!result.tool_launched);
    assert!(result.message.contains("not-installed"));
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn a_tool_without_a_launch_command_gets_instructions_instead() {
    let dir = temp("cli");
    let mut cli = tool("zeta", ToolCategory::CommandLine, None);
    cli.executable = Some("/usr/local/bin/zeta".into());
    let result = SyncLauncher::new().launch_with(&payload_for(&dir, "zeta"), &[cli], |_, _| panic!("must not spawn")).unwrap();
    assert!(!result.tool_launched);
    assert!(result.message.contains("/usr/local/bin/zeta"), "{}", result.message);
    let _ = fs::remove_dir_all(dir);
}

// --- Optional adapters (C13): the selected tool's adapter adds a pointer to its own
// instruction files, inside a managed block. Without adapters everything still works.

use tauri_app_lib::commands::adapters::{parse_adapters, Adapter, AdapterFile, MANAGED_BEGIN};

fn nebula_adapter() -> Vec<Adapter> {
    let text = r#"{"formatVersion":1,"id":"nebula","name":"Nebula","matches":["nebula"],
        "instructionFiles":[".nebula/rules.md"],
        "sources":[{"url":"https://nebula.example/docs","checked":"2026-11-01","covers":["instructionFiles"]}]}"#;
    let (adapters, issues) = parse_adapters(&[AdapterFile { name: "nebula.json".into(), text: text.into() }]);
    assert!(issues.is_empty(), "{:?}", issues);
    adapters
}

#[test]
fn the_selected_tools_adapter_gets_a_pointer_to_agents_md() {
    let dir = temp("adapter-new");
    let result = SyncLauncher::with_adapters(nebula_adapter()).prepare_workspace(&payload_for(&dir, "nebula")).unwrap();
    let rules = fs::read_to_string(dir.join(".nebula").join("rules.md")).expect("pointer file is created");
    assert!(rules.starts_with(MANAGED_BEGIN));
    assert!(rules.contains("AGENTS.md"));
    assert!(result.verification_notice.contains(".nebula/rules.md"), "{}", result.verification_notice);
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn the_pointer_is_added_after_the_users_own_instructions_and_only_once() {
    let dir = temp("adapter-keep");
    fs::create_dir_all(dir.join(".nebula")).unwrap();
    fs::write(dir.join(".nebula").join("rules.md"), "# my rules\n").unwrap();
    let launcher = SyncLauncher::with_adapters(nebula_adapter());
    launcher.prepare_workspace(&payload_for(&dir, "nebula")).unwrap();
    let first = fs::read_to_string(dir.join(".nebula").join("rules.md")).unwrap();
    assert!(first.starts_with("# my rules\n\n"), "{}", first);
    assert!(first.contains(MANAGED_BEGIN));
    let second = launcher.prepare_workspace(&payload_for(&dir, "nebula")).unwrap();
    assert_eq!(fs::read_to_string(dir.join(".nebula").join("rules.md")).unwrap(), first, "a second launch changes nothing");
    assert!(!second.verification_notice.contains(".nebula/rules.md"), "nothing to report: {}", second.verification_notice);
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn an_unfinished_block_is_left_alone_and_reported() {
    let dir = temp("adapter-half");
    fs::create_dir_all(dir.join(".nebula")).unwrap();
    let half = format!("# mine\n{}\nhalf\n", MANAGED_BEGIN);
    fs::write(dir.join(".nebula").join("rules.md"), &half).unwrap();
    let result = SyncLauncher::with_adapters(nebula_adapter()).prepare_workspace(&payload_for(&dir, "nebula")).unwrap();
    assert_eq!(fs::read_to_string(dir.join(".nebula").join("rules.md")).unwrap(), half);
    assert!(result.verification_notice.contains("left it unchanged"), "{}", result.verification_notice);
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn another_tools_adapter_writes_nothing() {
    let dir = temp("adapter-other");
    SyncLauncher::with_adapters(nebula_adapter()).prepare_workspace(&payload_for(&dir, "orbit")).unwrap();
    assert!(!dir.join(".nebula").exists());
    let _ = fs::remove_dir_all(dir);
}

/// Acceptance for C13: deleting every adapter leaves every discovered tool usable.
#[test]
fn with_no_adapters_at_all_every_tool_still_launches() {
    let dir = temp("adapter-none");
    let spawned = RefCell::new(0);
    let tools = vec![tool("nebula", ToolCategory::Editor, Some(LaunchCommand { program: "/opt/nebula".into(), args: vec![] }))];
    let result = SyncLauncher::with_adapters(vec![])
        .launch_with(&payload_for(&dir, "nebula"), &tools, |_, _| {
            *spawned.borrow_mut() += 1;
            Ok(())
        })
        .unwrap();
    assert!(result.tool_launched);
    assert_eq!(*spawned.borrow(), 1);
    assert!(dir.join("AGENTS.md").exists());
    assert!(!dir.join(".nebula").exists());
    let _ = fs::remove_dir_all(dir);
}
