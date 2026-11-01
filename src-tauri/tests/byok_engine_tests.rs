use tauri_app_lib::commands::byok_engine::{parse_openai_response, ByokEngine, TeardownRequest};
use tauri_app_lib::models::BYOKConfig;

#[test]
fn test_teardown_without_any_provider_uses_labelled_offline_template() {
    let engine = ByokEngine::new();

    let request = TeardownRequest {
        target_product_or_company: "Notion".to_string(),
        analysis_type: "full-teardown".to_string(),
        byok: BYOKConfig::default(),
    };

    let response = engine
        .generate_teardown(&request)
        .expect("No provider configured should fall back to the offline template");
    assert_eq!(response.source, "offline");
    assert!(response.markdown_report.contains("Executive Teardown"));
    assert!(response.markdown_report.contains("Yan Liu")); // Attribution check
    assert!(response.markdown_report.contains("Corey Haines")); // Attribution check
    assert!(!response.cold_outreach_sequence.is_empty(), "Cold outreach sequence should be populated");
}

#[test]
fn test_teardown_surfaces_error_when_configured_provider_fails() {
    let engine = ByokEngine::new();

    // Nothing listens on the discard port, so the request is refused locally.
    let config = BYOKConfig {
        ollama_endpoint: Some("http://127.0.0.1:9".to_string()),
        preferred_model: Some("llama3.3".to_string()),
        ..BYOKConfig::default()
    };

    let request = TeardownRequest {
        target_product_or_company: "Notion".to_string(),
        analysis_type: "full-teardown".to_string(),
        byok: config,
    };

    let err = engine
        .generate_teardown(&request)
        .expect_err("A configured provider that fails must not silently fall back to the offline template");
    assert!(err.contains("Ollama"), "Error should name the failing provider, got: {}", err);
}

#[test]
fn test_parse_openai_response_extracts_first_choice_content() {
    let body = r##"{
        "id": "chatcmpl-1",
        "choices": [
            { "index": 0, "message": { "role": "assistant", "content": "# Teardown" }, "finish_reason": "stop" }
        ]
    }"##;

    assert_eq!(parse_openai_response(body).unwrap(), "# Teardown");
}

#[test]
fn test_parse_openai_response_rejects_empty_choices() {
    let err = parse_openai_response(r#"{ "choices": [] }"#).unwrap_err();
    assert!(err.contains("OpenAI"), "Error should name the provider, got: {}", err);
}
