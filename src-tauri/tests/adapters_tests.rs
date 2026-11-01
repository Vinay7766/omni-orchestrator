//! Optional adapters (TOOL-5) on the Rust side. Managed-block behaviour must match the
//! TypeScript core exactly, so both run packages/core/test-data/managed-block-cases.json.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use tauri_app_lib::commands::adapters::{
    adapter_for, apply_managed_block, bundled_adapters, parse_adapters, AdapterFile, ManagedBlockStatus, MANAGED_BEGIN,
    MANAGED_END,
};

fn core_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("packages").join("core")
}

fn file(name: &str, text: &str) -> AdapterFile {
    AdapterFile { name: name.to_string(), text: text.to_string() }
}

fn nebula(instruction_file: &str) -> String {
    format!(
        r#"{{"formatVersion":1,"id":"nebula","name":"Nebula","matches":["nebula","nebula-cli"],
            "instructionFiles":["{}"],
            "sources":[{{"url":"https://nebula.example/docs","checked":"2026-11-01","covers":["instructionFiles"]}}]}}"#,
        instruction_file
    )
}

#[test]
fn every_shared_managed_block_case_matches_the_typescript_core() {
    let cases: Value =
        serde_json::from_str(&fs::read_to_string(core_dir().join("test-data").join("managed-block-cases.json")).unwrap()).unwrap();
    assert_eq!(cases["begin"].as_str().unwrap(), MANAGED_BEGIN);
    assert_eq!(cases["end"].as_str().unwrap(), MANAGED_END);
    let list = cases["cases"].as_array().unwrap();
    assert!(!list.is_empty());
    for case in list {
        let name = case["name"].as_str().unwrap();
        let (text, status) = apply_managed_block(case["existing"].as_str(), case["body"].as_str().unwrap());
        assert_eq!(text, case["text"].as_str().unwrap(), "text for case: {}", name);
        let expected: ManagedBlockStatus = serde_json::from_value(case["status"].clone()).unwrap();
        assert_eq!(status, expected, "status for case: {}", name);
    }
}

#[test]
fn a_made_up_tool_adapter_is_found_by_any_of_its_ids() {
    let (adapters, issues) = parse_adapters(&[file("nebula.json", &nebula(".nebula/rules.md"))]);
    assert!(issues.is_empty(), "{:?}", issues);
    assert_eq!(adapter_for("nebula-cli", &adapters).map(|a| a.id.as_str()), Some("nebula"));
    assert!(adapter_for("orbit", &adapters).is_none());
}

#[test]
fn no_adapters_means_no_adapter_for_any_tool() {
    let (adapters, issues) = parse_adapters(&[]);
    assert!(adapters.is_empty() && issues.is_empty());
    assert!(adapter_for("anything", &adapters).is_none());
}

#[test]
fn invalid_json_is_reported_by_file_name_and_left_out() {
    let (adapters, issues) = parse_adapters(&[file("broken.json", "{ not json"), file("nebula.json", &nebula("R.md"))]);
    assert_eq!(adapters.len(), 1);
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].file, "broken.json");
}

#[test]
fn the_file_name_must_match_the_adapter_id() {
    let (adapters, issues) = parse_adapters(&[file("other.json", &nebula("R.md"))]);
    assert!(adapters.is_empty());
    assert!(issues[0].message.contains("nebula.json"), "{}", issues[0].message);
}

#[test]
fn two_adapters_cannot_claim_the_same_tool() {
    let second = nebula("R.md").replace(r#""id":"nebula""#, r#""id":"nebula2""#);
    let (adapters, issues) = parse_adapters(&[file("nebula.json", &nebula("R.md")), file("nebula2.json", &second)]);
    assert_eq!(adapters.len(), 1);
    assert_eq!(issues[0].file, "nebula2.json");
}

#[test]
fn instruction_files_outside_the_project_are_refused() {
    for bad in ["../outside.md", "/etc/rules.md", "C:/rules.md", "a/../../b.md", "a\\\\b.md", ""] {
        let (adapters, issues) = parse_adapters(&[file("nebula.json", &nebula(bad))]);
        assert!(adapters.is_empty(), "path {:?} must be refused", bad);
        assert_eq!(issues.len(), 1, "path {:?}", bad);
    }
}

#[test]
fn the_bundled_adapters_are_exactly_the_shipped_files_and_all_parse() {
    let (adapters, issues) = bundled_adapters();
    assert!(issues.is_empty(), "{:?}", issues);
    let mut shipped: Vec<String> = fs::read_dir(core_dir().join("adapters"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".json"))
        .map(|n| n.trim_end_matches(".json").to_string())
        .collect();
    shipped.sort();
    let mut ids: Vec<String> = adapters.iter().map(|a| a.id.clone()).collect();
    ids.sort();
    assert_eq!(ids, shipped);
}
