//! E6: handing the build phase to a tool the person selected (PLAN-3, TOOL-2). Made-up tools only.

use std::cell::RefCell;
use std::fs;
use std::path::{Path, PathBuf};
use tauri_app_lib::commands::adapters::{parse_adapters, Adapter, AdapterFile, MANAGED_BEGIN};
use tauri_app_lib::commands::handoff::{hand_off, HandoffContext, HandoffRequest, GITIGNORE_BEGIN, MAX_AGENTS_BLOCK};
use tauri_app_lib::commands::mcp_setup::ServerCommand;
use tauri_app_lib::commands::tool_discovery::{DiscoveredTool, LaunchCommand, ToolCategory};

fn temp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("omni-handoff-{}-{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}

/// A project folder with memory and a team of the given (tool id, level, confirmed) members.
fn project(name: &str, members: &[(&str, u8, bool)]) -> PathBuf {
    let dir = temp(name);
    fs::create_dir_all(dir.join(".agents")).unwrap();
    fs::write(dir.join(".agents").join("project.json"), r#"{"formatVersion":1}"#).unwrap();
    let members: Vec<String> = members
        .iter()
        .map(|(id, level, confirmed)| {
            format!(
                r#"{{"toolId":"{id}","name":"{id} app","capability":{level},"confirmedByPerson":{confirmed},"addedAt":"2026-11-03T10:00:00Z"}}"#
            )
        })
        .collect();
    let team = format!(r#"{{"formatVersion":1,"updatedAt":"2026-11-03T10:00:00Z","members":[{}]}}"#, members.join(","));
    fs::write(dir.join(".agents").join("team.json"), team).unwrap();
    dir
}

fn tool(id: &str, capability: Option<u8>, launch: bool) -> DiscoveredTool {
    DiscoveredTool {
        id: id.to_string(),
        name: format!("{} app", id),
        category: ToolCategory::Editor,
        capability,
        launch: launch.then(|| LaunchCommand { program: format!("/opt/{id}/bin/{id}"), args: vec!["--new-window".into()] }),
        ..Default::default()
    }
}

fn nebula_adapter() -> Vec<Adapter> {
    let text = r#"{"formatVersion":1,"id":"nebula","name":"Nebula","matches":["nebula"],
        "mcp":{"format":"servers","projectConfig":".nebula/mcp.json"},
        "instructionFiles":[".nebula/rules.md"],
        "sources":[{"url":"https://nebula.example/docs","checked":"2026-11-01","covers":["mcp","instructionFiles"]}]}"#;
    let (adapters, issues) = parse_adapters(&[AdapterFile { name: "nebula.json".into(), text: text.into() }]);
    assert!(issues.is_empty(), "{:?}", issues);
    adapters
}

fn request(dir: &Path, tool_id: &str) -> HandoffRequest {
    HandoffRequest {
        project_path: dir.to_string_lossy().into_owned(),
        tool_id: tool_id.into(),
        agents_block: "## OmniOrchestrator project: P\n\nNext task: T-1: Do it".into(),
    }
}

fn server() -> Result<ServerCommand, String> {
    Ok(ServerCommand { command: "/opt/node/bin/node".into(), args: vec!["/opt/omni/dist/main.js".into()] })
}

fn context<'a>(tools: &'a [DiscoveredTool], adapters: &'a [Adapter], home: &'a Path) -> HandoffContext<'a> {
    HandoffContext { tools, adapters, home, server: server() }
}

fn no_spawn(_: &LaunchCommand, _: &str) -> std::io::Result<()> {
    panic!("must not start anything")
}

// --- Refusals: nothing is written and nothing is started.

#[test]
fn a_relative_project_path_is_refused() {
    let home = temp("rel-home");
    let tools = [tool("orbit", Some(3), true)];
    let mut req = request(Path::new("x"), "orbit");
    req.project_path = "--version".into();
    let err = hand_off(&req, &context(&tools, &[], &home), no_spawn).unwrap_err();
    assert!(err.contains("--version"), "{err}");
}

