//! Adding OmniOrchestrator's entry to another tool's MCP config (D5). These files belong to other
//! programs: everything else in them must survive, and anything unsafe to edit is refused.

use serde_json::{json, Value};
use tauri_app_lib::commands::mcp_setup::{merge_mcp_entry, McpFormat, MergeStatus};

fn entry() -> Value {
    json!({ "command": "/opt/node/bin/node", "args": ["/opt/omni/dist/main.js", "--project", "/repos/orbit"] })
}

#[test]
fn a_new_config_gets_just_our_entry_in_the_common_format() {
    let (text, status, format) = merge_mcp_entry(None, None, "omni-orchestrator", &entry()).unwrap();
    assert_eq!(status, MergeStatus::Created);
    assert_eq!(format, McpFormat::McpServers);
    let parsed: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(parsed, json!({ "mcpServers": { "omni-orchestrator": entry() } }));
    assert!(text.ends_with('\n'));
}

#[test]
fn the_adapter_format_is_used_for_a_new_config() {
    let (text, _, format) = merge_mcp_entry(None, Some(McpFormat::Servers), "omni-orchestrator", &entry()).unwrap();
    assert_eq!(format, McpFormat::Servers);
    assert!(serde_json::from_str::<Value>(&text).unwrap()["servers"]["omni-orchestrator"].is_object());
}

#[test]
fn everything_else_in_the_file_is_kept_in_its_order() {
    let existing = r#"{
    "zeta": 1,
    "mcpServers": {
        "their-server": { "command": "x", "env": { "TOKEN": "keep-me" } }
    },
    "alpha": [1, 2.5, "three", null, true]
}"#;
    let (text, status, _) = merge_mcp_entry(Some(existing), None, "omni-orchestrator", &entry()).unwrap();
    assert_eq!(status, MergeStatus::Added);
    let parsed: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(parsed["zeta"], json!(1));
    assert_eq!(parsed["alpha"], json!([1, 2.5, "three", null, true]));
    assert_eq!(parsed["mcpServers"]["their-server"], json!({ "command": "x", "env": { "TOKEN": "keep-me" } }));
    assert_eq!(parsed["mcpServers"]["omni-orchestrator"], entry());
    // Key order survives: zeta, mcpServers, alpha; their server before ours.
    let zeta = text.find("\"zeta\"").unwrap();
    let servers = text.find("\"mcpServers\"").unwrap();
    let alpha = text.find("\"alpha\"").unwrap();
    assert!(zeta < servers && servers < alpha, "{}", text);
    assert!(text.find("their-server").unwrap() < text.find("omni-orchestrator").unwrap());
}

#[test]
fn the_key_already_in_the_file_wins_over_the_default() {
    let existing = r#"{ "servers": { "other": { "command": "y" } } }"#;
    let (text, _, format) = merge_mcp_entry(Some(existing), None, "omni-orchestrator", &entry()).unwrap();
    assert_eq!(format, McpFormat::Servers);
    let parsed: Value = serde_json::from_str(&text).unwrap();
    assert!(parsed.get("mcpServers").is_none());
    assert!(parsed["servers"]["omni-orchestrator"].is_object());
}

#[test]
fn our_old_entry_is_updated_and_an_identical_one_is_left_alone() {
    let old = r#"{ "mcpServers": { "omni-orchestrator": { "command": "old-node", "args": [] } } }"#;
    let (updated, status, _) = merge_mcp_entry(Some(old), None, "omni-orchestrator", &entry()).unwrap();
    assert_eq!(status, MergeStatus::Updated);
    let (again, status, _) = merge_mcp_entry(Some(&updated), None, "omni-orchestrator", &entry()).unwrap();
    assert_eq!(status, MergeStatus::Unchanged);
    assert_eq!(again, updated);
}

#[test]
fn windows_line_endings_are_kept() {
    let existing = "{\r\n  \"mcpServers\": {}\r\n}\r\n";
    let (text, _, _) = merge_mcp_entry(Some(existing), None, "omni-orchestrator", &entry()).unwrap();
    assert!(text.contains("\r\n") && !text.replace("\r\n", "").contains('\n'), "{:?}", text);
}

#[test]
fn an_empty_file_is_treated_as_new() {
    let (_, status, _) = merge_mcp_entry(Some("  \n"), None, "omni-orchestrator", &entry()).unwrap();
    assert_eq!(status, MergeStatus::Created);
}

