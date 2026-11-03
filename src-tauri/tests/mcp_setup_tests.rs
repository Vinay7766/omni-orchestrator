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

/// Real-machine check (D5 acceptance), run on request only:
/// OMNI_VERIFY_PROJECT=<throwaway project> cargo test --test mcp_setup_tests real_machine -- --ignored --nocapture
/// Uses real discovery and the shipped adapters, but writes only PROJECT-level configs inside the
/// given project; a tool whose only known config is a per-user file is reported and skipped.
#[test]
#[ignore]
fn real_machine_project_setup() {
    use tauri_app_lib::commands::adapters::{adapter_for, bundled_adapters};
    use tauri_app_lib::commands::tool_discovery::{discover, SystemView};

    let project = PathBuf::from(std::env::var("OMNI_VERIFY_PROJECT").expect("set OMNI_VERIFY_PROJECT to a throwaway project"));
    assert!(project.join(".agents").join("project.json").is_file(), "not an OmniOrchestrator project");
    let view = SystemView::from_environment();
    let built = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("packages").join("mcp-server").join("dist").join("main.js");
    let server = resolve_server_command(None, &built, &view.path_dirs).expect("server command");
    let (adapters, _) = bundled_adapters();
    let home = project.join("no-home-writes"); // user configs are never chosen below
    for tool in discover(&view).iter().filter(|t| t.capability == Some(3)) {
        let adapter = adapter_for(&tool.id, &adapters);
        let has_project_config = adapter.and_then(|a| a.mcp.as_ref()).and_then(|m| m.project_config.as_ref()).is_some();
        if !has_project_config {
            println!("SKIP  {:<16} no project-level config known (would use a per-user file)", tool.id);
            continue;
        }
        match setup_tool(tool, adapter, &home, Some(&project), &server) {
            Ok(r) => println!("OK    {:<16} {:?} {}", tool.id, r.status, r.config_path),
            Err(e) => println!("ERROR {:<16} {}", tool.id, e.lines().next().unwrap_or("")),
        }
    }
}

/// Real-world files, without touching them (D5 acceptance), run on request only:
/// OMNI_VERIFY_COPIES=<folder of COPIES of real MCP configs> cargo test --test mcp_setup_tests real_config_copies -- --ignored --nocapture
/// Merges our entry into each copy and checks that every original key and server survived.
/// Prints counts only, never contents (these files can hold keys).
#[test]
#[ignore]
fn real_config_copies_keep_everything() {
    let dir = PathBuf::from(std::env::var("OMNI_VERIFY_COPIES").expect("set OMNI_VERIFY_COPIES"));
    let mut names: Vec<_> = fs::read_dir(&dir).unwrap().map(|e| e.unwrap().path()).collect();
    names.sort();
    for path in names {
        let original = fs::read_to_string(&path).unwrap();
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        if original.trim().is_empty() {
            let (_, status, _) = merge_mcp_entry(Some(&original), None, "omni-orchestrator", &entry()).unwrap();
            println!("EMPTY   {:<28} {:?} (an empty file has nothing to keep)", name, status);
            continue;
        }
        match merge_mcp_entry(Some(&original), None, "omni-orchestrator", &entry()) {
            Err(why) => println!("REFUSED {:<28} {}", name, why),
            Ok((text, status, format)) => {
                let before: Value = serde_json::from_str(&original).unwrap();
                let after: Value = serde_json::from_str(&text).unwrap();
                let (b, a) = (before.as_object().unwrap(), after.as_object().unwrap());
                let mut lost = 0;
                for (key, value) in b {
                    if key == format.key() {
                        for (server, cfg) in value.as_object().unwrap() {
                            if server != "omni-orchestrator" && after[key].get(server) != Some(cfg) {
                                lost += 1;
                            }
                        }
                    } else if a.get(key) != Some(value) {
                        lost += 1;
                    }
                }
                let order_kept = b.keys().collect::<Vec<_>>() == a.keys().filter(|k| b.contains_key(*k)).collect::<Vec<_>>();
                let servers = before.get(format.key()).and_then(|s| s.as_object()).map(|s| s.len()).unwrap_or(0);
                println!(
                    "{:<7} {:<28} {:?} keys={} servers_before={} lost={} order_kept={}",
                    if lost == 0 && order_kept { "OK" } else { "LOSS" },
                    name, status, b.len(), servers, lost, order_kept
                );
                assert_eq!(lost, 0, "{}", name);
                assert!(order_kept, "{}", name);
            }
        }
    }
}

#[test]
fn the_server_command_carries_the_persons_skills_folder_for_every_tool() {
    // SKL-5: the app adds --user-skills, so each tool gets the skills the person added or edited.
    use tauri_app_lib::commands::mcp_setup::with_user_skills;
    let server = ServerCommand { command: "/usr/bin/node".into(), args: vec!["/app/main.js".into()] };
    let folder = Path::new("/data/omni/skills");
    let with = with_user_skills(server.clone(), folder);
    assert_eq!(with.args, vec!["/app/main.js".to_string(), "--user-skills".into(), "/data/omni/skills".into()]);
    assert_eq!(with.command, server.command);
}

#[test]
fn two_projects_in_a_shared_user_config_each_keep_their_own_entry() {
    // P-E6-02: a tool whose MCP settings live in the person's home folder is shared by every
    // project; handing off a second project must not replace the first one's entry.
    let home = temp("shared-home");
    let config = home.join(".nebula").join("mcp.json");
    fs::create_dir_all(config.parent().unwrap()).unwrap();
    fs::write(&config, "{}").unwrap();
    let first = temp("shared-orbit");
    let second = temp("shared-comet");
    setup_tool(&nebula(Some(&config), Some(3)), None, &home, Some(&first), &server()).unwrap();
    setup_tool(&nebula(Some(&config), Some(3)), None, &home, Some(&second), &server()).unwrap();

    let servers = read_json(&config)["mcpServers"].as_object().unwrap().clone();
    let ours: Vec<_> = servers.iter().filter(|(name, _)| name.starts_with("omni-orchestrator")).collect();
    assert_eq!(ours.len(), 2, "{:?}", servers.keys().collect::<Vec<_>>());
    for project in [&first, &second] {
        let p = project.to_string_lossy();
        assert!(
            ours.iter().any(|(_, e)| e["args"].as_array().unwrap().iter().any(|a| a.as_str() == Some(&p))),
            "no entry serves {p}"
        );
    }
    // Names are stable: handing the same project off again changes nothing.
    let again = setup_tool(&nebula(Some(&config), Some(3)), None, &home, Some(&first), &server()).unwrap();
    assert_eq!(again.status, MergeStatus::Unchanged);
    for d in [home, first, second] {
        let _ = fs::remove_dir_all(d);
    }
}
