//! E11: the next phase starts in a fresh session (HND-7). Made-up tools only; nothing is started.

use std::cell::RefCell;
use std::fs;
use std::path::{Path, PathBuf};
use tauri_app_lib::commands::adapters::{parse_adapters, Adapter, AdapterFile};
use tauri_app_lib::commands::fresh_session::{
    start_fresh_session, FreshSessionRequest, TerminalCommand, FRESH_SESSION_FILE, LAUNCH_TEXT, MAX_PROMPT,
};
use tauri_app_lib::commands::tool_discovery::{DiscoveredTool, LaunchCommand, ToolCategory};

fn project(name: &str, members: &[&str]) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("omni-fresh-{}-{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join(".agents")).unwrap();
    fs::write(dir.join(".agents").join("project.json"), r#"{"formatVersion":1}"#).unwrap();
    let members: Vec<String> = members
        .iter()
        .map(|id| format!(r#"{{"toolId":"{id}","name":"{id}","capability":2,"confirmedByPerson":true,"addedAt":"2026-11-03T10:00:00Z"}}"#))
        .collect();
    let team = format!(r#"{{"formatVersion":1,"updatedAt":"2026-11-03T10:00:00Z","members":[{}]}}"#, members.join(","));
    fs::write(dir.join(".agents").join("team.json"), team).unwrap();
    dir
}

fn cli(id: &str) -> DiscoveredTool {
    DiscoveredTool { id: id.into(), name: format!("{} agent", id), category: ToolCategory::CommandLine, executable: Some(format!("{}-bin", id)), capability: Some(2), ..Default::default() }
}

fn gui(id: &str) -> DiscoveredTool {
    DiscoveredTool {
        id: id.into(),
        name: format!("{} app", id),
        category: ToolCategory::Editor,
        launch: Some(LaunchCommand { program: format!("/opt/{id}/{id}"), args: vec!["--new-window".into()] }),
        capability: Some(2),
        ..Default::default()
    }
}

fn adapter_with_prompt(id: &str) -> Vec<Adapter> {
    let text = format!(
        r#"{{"formatVersion":1,"id":"{id}","name":"{id}","matches":["{id}"],"startPrompt":{{"args":["--prompt","{{prompt}}"]}},
        "sources":[{{"url":"https://made-up.example/cli","checked":"2026-11-03","covers":["startPrompt"]}}]}}"#
    );
    let (adapters, issues) = parse_adapters(&[AdapterFile { name: format!("{}.json", id), text }]);
    assert!(issues.is_empty(), "{:?}", issues);
    adapters
}

fn request(dir: &Path, tool: &str, prompt: &str) -> FreshSessionRequest {
    FreshSessionRequest { project_path: dir.to_string_lossy().into_owned(), tool_id: tool.into(), prompt: prompt.into() }
}

fn no_terminal(_: &TerminalCommand) -> std::io::Result<()> {
    panic!("must not start a terminal")
}
fn no_open(_: &LaunchCommand, _: &str) -> std::io::Result<()> {
    panic!("must not open a tool")
}

const PROMPT: &str = "# Fresh session: Orbit\n\nPhase: prd\n";

#[test]
fn the_launch_text_is_the_fixed_sentence_core_also_uses() {
    assert_eq!(LAUNCH_TEXT, "Read .agents/handoff/next-session.md and follow it.");
    assert_eq!(FRESH_SESSION_FILE, ".agents/handoff/next-session.md");
}

#[test]
fn a_made_up_cli_agent_starts_in_a_terminal_with_only_the_fixed_sentence() {
    let dir = project("cli", &["made-up-cli"]);
    let started = RefCell::new(Vec::new());
    let result = start_fresh_session(&request(&dir, "made-up-cli", PROMPT), &[cli("made-up-cli")], &adapter_with_prompt("made-up-cli"), |cmd| {
        started.borrow_mut().push((cmd.program.clone(), cmd.args.clone(), cmd.cwd.clone()));
        Ok(())
    }, no_open)
    .unwrap();
    assert!(result.launched && result.prompt_passed, "{:?}", result);
    assert_eq!(started.borrow().as_slice(), &[("made-up-cli-bin".to_string(), vec!["--prompt".to_string(), LAUNCH_TEXT.to_string()], dir.clone())]);
    assert_eq!(fs::read_to_string(dir.join(".agents/handoff/next-session.md")).unwrap(), PROMPT);
}

#[test]
fn a_cli_agent_without_a_documented_prompt_option_starts_without_one_and_the_person_pastes() {
    let dir = project("cli-plain", &["plain-cli"]);
    let started = RefCell::new(Vec::new());
    let result = start_fresh_session(&request(&dir, "plain-cli", PROMPT), &[cli("plain-cli")], &[], |cmd| {
        started.borrow_mut().push(cmd.args.clone());
        Ok(())
    }, no_open)
    .unwrap();
    assert!(result.launched && !result.prompt_passed);
    assert_eq!(started.borrow().as_slice(), &[Vec::<String>::new()]);
    assert!(result.message.contains("Paste"), "{}", result.message);
}

#[test]
fn a_gui_tool_is_opened_with_the_project_and_the_prompt_waits_to_be_pasted() {
    let dir = project("gui", &["made-up-editor"]);
    let opened = RefCell::new(Vec::new());
    let result = start_fresh_session(&request(&dir, "made-up-editor", PROMPT), &[gui("made-up-editor")], &[], no_terminal, |cmd, path| {
        opened.borrow_mut().push((cmd.program.clone(), path.to_string()));
        Ok(())
    })
    .unwrap();
    assert!(result.launched && !result.prompt_passed);
    assert_eq!(opened.borrow().len(), 1);
    assert!(dir.join(".agents/handoff/next-session.md").is_file());
}

#[test]
fn a_tool_not_selected_for_the_project_is_refused_and_nothing_is_written() {
    let dir = project("not-selected", &["someone-else"]);
    let err = start_fresh_session(&request(&dir, "made-up-cli", PROMPT), &[cli("made-up-cli")], &[], no_terminal, no_open).unwrap_err();
    assert!(err.contains("not one of the tools selected"), "{}", err);
    assert!(!dir.join(".agents/handoff").exists());
}

#[test]
fn an_empty_or_oversized_prompt_is_refused() {
    let dir = project("prompt-size", &["made-up-cli"]);
    for prompt in ["   ".to_string(), "x".repeat(MAX_PROMPT + 1)] {
        assert!(start_fresh_session(&request(&dir, "made-up-cli", &prompt), &[cli("made-up-cli")], &[], no_terminal, no_open).is_err());
    }
    assert!(!dir.join(".agents/handoff").exists());
}

#[test]
fn a_tool_discovery_no_longer_finds_is_refused() {
    let dir = project("gone", &["made-up-cli"]);
    let err = start_fresh_session(&request(&dir, "made-up-cli", PROMPT), &[], &[], no_terminal, no_open).unwrap_err();
    assert!(err.contains("not found"), "{}", err);
}

#[test]
fn an_adapter_whose_prompt_args_lack_exactly_one_placeholder_is_rejected_when_parsed() {
    for args in [r#"["--resume"]"#, r#"["{prompt}","{prompt}"]"#] {
        let text = format!(
            r#"{{"formatVersion":1,"id":"bad","name":"Bad","matches":["bad"],"startPrompt":{{"args":{args}}},
            "sources":[{{"url":"https://made-up.example","checked":"2026-11-03","covers":["startPrompt"]}}]}}"#
        );
        let (adapters, issues) = parse_adapters(&[AdapterFile { name: "bad.json".into(), text }]);
        assert!(adapters.is_empty() && issues.len() == 1, "{}", args);
    }
}