#[test]
fn files_it_cannot_edit_safely_are_refused() {
    let cases = [
        ("{\n  // my servers\n  \"mcpServers\": {}\n}", "comments"),
        ("[model]\nname = \"x\"", "JSON"),
        (r#"{ "mcp": { "other": { "type": "local" } } }"#, "mcpServers"),
        (r#"["not", "an", "object"]"#, "object"),
        (r#"{ "mcpServers": ["wrong"] }"#, "mcpServers"),
        (r#"{ "mcpServers": {}, "servers": {} }"#, "both"),
    ];
    for (text, why) in cases {
        let err = merge_mcp_entry(Some(text), None, "omni-orchestrator", &entry()).unwrap_err();
        assert!(err.contains(why), "{:?} -> {}", text, err);
    }
}

#[test]
fn a_file_with_no_server_list_yet_gets_one_in_the_default_format() {
    let (text, status, format) = merge_mcp_entry(Some(r#"{ "theme": "dark" }"#), None, "omni-orchestrator", &entry()).unwrap();
    assert_eq!(status, MergeStatus::Added);
    assert_eq!(format, McpFormat::McpServers);
    let parsed: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(parsed["theme"], json!("dark"));
}

// --- Choosing the file, writing it safely, and the server command (D5, slice 3).

use std::fs;
use std::path::{Path, PathBuf};
use tauri_app_lib::commands::adapters::{parse_adapters, Adapter, AdapterFile};
use tauri_app_lib::commands::mcp_setup::{resolve_server_command, setup_tool, ServerCommand};
use tauri_app_lib::commands::tool_discovery::{DiscoveredTool, ToolCategory};

fn temp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("omni-mcp-setup-{}-{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}
fn server() -> ServerCommand {
    ServerCommand { command: "/opt/node/bin/node".into(), args: vec!["/opt/omni/dist/main.js".into()] }
}
fn nebula(mcp_config: Option<&Path>, capability: Option<u8>) -> DiscoveredTool {
    DiscoveredTool {
        id: "nebula".into(),
        name: "Nebula".into(),
        category: ToolCategory::Editor,
        capability,
        mcp_config: mcp_config.map(|p| p.to_string_lossy().into_owned()),
        ..Default::default()
    }
}
fn adapter(mcp: &str) -> Adapter {
    let text = format!(
        r#"{{"formatVersion":1,"id":"nebula","name":"Nebula","matches":["nebula"],"mcp":{},
            "sources":[{{"url":"https://nebula.example/docs","checked":"2026-11-01","covers":["mcp"]}}]}}"#,
        mcp
    );
    let (mut adapters, issues) = parse_adapters(&[AdapterFile { name: "nebula.json".into(), text }]);
    assert!(issues.is_empty(), "{:?}", issues);
    adapters.remove(0)
}
fn read_json(path: &Path) -> Value {
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

#[test]
fn the_discovered_config_gets_our_entry_and_a_one_time_backup() {
    let home = temp("found");
    let config = home.join(".nebula").join("mcp.json");
    fs::create_dir_all(config.parent().unwrap()).unwrap();
    let original = r#"{ "mcpServers": { "theirs": { "command": "x" } } }"#;
    fs::write(&config, original).unwrap();

    let result = setup_tool(&nebula(Some(&config), Some(3)), None, &home, None, &server()).unwrap();
    assert_eq!(result.status, MergeStatus::Added);
    assert_eq!(Path::new(&result.config_path), config);
    let json = read_json(&config);
    assert_eq!(json["mcpServers"]["theirs"], json!({ "command": "x" }));
    assert_eq!(json["mcpServers"]["omni-orchestrator"], json!({ "command": "/opt/node/bin/node", "args": ["/opt/omni/dist/main.js"] }));
    let backup = PathBuf::from(result.backup_path.clone().expect("a backup of the original"));
    assert_eq!(fs::read_to_string(&backup).unwrap(), original);

    // A second run with a new server path updates our entry and keeps the original backup.
    let moved = ServerCommand { command: "/opt/node/bin/node".into(), args: vec!["/new/main.js".into()] };
    let again = setup_tool(&nebula(Some(&config), Some(3)), None, &home, None, &moved).unwrap();
    assert_eq!(again.status, MergeStatus::Updated);
    assert_eq!(fs::read_to_string(&backup).unwrap(), original);
    let _ = fs::remove_dir_all(home);
}

#[test]
fn nothing_is_written_when_our_entry_is_already_there() {
    let home = temp("same");
    let config = home.join("mcp.json");
    setup_tool(&nebula(Some(&config), Some(3)), None, &home, None, &server()).unwrap();
    let before = fs::read_to_string(&config).unwrap();
    let result = setup_tool(&nebula(Some(&config), Some(3)), None, &home, None, &server()).unwrap();
    assert_eq!(result.status, MergeStatus::Unchanged);
    assert!(result.backup_path.is_none());
    assert_eq!(fs::read_to_string(&config).unwrap(), before);
    let _ = fs::remove_dir_all(home);
}

#[test]
fn a_project_uses_the_adapters_project_config_and_names_the_project() {
    let home = temp("project-home");
    let project = temp("project");
    let a = adapter(r#"{"format":"servers","projectConfig":".nebula/mcp.json"}"#);
    let result = setup_tool(&nebula(None, Some(3)), Some(&a), &home, Some(&project), &server()).unwrap();
    let config = project.join(".nebula").join("mcp.json");
    assert_eq!(Path::new(&result.config_path), config);
    assert_eq!(result.status, MergeStatus::Created);
    assert!(result.backup_path.is_none(), "a new file needs no backup");
    let args = &read_json(&config)["servers"]["omni-orchestrator"]["args"];
    assert_eq!(args, &json!(["/opt/omni/dist/main.js", "--project", project.to_string_lossy()]));
    let _ = fs::remove_dir_all(home);
    let _ = fs::remove_dir_all(project);
}

#[test]
fn the_adapters_user_config_is_used_when_discovery_found_none() {
    let home = temp("user");
    fs::create_dir_all(home.join(".nebula")).unwrap();
    fs::write(home.join(".nebula").join("settings.json"), r#"{ "theme": "dark" }"#).unwrap();
    let a = adapter(r#"{"format":"mcpServers","userConfig":["~/.nebula/missing.json","~/.nebula/settings.json"]}"#);
    let result = setup_tool(&nebula(None, Some(3)), Some(&a), &home, None, &server()).unwrap();
    assert_eq!(Path::new(&result.config_path), home.join(".nebula").join("settings.json"));
    assert_eq!(read_json(&home.join(".nebula").join("settings.json"))["theme"], json!("dark"));
    let _ = fs::remove_dir_all(home);
}

#[test]
fn a_tool_without_mcp_or_without_a_known_config_is_refused_with_the_manual_entry() {
    let home = temp("refuse");
    let config = home.join("mcp.json");
    let err = setup_tool(&nebula(Some(&config), Some(2)), None, &home, None, &server()).unwrap_err();
    assert!(err.contains("no MCP support"), "{}", err);
    assert!(!config.exists(), "nothing is written for a tool without MCP");
    let err = setup_tool(&nebula(None, Some(3)), None, &home, None, &server()).unwrap_err();
    assert!(err.contains("omni-orchestrator") && err.contains("/opt/omni/dist/main.js"), "the entry is included: {}", err);
    let _ = fs::remove_dir_all(home);
}

#[test]
fn a_file_it_cannot_edit_is_left_exactly_as_it_was() {
    let home = temp("jsonc");
    let config = home.join("mcp.json");
    let original = "{\n  // keep me\n  \"mcpServers\": {}\n}\n";
    fs::write(&config, original).unwrap();
    let err = setup_tool(&nebula(Some(&config), Some(3)), None, &home, None, &server()).unwrap_err();
    assert!(err.contains("comments") && err.contains("omni-orchestrator"), "{}", err);
    assert_eq!(fs::read_to_string(&config).unwrap(), original);
    assert_eq!(fs::read_dir(&home).unwrap().count(), 1, "no backup or temp file left behind");
    let _ = fs::remove_dir_all(home);
}

#[test]
fn unsafe_adapter_config_paths_are_refused_when_adapters_are_read() {
    for mcp in [r#"{"format":"servers","projectConfig":"../outside.json"}"#, r#"{"format":"servers","userConfig":["~/../etc/x.json"]}"#] {
        let text = format!(
            r#"{{"formatVersion":1,"id":"nebula","name":"Nebula","matches":["nebula"],"mcp":{},"sources":[{{"url":"https://n.example","checked":"2026-11-01","covers":["mcp"]}}]}}"#,
            mcp
        );
        let (adapters, issues) = parse_adapters(&[AdapterFile { name: "nebula.json".into(), text }]);
        assert!(adapters.is_empty() && issues.len() == 1, "{}", mcp);
    }
}

#[test]
fn the_server_command_is_found_on_this_machine_or_explained() {
    let dir = temp("server");
    let node_dir = dir.join("bin");
    fs::create_dir_all(&node_dir).unwrap();
    let node = node_dir.join(if cfg!(windows) { "node.exe" } else { "node" });
    fs::write(&node, "").unwrap();
    let main = dir.join("main.js");

    let err = resolve_server_command(None, &main, &[node_dir.clone()]).unwrap_err();
    assert!(err.contains("build"), "{}", err);
    fs::write(&main, "").unwrap();
    let cmd = resolve_server_command(None, &main, &[node_dir.clone()]).unwrap();
    assert_eq!(cmd.command, node.to_string_lossy());
    assert_eq!(cmd.args, vec![main.to_string_lossy().to_string()]);

    let err = resolve_server_command(None, &main, &[]).unwrap_err();
    assert!(err.contains("Node"), "{}", err);

    let other = dir.join("other-main.js");
    fs::write(&other, "").unwrap();
    let cmd = resolve_server_command(Some(other.to_string_lossy().to_string()), &main, &[node_dir]).unwrap();
    assert_eq!(cmd.args, vec![other.to_string_lossy().to_string()]);
    let _ = fs::remove_dir_all(dir);
}
