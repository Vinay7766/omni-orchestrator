use tauri_app_lib::commands::research_engine::{parse_hn_response, ResearchEngine};
use tauri_app_lib::models::{DiscoveredSkill, ResearchQuery};

#[test]
fn test_research_engine_domain_filtering_and_parsing() {
    let engine = ResearchEngine::new();
    
    let query = ResearchQuery {
        domain_or_category: Some("DevOps".to_string()),
        keyword: "ci-cd-pipeline".to_string(),
    };

    let results = engine.search_domain(&query);
    assert!(!results.is_empty(), "Research results should not be empty");

    for result in &results {
        assert!(!result.name.is_empty());
        assert!(!result.author.is_empty());
        assert!(!result.source_url.is_empty());
        assert_eq!(result.domain, "DevOps");
    }
}

#[test]
fn test_research_engine_one_click_import() {
    let temp_dir = std::env::temp_dir().join("agent_orchestrator_research_test");
    let engine = ResearchEngine::with_storage(temp_dir.clone());

    let skill = DiscoveredSkill {
        id: "discovered-k8s-operator".to_string(),
        name: "Kubernetes Operator Skill".to_string(),
        description: "Automated K8s cluster deployments.".to_string(),
        source_url: "https://github.com/kubernetes/skills".to_string(),
        author: "Cloud Native Foundation".to_string(),
        domain: "DevOps".to_string(),
        stars_or_upvotes: Some(1450),
        content: "# Kubernetes Operator Instructions".to_string(),
        imported: false,
    };

    let imported_skill = engine.import_skill_to_library(skill).expect("Failed to import");
    assert!(imported_skill.attribution.verified);
    assert_eq!(imported_skill.id, "discovered-k8s-operator");

    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
fn test_parse_hn_response_maps_hits_and_skips_untitled() {
    let body = r#"{
        "hits": [
            { "objectID": "123", "title": "Show HN: CI/CD agent skills", "url": "https://example.com/ci",
              "author": "pg", "points": 321, "num_comments": 45, "story_text": null },
            { "objectID": "456", "title": "Ask HN: Pipeline tips?", "url": null,
              "author": "dang", "points": null, "num_comments": 3, "story_text": "How do you structure pipelines?" },
            { "objectID": "789", "title": null, "url": null, "author": "x", "points": 1, "num_comments": 0, "story_text": null }
        ]
    }"#;

    let results = parse_hn_response(body, "DevOps").expect("valid HN body should parse");
    assert_eq!(results.len(), 2, "untitled hits must be skipped");

    let first = &results[0];
    assert_eq!(first.id, "hn-123");
    assert_eq!(first.source_url, "https://example.com/ci");
    assert_eq!(first.author, "pg");
    assert_eq!(first.domain, "DevOps");
    assert_eq!(first.stars_or_upvotes, Some(321));

    // Text posts have no external URL — link to the HN discussion instead.
    let second = &results[1];
    assert_eq!(second.source_url, "https://news.ycombinator.com/item?id=456");
    assert!(second.description.starts_with("How do you structure pipelines?"));
}

#[test]
fn test_parse_hn_response_rejects_malformed_body() {
    let err = parse_hn_response("not json", "All").unwrap_err();
    assert!(err.contains("Hacker News"), "Error should name the source, got: {}", err);
}
