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
fn test_understand_intent_runs_in_every_planning_phase_and_review() {
    let manager = SkillManager::new(std::env::temp_dir().join("agent_orchestrator_understand_intent_test"));
    let skills = manager.get_default_skills();
    let skill = skills.iter().find(|s| s.id == "understand-intent").expect("understand-intent missing");

    for phase in ["idea-review", "research", "prd", "architecture", "review"] {
        assert!(skill.phases.iter().any(|p| p == phase), "understand-intent not mapped to {}", phase);
    }
    assert!(skill.content.contains("Understanding check"), "skill must define the understanding-check output");
}

#[test]
fn test_solution_design_requires_a_generalisation_check() {
    let manager = SkillManager::new(std::env::temp_dir().join("agent_orchestrator_generalisation_test"));
    let skills = manager.get_default_skills();
    let skill = skills.iter().find(|s| s.id == "solution-design").expect("solution-design missing");

    assert!(skill.content.contains("Generalisation check"), "solution-design must include the generalisation check step");
    // The step text also contains "Generalisation check:", so match the template's
    // placeholder line specifically.
    assert!(
        skill.content.contains("\nGeneralisation check: <"),
        "the design-note template must include a 'Generalisation check: <...>' field"
    );
}

#[test]
fn test_every_licensed_third_party_source_ships_its_license_text() {
    let manager = SkillManager::new(std::env::temp_dir().join("agent_orchestrator_third_party_test"));
    let notices = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("skills").join("THIRD_PARTY_LICENSES.md"),
    )
    .expect("skills/THIRD_PARTY_LICENSES.md must exist");

    for skill in manager.get_default_skills() {
        let license = skill.license.as_deref().unwrap_or("unverified");
        let source = &skill.attribution.source_url;
        let own_project = source.contains("Vinay7766/omni-orchestrator");
        if license == "unverified" || own_project {
            continue;
        }
        assert!(
            notices.contains(source.as_str()),
            "{} comes from {} ({}) but that source is not listed in THIRD_PARTY_LICENSES.md",
            skill.id,
            source,
            license
        );
    }
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

// A7 / SKL-9: phases are organised like a company's teams. Each domain belongs to a function
// (product, UX, engineering, QA, security, release, operations, ...; the list can grow), each
// function works in named phases, and every phase of every flow has at least one function.

fn domains_doc() -> serde_json::Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("skills").join("domains.json");
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn function_ids(doc: &serde_json::Value) -> std::collections::BTreeSet<String> {
    doc["functions"]
        .as_array()
        .expect("domains.json has a functions array")
        .iter()
        .map(|f| f["id"].as_str().expect("each function has a string id").to_string())
        .collect()
}

#[test]
fn test_every_domain_belongs_to_a_known_function() {
    let doc = domains_doc();
    let functions = function_ids(&doc);
    for domain in doc["domains"].as_array().unwrap() {
        let id = domain["id"].as_str().unwrap();
        let function = domain["function"].as_str().unwrap_or_else(|| panic!("domain \"{}\" has no function", id));
        assert!(functions.contains(function), "domain \"{}\" names unknown function \"{}\"", id, function);
    }
}

#[test]
fn test_every_function_has_a_domain_and_known_phases() {
    let doc = domains_doc();
    let phases = all_phase_ids();
    for function in doc["functions"].as_array().unwrap() {
        let id = function["id"].as_str().unwrap();
        assert!(
            doc["domains"].as_array().unwrap().iter().any(|d| d["function"] == function["id"]),
            "function \"{}\" has no domain",
            id
        );
        let listed = function["phases"].as_array().unwrap_or_else(|| panic!("function \"{}\" has no phases", id));
        assert!(!listed.is_empty(), "function \"{}\" works in no phase", id);
        for phase in listed {
            let phase = phase.as_str().unwrap();
            assert!(phases.contains(phase), "function \"{}\" names unknown phase \"{}\"", id, phase);
        }
    }
}

