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

// --- Any OpenAI-compatible endpoint (C14, TOOL-6). A made-up server on this machine plays
// the endpoint; nothing here names a real provider or model.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;

/// Serves one HTTP request with `status` and `body`; returns the base URL and the raw request.
fn fake_endpoint(status: u16, body: &'static str) -> (String, mpsc::Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let mut reader = BufReader::new(stream);
        let mut head = String::new();
        let mut length = 0usize;
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                length = v.trim().parse().unwrap();
            }
            head.push_str(&line);
            if line == "\r\n" || line.is_empty() {
                break;
            }
        }
        let mut payload = vec![0u8; length];
        reader.read_exact(&mut payload).unwrap();
        tx.send(head + &String::from_utf8_lossy(&payload)).unwrap();
        let reply = format!(
            "HTTP/1.1 {} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            status,
            body.len(),
            body
        );
        reader.get_mut().write_all(reply.as_bytes()).unwrap();
    });
    (format!("http://127.0.0.1:{}/v1", port), rx)
}

fn compatible(base: &str, key: Option<&str>, model: Option<&str>) -> TeardownRequest {
    TeardownRequest {
        target_product_or_company: "Acme".to_string(),
        analysis_type: "full-teardown".to_string(),
        byok: BYOKConfig {
            compatible_base_url: Some(base.to_string()),
            compatible_api_key: key.map(str::to_string),
            preferred_model: model.map(str::to_string),
            ..BYOKConfig::default()
        },
    }
}

const REPLY: &str = r##"{"object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"# Made-up teardown"},"finish_reason":"stop"}]}"##;

#[test]
fn a_made_up_openai_compatible_endpoint_works() {
    let (base, request) = fake_endpoint(200, REPLY);
    let response = ByokEngine::new().generate_teardown(&compatible(&base, Some("k-123"), Some("nebula-7b"))).unwrap();
    assert_eq!(response.markdown_report, "# Made-up teardown");
    assert_eq!(response.source, "compatible");
    let sent = request.recv().unwrap();
    assert!(sent.starts_with("POST /v1/chat/completions "), "{}", sent);
    assert!(sent.to_ascii_lowercase().contains("authorization: bearer k-123"), "{}", sent);
    assert!(sent.contains(r#""model":"nebula-7b""#), "{}", sent);
    assert!(sent.contains(r#""role":"user""#), "{}", sent);
    assert!(!sent.contains("max_tokens") && !sent.contains("max_completion_tokens"), "no token-limit field: {}", sent);
}

#[test]
fn a_local_endpoint_without_a_key_sends_no_authorization() {
    let (base, request) = fake_endpoint(200, REPLY);
    let with_slash = format!("{}/", base);
    ByokEngine::new().generate_teardown(&compatible(&with_slash, None, Some("m"))).unwrap();
    let sent = request.recv().unwrap();
    assert!(sent.starts_with("POST /v1/chat/completions "), "trailing slash handled: {}", sent);
    assert!(!sent.to_ascii_lowercase().contains("authorization:"), "{}", sent);
}

#[test]
fn an_endpoint_error_names_the_endpoint_and_never_the_key() {
    let (base, _request) = fake_endpoint(401, r#"{"error":{"message":"Incorrect API key provided: secret-key-9"}}"#);
    let err = ByokEngine::new().generate_teardown(&compatible(&base, Some("secret-key-9"), Some("m"))).unwrap_err();
    assert!(err.contains("127.0.0.1") && err.contains("401"), "{}", err);
    assert!(!err.contains("secret-key-9"), "{}", err);
}

#[test]
fn a_null_reply_is_an_error_not_an_empty_report() {
    let (base, _request) =
        fake_endpoint(200, r#"{"choices":[{"index":0,"message":{"role":"assistant","content":null}}]}"#);
    assert!(ByokEngine::new().generate_teardown(&compatible(&base, None, Some("m"))).is_err());
}

#[test]
fn the_model_must_be_chosen_not_assumed() {
    let err = ByokEngine::new().generate_teardown(&compatible("http://127.0.0.1:9/v1", None, None)).unwrap_err();
    assert!(err.to_lowercase().contains("model"), "{}", err);
}

#[test]
fn a_key_is_never_sent_over_plain_http_to_another_machine() {
    let err = ByokEngine::new()
        .generate_teardown(&compatible("http://models.example.test/v1", Some("k"), Some("m")))
        .unwrap_err();
    assert!(err.contains("https"), "{}", err);
}

#[test]
fn unsafe_endpoint_addresses_are_refused() {
    for (bad, refusal) in [
        ("ftp://127.0.0.1/v1", "http:// or https://"),
        ("file:///etc/passwd", "http:// or https://"),
        ("http://user:pass@127.0.0.1/v1", "user name or password"),
        ("not a url", "not a valid URL"),
    ] {
        let err = ByokEngine::new().generate_teardown(&compatible(bad, None, Some("m"))).unwrap_err();
        assert!(err.contains(refusal), "{} -> {}", bad, err);
    }
}
