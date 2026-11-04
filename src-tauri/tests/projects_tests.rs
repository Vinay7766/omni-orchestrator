//! Finding OmniOrchestrator projects under the folders the person configured (E2, APP-1).
//! Only project roots are returned; their memory is read by @omni/core in the app.

use std::fs;
use std::path::{Path, PathBuf};
use tauri_app_lib::commands::projects::find_projects_in;
use tauri_app_lib::models::AppSettings;

fn temp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("omni-projects-{}-{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}
fn project(at: &Path) {
    fs::create_dir_all(at.join(".agents")).unwrap();
    fs::write(at.join(".agents").join("project.json"), "{}").unwrap();
}
fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

#[test]
fn finds_projects_one_and_two_levels_down_but_not_deeper() {
    let base = temp("depth");
    project(&base.join("orbit"));
    project(&base.join("clients").join("nebula"));
    project(&base.join("a").join("b").join("too-deep"));
    let result = find_projects_in(&[s(&base)]);
    assert!(result.errors.is_empty(), "{:?}", result.errors);
    assert_eq!(result.roots, vec![s(&base.join("clients").join("nebula")), s(&base.join("orbit"))]);
    let _ = fs::remove_dir_all(base);
}

#[test]
fn the_configured_folder_itself_can_be_a_project_and_is_not_searched_further() {
    let base = temp("self");
    project(&base);
    project(&base.join("inner"));
    assert_eq!(find_projects_in(&[s(&base)]).roots, vec![s(&base)]);
    let _ = fs::remove_dir_all(base);
}

#[test]
fn skips_hidden_dependency_and_build_folders() {
    let base = temp("skip");
    for name in [".hidden", "node_modules", "target", "dist", "build", ".git"] {
        project(&base.join(name).join("x"));
        project(&base.join(name));
    }
    project(&base.join("real"));
    assert_eq!(find_projects_in(&[s(&base)]).roots, vec![s(&base.join("real"))]);
    let _ = fs::remove_dir_all(base);
}

#[test]
fn a_project_reachable_from_two_folders_is_listed_once() {
    let base = temp("dedupe");
    project(&base.join("orbit"));
    let result = find_projects_in(&[s(&base), s(&base.join("orbit"))]);
    assert_eq!(result.roots, vec![s(&base.join("orbit"))]);
    let _ = fs::remove_dir_all(base);
}

#[test]
fn folders_that_cannot_be_used_are_reported_not_guessed() {
    let base = temp("bad");
    let result = find_projects_in(&["relative/path".to_string(), s(&base.join("missing")), "".to_string()]);
    assert!(result.roots.is_empty());
    assert_eq!(result.errors.len(), 3, "{:?}", result.errors);
    assert!(result.errors[0].contains("absolute"), "{:?}", result.errors);
    assert!(result.errors[1].contains("does not exist"), "{:?}", result.errors);
    let _ = fs::remove_dir_all(base);
}

#[test]
fn a_folder_with_agents_but_no_project_file_is_not_a_project() {
    let base = temp("other-tool");
    fs::create_dir_all(base.join("app").join(".agents").join("skills")).unwrap();
    assert!(find_projects_in(&[s(&base)]).roots.is_empty());
    let _ = fs::remove_dir_all(base);
}

#[test]
fn settings_written_before_project_folders_existed_still_load() {
    let old = r#"{ "defaultTrack": "track-a", "theme": "dark", "byok": {} }"#;
    let settings: AppSettings = serde_json::from_str(old).unwrap();
    assert!(settings.project_folders.is_empty());
}

#[test]
fn the_registered_projects_are_written_for_the_mcp_server() {
    // RT-14: the MCP server opens only its own project and the ones listed here.
    use tauri_app_lib::commands::projects::{write_registry, REGISTRY_FILE};
    let app_dir = temp("registry");
    let roots = vec!["/repos/orbit".to_string(), "/repos/atlas".to_string()];
    write_registry(&app_dir, &roots).unwrap();
    let written: serde_json::Value = serde_json::from_str(&fs::read_to_string(app_dir.join(REGISTRY_FILE)).unwrap()).unwrap();
    assert_eq!(written, serde_json::json!({ "formatVersion": 1, "roots": ["/repos/orbit", "/repos/atlas"] }));
}
