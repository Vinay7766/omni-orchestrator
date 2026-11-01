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