#[test]
fn test_every_phase_of_every_flow_has_a_function() {
    let doc = domains_doc();
    for phase in all_phase_ids() {
        let staffed = doc["functions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f["phases"].as_array().map(|p| p.iter().any(|x| x == phase.as_str())).unwrap_or(false));
        assert!(staffed, "phase \"{}\" has no function working in it", phase);
    }
}

#[test]
fn test_the_domain_list_cites_its_yardsticks() {
    let doc = domains_doc();
    let sources = doc["sources"].as_array().expect("domains.json lists the yardsticks it was checked against");
    assert!(!sources.is_empty());
    for source in sources {
        let url = source["url"].as_str().expect("each source has a url");
        assert!(url.starts_with("https://"), "source url must be https: {}", url);
        assert!(source["name"].as_str().map(|n| !n.is_empty()).unwrap_or(false), "each source has a name");
    }
}

// --- The person's own skills folder, shared with the MCP server (SKL-5; tester feedback 4 and 8) ---

use tauri_app_lib::commands::skill_manager::NewSkill;

fn fresh_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("omni_user_skills_{}_{}", name, std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn read_json(path: std::path::PathBuf) -> serde_json::Value {
    serde_json::from_str(&std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {}", path.display(), e))).unwrap()
}

fn new_skill(id: &str) -> NewSkill {
    NewSkill {
        id: id.into(),
        name: "My made-up skill".into(),
        description: "A person's own skill, made up for tests.".into(),
        content: "---\nname: my-made-up-skill\n---\n\nMY OWN METHOD\n".into(),
        phases: vec!["build".into()],
        author: "The person".into(),
        source_url: "https://example.com/my-skill".into(),
        license: "MIT".into(),
    }
}

#[test]
fn switching_a_skill_off_is_written_where_the_mcp_server_reads_it() {
    let dir = fresh_dir("toggle");
    let manager = SkillManager::new(dir.clone());
    manager.toggle_skill("solution-design", false).unwrap();
    let states = read_json(dir.join("skills").join("skills.json"));
    assert_eq!(states["formatVersion"], 1);
    assert_eq!(states["skills"]["solution-design"]["enabled"], false);
    let skills = manager.get_all_skills().unwrap();
    assert!(!skills.iter().find(|s| s.id == "solution-design").unwrap().enabled);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn editing_a_bundled_skill_writes_its_text_and_catalog_entry_to_the_persons_folder() {
    let dir = fresh_dir("edit");
    let manager = SkillManager::new(dir.clone());
    manager.update_skill("solution-design", "EDITED TEXT".into(), "An edited description, long enough.".into()).unwrap();
    let user = dir.join("skills");
    assert_eq!(std::fs::read_to_string(user.join("solution-design").join("SKILL.md")).unwrap(), "EDITED TEXT");
    let catalog = read_json(user.join("catalog.json"));
    let entry = catalog.as_array().unwrap().iter().find(|e| e["id"] == "solution-design").expect("entry written");
    for field in ["id", "name", "description", "category", "attribution", "enabled", "isCustom", "license", "phases", "domains"] {
        assert!(entry.get(field).is_some(), "catalog entry lacks {field}: {entry}");
    }
    assert!(entry.get("content").is_none(), "the text lives in SKILL.md, not the catalog");
    assert_eq!(entry["isCustom"], true);
    let skill = manager.get_all_skills().unwrap().into_iter().find(|s| s.id == "solution-design").unwrap();
    assert_eq!(skill.content, "EDITED TEXT");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_person_can_add_their_own_skill_and_it_is_written_for_every_tool() {
    let dir = fresh_dir("add");
    let manager = SkillManager::new(dir.clone());
    let added = manager.add_skill(new_skill("my-made-up-skill")).unwrap();
    assert!(added.is_custom);
    assert_eq!(added.license.as_deref(), Some("MIT"));
    let user = dir.join("skills");
    assert!(std::fs::read_to_string(user.join("my-made-up-skill").join("SKILL.md")).unwrap().contains("MY OWN METHOD"));
    let entry = read_json(user.join("catalog.json"))[0].clone();
    assert_eq!(entry["category"], "custom");
    assert_eq!(entry["attribution"]["sourceUrl"], "https://example.com/my-skill");
    assert_eq!(entry["attribution"]["verified"], false);
    assert!(manager.get_all_skills().unwrap().iter().any(|s| s.id == "my-made-up-skill"));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn adding_a_skill_refuses_anything_the_catalog_would_not_accept() {
    let dir = fresh_dir("refuse");
    let manager = SkillManager::new(dir.clone());
    let cases: Vec<(&str, NewSkill)> = vec![
        ("existing id", new_skill("solution-design")),
        ("bad id", new_skill("My Skill")),
        ("path id", new_skill("../escape")),
        ("short description", NewSkill { description: "too short".into(), ..new_skill("a-skill") }),
        ("http source", NewSkill { source_url: "http://example.com".into(), ..new_skill("a-skill") }),
        ("no author", NewSkill { author: " ".into(), ..new_skill("a-skill") }),
        ("no license", NewSkill { license: "".into(), ..new_skill("a-skill") }),
        ("no phases", NewSkill { phases: vec![], ..new_skill("a-skill") }),
        ("unknown phase", NewSkill { phases: vec!["made-up-phase".into()], ..new_skill("a-skill") }),
        ("empty text", NewSkill { content: "  ".into(), ..new_skill("a-skill") }),
        ("huge text", NewSkill { content: "x".repeat(200 * 1024), ..new_skill("a-skill") }),
    ];
    for (why, skill) in cases {
        assert!(manager.add_skill(skill).is_err(), "{why} was accepted");
    }
    assert!(!dir.join("skills").join("catalog.json").exists(), "nothing written for refused skills");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn old_custom_skills_and_switches_move_to_the_persons_folder_once() {
    let dir = fresh_dir("migrate");
    let mut old = SkillManager::new(dir.clone()).get_default_skills().into_iter().find(|s| s.id == "solution-design").unwrap();
    old.content = "OLD EDIT".into();
    old.is_custom = true;
    std::fs::write(dir.join("custom_skills.json"), serde_json::to_string(&vec![old]).unwrap()).unwrap();
    std::fs::write(dir.join("skill_states.json"), r#"{"brainstorming":false}"#).unwrap();

    let skills = SkillManager::new(dir.clone()).get_all_skills().unwrap();
    assert_eq!(skills.iter().find(|s| s.id == "solution-design").unwrap().content, "OLD EDIT");
    assert!(!skills.iter().find(|s| s.id == "brainstorming").unwrap().enabled);
    let user = dir.join("skills");
    assert_eq!(std::fs::read_to_string(user.join("solution-design").join("SKILL.md")).unwrap(), "OLD EDIT");
    assert_eq!(read_json(user.join("skills.json"))["skills"]["brainstorming"]["enabled"], false);
    assert!(!dir.join("custom_skills.json").exists() && !dir.join("skill_states.json").exists(), "old files are moved aside");
    let _ = std::fs::remove_dir_all(dir);
}