#[test]
fn a_folder_without_project_memory_is_refused() {
    let dir = temp("no-memory");
    let tools = [tool("orbit", Some(3), true)];
    let err = hand_off(&request(&dir, "orbit"), &context(&tools, &[], &dir), no_spawn).unwrap_err();
    assert!(err.contains("project"), "{err}");
    assert!(!dir.join("AGENTS.md").exists());
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn a_tool_the_person_did_not_select_is_refused() {
    let dir = project("not-selected", &[("orbit", 2, false)]);
    let tools = [tool("orbit", Some(3), true), tool("zeta", Some(3), true)];
    let err = hand_off(&request(&dir, "zeta"), &context(&tools, &[], &dir), no_spawn).unwrap_err();
    assert!(err.contains("selected"), "{err}");
    assert!(!dir.join("AGENTS.md").exists());
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn a_selected_tool_no_longer_on_this_computer_is_refused() {
    let dir = project("gone", &[("orbit", 2, true)]);
    let err = hand_off(&request(&dir, "orbit"), &context(&[], &[], &dir), no_spawn).unwrap_err();
    assert!(err.contains("not found"), "{err}");
    assert!(!dir.join("AGENTS.md").exists());
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn a_level_discovery_did_not_find_needs_the_persons_confirmation() {
    let dir = project("unconfirmed", &[("orbit", 3, false)]);
    let tools = [tool("orbit", None, true)];
    let err = hand_off(&request(&dir, "orbit"), &context(&tools, &[], &dir), no_spawn).unwrap_err();
    assert!(err.to_lowercase().contains("confirm"), "{err}");
    assert!(!dir.join("AGENTS.md").exists());
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn a_block_that_is_too_long_or_carries_our_markers_is_refused() {
    let dir = project("bad-block", &[("orbit", 2, false)]);
    let tools = [tool("orbit", Some(3), false)];
    let mut long = request(&dir, "orbit");
    long.agents_block = "x".repeat(MAX_AGENTS_BLOCK + 1);
    assert!(hand_off(&long, &context(&tools, &[], &dir), no_spawn).is_err());
    let mut marked = request(&dir, "orbit");
    marked.agents_block = "text\n<!-- omni:end -->\nmore".into();
    assert!(hand_off(&marked, &context(&tools, &[], &dir), no_spawn).is_err());
    assert!(!dir.join("AGENTS.md").exists());
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn a_linked_agents_md_is_not_written_through() {
    let dir = project("link", &[("orbit", 2, false)]);
    let outside = temp("link-target");
    let target = outside.join("elsewhere.md");
    fs::write(&target, "not yours").unwrap();
    #[cfg(windows)]
    let linked = std::os::windows::fs::symlink_file(&target, dir.join("AGENTS.md"));
    #[cfg(unix)]
    let linked = std::os::unix::fs::symlink(&target, dir.join("AGENTS.md"));
    if linked.is_err() {
        eprintln!("symlinks not permitted here; skipped");
        return;
    }
    let tools = [tool("orbit", Some(3), false)];
    let err = hand_off(&request(&dir, "orbit"), &context(&tools, &[], &dir), no_spawn).unwrap_err();
    assert!(err.contains("link"), "{err}");
    assert_eq!(fs::read_to_string(&target).unwrap(), "not yours");
    let _ = fs::remove_dir_all(dir);
    let _ = fs::remove_dir_all(outside);
}

// --- Level 2: instruction files.

#[test]
fn level_two_writes_agents_md_keeps_the_users_text_and_starts_the_tool() {
    let dir = project("level2", &[("orbit", 2, false)]);
    fs::write(dir.join("AGENTS.md"), "# My rules\n").unwrap();
    let tools = [tool("orbit", Some(3), true)];
    let spawned = RefCell::new(Vec::new());
    let result = hand_off(&request(&dir, "orbit"), &context(&tools, &[], &dir), |cmd, project| {
        spawned.borrow_mut().push((cmd.program.clone(), cmd.args.clone(), project.to_string()));
        Ok(())
    })
    .unwrap();
    let agents = fs::read_to_string(dir.join("AGENTS.md")).unwrap();
    assert!(agents.starts_with("# My rules\n"), "{agents}");
    assert!(agents.contains(MANAGED_BEGIN));
    assert!(agents.contains("Next task: T-1: Do it"));
    assert_eq!(result.level, 2);
    assert!(result.launched);
    assert!(result.mcp.is_none(), "level 2 does not touch MCP settings");
    assert_eq!(
        spawned.borrow().as_slice(),
        &[("/opt/orbit/bin/orbit".to_string(), vec!["--new-window".to_string()], dir.to_string_lossy().into_owned())]
    );
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn the_tools_own_instruction_files_point_to_agents_md() {
    let dir = project("pointer", &[("nebula", 2, false)]);
    let tools = [tool("nebula", Some(3), false)];
    let adapters = nebula_adapter();
    let result = hand_off(&request(&dir, "nebula"), &context(&tools, &adapters, &dir), no_spawn).unwrap();
    let rules = fs::read_to_string(dir.join(".nebula").join("rules.md")).unwrap();
    assert!(rules.contains("AGENTS.md"));
    assert!(result.files.iter().any(|f| f.contains(".nebula/rules.md")), "{:?}", result.files);
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn the_tools_own_instruction_files_say_not_to_add_ai_attribution() {
    // C19: a tool that reads only its own instruction file still gets the rule.
    let dir = project("no-attribution", &[("nebula", 2, false)]);
    let tools = [tool("nebula", Some(3), false)];
    let adapters = nebula_adapter();
    hand_off(&request(&dir, "nebula"), &context(&tools, &adapters, &dir), no_spawn).unwrap();
    let rules = fs::read_to_string(dir.join(".nebula").join("rules.md")).unwrap();
    assert!(rules.to_lowercase().contains("co-author"), "{rules}");
    assert!(rules.contains("authored by the person"), "{rules}");
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn gitignore_lists_only_our_own_memory_files_once_and_keeps_the_users_lines() {
    let dir = project("gitignore", &[("orbit", 2, false)]);
    fs::write(dir.join(".gitignore"), "node_modules\n").unwrap();
    let tools = [tool("orbit", Some(3), false)];
    hand_off(&request(&dir, "orbit"), &context(&tools, &[], &dir), no_spawn).unwrap();
    let first = fs::read_to_string(dir.join(".gitignore")).unwrap();
    assert!(first.starts_with("node_modules\n"), "{first}");
    assert!(first.contains(GITIGNORE_BEGIN));
    for ours in [".agents/events.jsonl", ".agents/state.json", ".agents/summary.md", ".agents/team.json", ".agents/handoff/"] {
        assert!(first.lines().any(|l| l == ours), "{ours} missing:\n{first}");
    }
    assert!(!first.lines().any(|l| l == ".agents/" || l == ".agents" || l == ".agents/*"), "never the whole folder:\n{first}");
    assert!(!first.lines().any(|l| l.starts_with(".agents/skills/")), "other tools' files there are not ours");

    let again = hand_off(&request(&dir, "orbit"), &context(&tools, &[], &dir), no_spawn).unwrap();
    assert_eq!(fs::read_to_string(dir.join(".gitignore")).unwrap(), first, "a second handoff changes nothing");
    assert!(!again.files.iter().any(|f| f.contains(".gitignore")), "{:?}", again.files);
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn a_tool_that_is_not_started_directly_gets_instructions() {
    let dir = project("cli", &[("zeta", 2, true)]);
    let mut cli = tool("zeta", None, false);
    cli.category = ToolCategory::CommandLine;
    cli.executable = Some("/usr/local/bin/zeta".into());
    let result = hand_off(&request(&dir, "zeta"), &context(&[cli], &[], &dir), no_spawn).unwrap();
    assert!(!result.launched);
    assert!(result.message.contains("/usr/local/bin/zeta"), "{}", result.message);
    let _ = fs::remove_dir_all(dir);
}

// --- Level 3: MCP, plus everything level 2 does.

#[test]
fn level_three_connects_the_project_mcp_config_and_keeps_a_backup() {
    let dir = project("level3", &[("nebula", 3, false)]);
    fs::create_dir_all(dir.join(".nebula")).unwrap();
    let original = r#"{ "servers": { "theirs": { "command": "x" } } }"#;
    fs::write(dir.join(".nebula").join("mcp.json"), original).unwrap();
    let tools = [tool("nebula", Some(3), false)];
    let adapters = nebula_adapter();
    let result = hand_off(&request(&dir, "nebula"), &context(&tools, &adapters, &dir), no_spawn).unwrap();
    let mcp = result.mcp.expect("MCP was set up");
    let config: serde_json::Value = serde_json::from_str(&fs::read_to_string(dir.join(".nebula").join("mcp.json")).unwrap()).unwrap();
    assert_eq!(config["servers"]["theirs"]["command"], "x");
    let args = config["servers"]["omni-orchestrator"]["args"].as_array().unwrap();
    assert!(args.iter().any(|a| a == "--project"));
    assert_eq!(fs::read_to_string(mcp.backup_path.unwrap()).unwrap(), original);
    assert!(dir.join("AGENTS.md").exists(), "level 3 also writes the instruction files");
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn when_mcp_cannot_be_set_up_the_rest_still_happens_and_the_reason_is_given() {
    let dir = project("mcp-fails", &[("orbit", 3, false)]);
    let tools = [tool("orbit", Some(3), false)];
    let mut ctx = context(&tools, &[], &dir);
    ctx.server = Err("The MCP server is not built yet.".into());
    let result = hand_off(&request(&dir, "orbit"), &ctx, no_spawn).unwrap();
    assert!(result.mcp.is_none());
    assert!(result.mcp_problem.as_deref().unwrap_or("").contains("not built"), "{:?}", result.mcp_problem);
    assert!(dir.join("AGENTS.md").exists());
    let _ = fs::remove_dir_all(dir);
}

// --- Level 1: chat only. The package is written by the app into .agents/handoff/.

#[test]
fn level_one_writes_no_instruction_files() {
    let dir = project("level1", &[("chat-site", 1, true)]);
    let tools = [tool("chat-site", None, false)];
    let result = hand_off(&request(&dir, "chat-site"), &context(&tools, &[], &dir), no_spawn).unwrap();
    assert_eq!(result.level, 1);
    assert!(!dir.join("AGENTS.md").exists());
    assert!(dir.join(".gitignore").exists(), "the memory is still kept out of git");
    assert!(result.mcp.is_none() && result.mcp_problem.is_none());
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn an_unfinished_block_is_left_alone_and_reported() {
    let dir = project("half", &[("orbit", 2, false)]);
    let half = format!("# mine\n{}\nhalf\n", MANAGED_BEGIN);
    fs::write(dir.join("AGENTS.md"), &half).unwrap();
    let tools = [tool("orbit", Some(3), false)];
    let result = hand_off(&request(&dir, "orbit"), &context(&tools, &[], &dir), no_spawn).unwrap();
    assert_eq!(fs::read_to_string(dir.join("AGENTS.md")).unwrap(), half);
    assert!(result.files.iter().any(|f| f.contains("left unchanged")), "{:?}", result.files);
    let _ = fs::remove_dir_all(dir);
}

// --- Group A (owner's v0.1 issues, 2026-11-04): one terminal per tool and project ---

use tauri_app_lib::commands::handoff::launch_once;

/// A process that keeps running for a few seconds, on any CI platform.
fn long_running() -> std::process::Command {
    if cfg!(windows) {
        let mut c = std::process::Command::new("ping");
        c.args(["-n", "30", "127.0.0.1"]);
        c
    } else {
        let mut c = std::process::Command::new("sleep");
        c.arg("30");
        c
    }
}

#[test]
fn a_tool_still_running_is_not_started_again() {
    let key = format!("test-tool|{}", std::process::id());
    let started = std::cell::Cell::new(0);
    let start = || {
        started.set(started.get() + 1);
        long_running().spawn()
    };
    launch_once(&key, start).expect("first launch starts it");
    let again = launch_once(&key, start).unwrap_err();
    assert_eq!(again.kind(), std::io::ErrorKind::AlreadyExists, "{again}");
    assert_eq!(started.get(), 1, "the second click must not start another process");
    tauri_app_lib::commands::handoff::stop_launched(&key);
}

#[test]
fn a_tool_that_was_closed_is_started_again() {
    let key = format!("test-closed|{}", std::process::id());
    launch_once(&key, || long_running().spawn()).unwrap();
    tauri_app_lib::commands::handoff::stop_launched(&key);
    launch_once(&key, || long_running().spawn()).expect("closed, so it starts again");
    tauri_app_lib::commands::handoff::stop_launched(&key);
}

#[test]
fn the_handoff_says_a_running_tool_is_already_open_instead_of_opening_another() {
    let dir = project("already-open", &[("orbit", 2, false)]);
    let tools = [tool("orbit", Some(3), true)];
    let busy = |_: &LaunchCommand, _: &str| -> std::io::Result<()> { Err(std::io::Error::new(std::io::ErrorKind::AlreadyExists, "running")) };
    let result = hand_off(&request(&dir, "orbit"), &context(&tools, &[], &dir), busy).unwrap();
    assert!(result.launched, "it is open");
    assert!(result.message.contains("already open"), "{}", result.message);
    let _ = fs::remove_dir_all(dir);
}
