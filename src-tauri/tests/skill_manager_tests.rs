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

#[test]
fn test_every_catalog_skill_declares_a_license_or_unverified() {
    let manager = SkillManager::new(std::env::temp_dir().join("agent_orchestrator_skill_license_test"));
    let skills = manager.get_default_skills();

    for skill in &skills {
        let license = skill.license.as_deref().unwrap_or_else(|| panic!("{} has no license field", skill.id));
        assert!(!license.is_empty(), "{} has an empty license", skill.id);
    }
    let license_of = |id: &str| skills.iter().find(|s| s.id == id).and_then(|s| s.license.clone());
    assert_eq!(license_of("brainstorming").as_deref(), Some("MIT"));
    assert_eq!(license_of("solution-design").as_deref(), Some("Apache-2.0"));
}

#[test]
fn test_embedded_catalog_content_matches_skill_files_on_disk() {
    let manager = SkillManager::new(std::env::temp_dir().join("agent_orchestrator_skill_content_test"));
    let skills_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("skills");

    for skill in manager.get_default_skills() {
        let on_disk = std::fs::read_to_string(skills_dir.join(&skill.id).join("SKILL.md"))
            .unwrap_or_else(|_| panic!("missing SKILL.md for {}", skill.id))
            .replace("\r\n", "\n");
        assert_eq!(skill.content, on_disk, "embedded content differs from skills/{}/SKILL.md", skill.id);
        assert!(!skill.content.contains('\r'), "{} content must be LF-normalised", skill.id);
    }
}
