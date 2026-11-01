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

/// All phase ids across every flow, read from the shared contract file.
fn all_phase_ids() -> std::collections::BTreeSet<String> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("schemas").join("phases.json");
    let doc: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).expect("schemas/phases.json"))
        .expect("phases.json is valid JSON");
    doc["flows"]
        .as_object()
        .expect("phases.json has a flows object")
        .values()
        .flat_map(|phases| phases.as_array().expect("each flow is an array").iter())
        .map(|p| p.as_str().expect("phase ids are strings").to_string())
        .collect()
}

#[test]
fn test_every_skill_maps_to_known_phases() {
    let manager = SkillManager::new(std::env::temp_dir().join("agent_orchestrator_skill_phase_test"));
    let known = all_phase_ids();

    for skill in manager.get_default_skills() {
        assert!(!skill.phases.is_empty(), "{} has no phases", skill.id);
        if skill.phases.iter().any(|p| p == "all") {
            assert_eq!(skill.phases, vec!["all".to_string()], "{}: \"all\" cannot be combined with named phases", skill.id);
            continue;
        }
        for phase in &skill.phases {
            assert!(known.contains(phase), "{} maps to unknown phase \"{}\"", skill.id, phase);
        }
    }
}

#[test]
fn test_every_phase_has_at_least_one_dedicated_skill() {
    let manager = SkillManager::new(std::env::temp_dir().join("agent_orchestrator_phase_coverage_test"));
    let skills = manager.get_default_skills();

    // "all" skills don't count: each phase needs a skill chosen for it.
    for phase in all_phase_ids() {
        let covered = skills.iter().any(|s| s.phases.iter().any(|p| *p == phase));
        assert!(covered, "phase \"{}\" has no skill mapped to it", phase);
    }
}

/// Domain ids from skills/domains.json (a growable list, not hard-coded here).
fn all_domain_ids() -> std::collections::BTreeSet<String> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("skills").join("domains.json");
    let doc: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).expect("skills/domains.json"))
        .expect("domains.json is valid JSON");
    doc["domains"]
        .as_array()
        .expect("domains.json has a domains array")
        .iter()
        .map(|d| d["id"].as_str().expect("each domain has a string id").to_string())
        .collect()
}

#[test]
fn test_every_skill_is_tagged_with_known_domains() {
    let manager = SkillManager::new(std::env::temp_dir().join("agent_orchestrator_skill_domain_test"));
    let known = all_domain_ids();

    for skill in manager.get_default_skills() {
        assert!(!skill.domains.is_empty(), "{} has no domains", skill.id);
        for domain in &skill.domains {
            assert!(known.contains(domain), "{} has unknown domain \"{}\"", skill.id, domain);
        }
    }
}

#[test]
fn test_every_domain_is_covered_by_at_least_one_skill() {
    let manager = SkillManager::new(std::env::temp_dir().join("agent_orchestrator_domain_coverage_test"));
    let skills = manager.get_default_skills();

    let uncovered: std::collections::BTreeSet<String> = all_domain_ids()
        .into_iter()
        .filter(|d| !skills.iter().any(|s| s.domains.contains(d)))
        .collect();

    // Gaps still being filled are listed explicitly; the list must match exactly,
    // so a new gap fails here and a filled gap must be removed from the list.
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("skills").join("domains.json");
    let doc: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let pending: std::collections::BTreeSet<String> = doc["pendingGaps"]
        .as_array()
        .map(|a| a.iter().map(|v| v.as_str().unwrap().to_string()).collect())
        .unwrap_or_default();

    let new_gaps: Vec<_> = uncovered.difference(&pending).cloned().collect();
    let filled_but_listed: Vec<_> = pending.difference(&uncovered).cloned().collect();
    assert!(new_gaps.is_empty(), "domains with no skill: {}", new_gaps.join(", "));
    assert!(
        filled_but_listed.is_empty(),
        "now covered, remove from pendingGaps: {}",
        filled_but_listed.join(", ")
    );
}

#[test]
fn test_no_skill_description_is_a_leftover_yaml_block_marker() {
    let manager = SkillManager::new(std::env::temp_dir().join("agent_orchestrator_skill_desc_test"));

    for skill in manager.get_default_skills() {
        let d = skill.description.trim();
        assert!(
            !matches!(d, ">" | ">-" | ">+" | "|" | "|-" | "|+"),
            "{} description is a YAML block marker, not text: {:?}",
            skill.id,
            d
        );
        assert!(d.len() >= 20, "{} description is too short to be useful: {:?}", skill.id, d);
    }
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
