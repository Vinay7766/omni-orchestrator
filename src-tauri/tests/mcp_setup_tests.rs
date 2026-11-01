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
