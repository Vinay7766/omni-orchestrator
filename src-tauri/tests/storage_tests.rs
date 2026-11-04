use tauri_app_lib::models::*;
use tauri_app_lib::storage::store::StorageManager;

#[test]
fn test_settings_serialization_roundtrip() {
    let mut settings = AppSettings::default();
    settings.theme = "dark".to_string();
    settings.default_track = TrackType::TrackB;
    settings.byok.preferred_model = Some("gemini-2.5-flash".to_string());

    let json = serde_json::to_string(&settings).expect("Serialization failed");
    let deserialized: AppSettings = serde_json::from_str(&json).expect("Deserialization failed");

    assert_eq!(settings, deserialized);
}

#[test]
fn test_custom_skill_storage_operations() {
    let temp_dir = std::env::temp_dir().join("agent_orchestrator_test_store");
    let storage = StorageManager::new(temp_dir.clone());

    let skill = Skill {
        id: "test-skill".to_string(),
        name: "Test Skill".to_string(),
        description: "A test skill for TDD".to_string(),
        category: SkillCategory::Testing,
        attribution: AuthorAttribution {
            name: "Test Author".to_string(),
            role: Some("Engineer".to_string()),
            source_url: "https://github.com/example".to_string(),
            verified: true,
            avatar_url: None,
        },
        enabled: true,
        content: "# Test Skill Instructions".to_string(),
        is_custom: true,
        phases: vec!["build".to_string()],
        domains: vec![],
        license: None,
    };

    // Save
    storage.save_custom_skill(skill.clone()).expect("Failed to save custom skill");

    // Load
    let skills = storage.load_custom_skills().expect("Failed to load skills");
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].id, "test-skill");

    // Delete
    storage.delete_custom_skill("test-skill").expect("Failed to delete skill");
    let skills_after_delete = storage.load_custom_skills().expect("Failed to load skills");
    assert_eq!(skills_after_delete.len(), 0);

    // Clean up
    let _ = std::fs::remove_dir_all(temp_dir);
}

// Owner's v0.1 issue B (2026-11-04): what the person has typed but not saved into a project yet
// (the idea conversation, conversations on documents) is kept on disk and read back on start.

fn ui_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("omni_ui_state_{}_{}", name, std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

#[test]
fn ui_state_is_saved_to_disk_and_read_back() {
    let dir = ui_dir("roundtrip");
    let storage = StorageManager::new(dir.clone());
    assert_eq!(storage.load_ui_state().unwrap(), None, "nothing before the first save");
    storage.save_ui_state(r#"{"ideaDraft":{"idea":"a made-up idea","name":""}}"#).unwrap();
    let again = StorageManager::new(dir.clone());
    assert_eq!(again.load_ui_state().unwrap().as_deref(), Some(r#"{"ideaDraft":{"idea":"a made-up idea","name":""}}"#));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn ui_state_refuses_text_that_is_not_json_or_too_large_and_keeps_the_last_good_one() {
    let dir = ui_dir("refuse");
    let storage = StorageManager::new(dir.clone());
    storage.save_ui_state(r#"{"ok":true}"#).unwrap();
    assert!(storage.save_ui_state("not json").is_err());
    assert!(storage.save_ui_state(&format!(r#"{{"x":"{}"}}"#, "a".repeat(3 * 1024 * 1024))).is_err());
    assert_eq!(storage.load_ui_state().unwrap().as_deref(), Some(r#"{"ok":true}"#));
    let _ = std::fs::remove_dir_all(dir);
}

// Retest bug 4 (2026-11-04): the teardown is saved where the person chose in the save dialog.

#[test]
fn an_export_is_written_where_the_person_chose_with_md_added_when_missing() {
    use tauri_app_lib::commands::storage_cmd::write_export;
    let dir = ui_dir("export");
    std::fs::create_dir_all(&dir).unwrap();
    let chosen = dir.join("made-up-co-teardown");
    let written = write_export(&chosen, "# Report").unwrap();
    assert_eq!(written, dir.join("made-up-co-teardown.md"));
    assert_eq!(std::fs::read_to_string(&written).unwrap(), "# Report");
    let kept = write_export(&dir.join("named.markdown"), "x").unwrap();
    assert_eq!(kept, dir.join("named.markdown"), "an extension the person typed is kept");
    let _ = std::fs::remove_dir_all(dir);
}
