use tauri_app_lib::commands::skill_manager::SkillManager;

#[test]
fn test_default_skills_seeded_with_author_attribution() {
    let temp_dir = std::env::temp_dir().join("agent_orchestrator_skill_test");
    let manager = SkillManager::new(temp_dir.clone());

    let skills = manager.get_all_skills().expect("Failed to get skills");
    assert!(skills.len() >= 50, "Expected at least 50 skills, found {}", skills.len());

    // Verify key standardized skills exist
    let ids: Vec<_> = skills.iter().map(|s| s.id.as_str()).collect();
    assert!(ids.contains(&"spec-driven-development"), "spec-driven-development missing");
    assert!(ids.contains(&"test-driven-development"), "test-driven-development missing");
    assert!(ids.contains(&"vibe-code-rescue"), "vibe-code-rescue missing");
    assert!(ids.contains(&"product-teardown"), "product-teardown missing");
    assert!(ids.contains(&"security-and-hardening"), "security-and-hardening missing");

    // Verify author attribution is fully populated
    for skill in &skills {
        assert!(!skill.attribution.name.is_empty(), "Author name must not be empty for {}", skill.id);
        assert!(!skill.attribution.source_url.is_empty(), "Source URL must not be empty for {}", skill.id);
        assert!(skill.attribution.verified, "Default skills must be verified for {}", skill.id);
    }

    // Verify toggle functionality
    let initial_state = skills[0].enabled;
    manager.toggle_skill(&skills[0].id, !initial_state).expect("Toggle failed");
    let updated_skills = manager.get_all_skills().expect("Failed to get skills");
    assert_eq!(updated_skills[0].enabled, !initial_state);

    // Clean up
    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
fn test_catalog_includes_design_phase_skills_with_attribution() {
    let temp_dir = std::env::temp_dir().join("agent_orchestrator_skill_catalog_test");
    let manager = SkillManager::new(temp_dir.clone());
    let skills = manager.get_default_skills();

    // An unparseable catalog silently yields an empty list, so guard the count explicitly.
    assert!(skills.len() >= 54, "Expected at least 54 catalog skills, found {}", skills.len());

    let brainstorming = skills.iter().find(|s| s.id == "brainstorming").expect("brainstorming missing");
    assert!(brainstorming.attribution.source_url.contains("obra/superpowers"));
    assert!(brainstorming.content.contains("MIT License"), "MIT notice must ship with the bundled copy");

    let solution_design = skills.iter().find(|s| s.id == "solution-design").expect("solution-design missing");
    assert!(solution_design.content.contains("Design it twice"));

    let _ = std::fs::remove_dir_all(temp_dir);
}
