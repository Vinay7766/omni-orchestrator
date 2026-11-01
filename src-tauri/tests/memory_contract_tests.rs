//! The Rust side of the project-memory contract must agree with /schemas, the same
//! files the TypeScript core is generated from. Every fixture is checked here too.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use tauri_app_lib::models::memory::{Event, EventType, Project, State};

fn schemas_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("schemas")
}

fn read_json(path: &Path) -> Value {
    serde_json::from_str(&fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {}", path.display(), e)))
        .unwrap_or_else(|e| panic!("{}: {}", path.display(), e))
}

/// Every *.schema.json, keyed by its urn id, so cross-schema refs resolve locally
/// (no network or file resolution features are enabled).
fn all_schemas() -> Vec<(String, Value)> {
    let mut out = Vec::new();
    for entry in fs::read_dir(schemas_dir()).unwrap() {
        let path = entry.unwrap().path();
        if path.to_string_lossy().ends_with(".schema.json") {
            let schema = read_json(&path);
            let id = schema["$id"].as_str().expect("every schema has a $id").to_string();
            out.push((id, schema));
        }
    }
    out
}

/// Resolves `urn:omni:schema:*` refs from memory, following jsonschema's documented
/// in-memory retriever pattern. Anything else is refused.
struct LocalSchemas(std::collections::HashMap<String, Value>);

impl jsonschema::Retrieve for LocalSchemas {
    fn retrieve(&self, uri: &jsonschema::Uri<String>) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        self.0.get(uri.as_str()).cloned().ok_or_else(|| format!("schema not available locally: {}", uri).into())
    }
}

fn validator_for(name: &str) -> jsonschema::Validator {
    let schemas = all_schemas();
    let target = format!("urn:omni:schema:{}", name);
    let main = schemas.iter().find(|(id, _)| *id == target).unwrap_or_else(|| panic!("no schema {}", target)).1.clone();
    jsonschema::options()
        .with_draft(jsonschema::Draft::Draft202012)
        .with_retriever(LocalSchemas(schemas.into_iter().collect()))
        .build(&main)
        .unwrap_or_else(|e| panic!("schema {} does not compile: {}", name, e))
}

fn fixtures(name: &str, kind: &str) -> Vec<(String, Value)> {
    let dir = schemas_dir().join("fixtures").join(name).join(kind);
    let mut out: Vec<_> = fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{}: {}", dir.display(), e))
        .map(|e| e.unwrap().path())
        .map(|p| (p.file_name().unwrap().to_string_lossy().into_owned(), read_json(&p)))
        .collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

fn schema_names_with_fixtures() -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(schemas_dir().join("fixtures"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[test]
fn rust_schema_validation_agrees_with_every_fixture() {
    for name in schema_names_with_fixtures() {
        let validator = validator_for(&name);
        for (file, data) in fixtures(&name, "valid") {
            let errors: Vec<String> = validator.iter_errors(&data).map(|e| e.to_string()).collect();
            assert!(errors.is_empty(), "{}/valid/{} rejected: {:?}", name, file, errors);
        }
        for (file, data) in fixtures(&name, "invalid") {
            assert!(!validator.is_valid(&data), "{}/invalid/{} was accepted", name, file);
        }
    }
}

/// Valid fixtures must load into the Rust types and serialize back to schema-valid JSON.
fn round_trips<T: serde::de::DeserializeOwned + serde::Serialize>(name: &str) {
    let validator = validator_for(name);
    for (file, data) in fixtures(name, "valid") {
        let typed: T = serde_json::from_value(data.clone())
            .unwrap_or_else(|e| panic!("{}/valid/{} does not load into the Rust type: {}", name, file, e));
        let back = serde_json::to_value(&typed).unwrap();
        assert!(validator.is_valid(&back), "{}/valid/{} is no longer valid after a Rust round trip", name, file);
        assert_eq!(back, data, "{}/valid/{} changed during a Rust round trip", name, file);
    }
}

#[test]
fn project_fixtures_round_trip_through_rust_types() {
    round_trips::<Project>("project");
}

#[test]
fn state_fixtures_round_trip_through_rust_types() {
    round_trips::<State>("state");
}

#[test]
fn event_fixtures_round_trip_through_rust_types() {
    round_trips::<Event>("event");
}

#[test]
fn rust_types_reject_invalid_enum_values() {
    for (file, data) in fixtures("state", "invalid") {
        if file.starts_with("unknown-") {
            assert!(serde_json::from_value::<State>(data).is_err(), "state/invalid/{} loaded into State", file);
        }
    }
    let project = fixtures("project", "invalid").into_iter().find(|(f, _)| f == "unknown-mode.json").unwrap().1;
    assert!(serde_json::from_value::<Project>(project).is_err());
}

#[test]
fn event_type_enum_matches_the_schema_exactly() {
    let schema = read_json(&schemas_dir().join("event.schema.json"));
    let mut in_schema: Vec<String> = schema["properties"]["type"]["enum"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    let mut in_rust: Vec<String> = EventType::ALL
        .iter()
        .map(|t| serde_json::to_value(t).unwrap().as_str().unwrap().to_string())
        .collect();
    in_schema.sort();
    in_rust.sort();
    assert_eq!(in_rust, in_schema, "EventType in Rust and the event schema's type enum differ");
}
