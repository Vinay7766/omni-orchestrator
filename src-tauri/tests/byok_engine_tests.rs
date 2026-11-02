use tauri_app_lib::commands::byok_engine::{execute_strategic_teardown, parse_openai_response, ByokEngine, TeardownRequest};
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

/// Serves one request per reply, in order; returns the server's base URL and the raw requests.
fn fake_server(replies: Vec<(u16, &'static str)>) -> (String, mpsc::Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for (status, body) in replies {
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
            let _ = tx.send(head + &String::from_utf8_lossy(&payload));
            let reply = format!(
                "HTTP/1.1 {} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                status,
                body.len(),
                body
            );
            reader.get_mut().write_all(reply.as_bytes()).unwrap();
        }
    });
    (format!("http://127.0.0.1:{}", port), rx)
}

/// A made-up OpenAI-compatible endpoint answering one request; base URL ends in /v1.
fn fake_endpoint(status: u16, body: &'static str) -> (String, mpsc::Receiver<String>) {
    let (base, rx) = fake_server(vec![(status, body)]);
    (format!("{}/v1", base), rx)
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

// --- No built-in model names; models are read from the provider or typed (C14, TOOL-6).

use tauri_app_lib::commands::byok_engine::NativeBases;
use tauri_app_lib::models::ByokProvider;

fn engine_at(base: &str) -> ByokEngine {
    ByokEngine::with_native_bases(NativeBases {
        gemini: format!("{}/gemini", base),
        anthropic: format!("{}/anthropic", base),
        openai: format!("{}/openai", base),
    })
}

fn request_with(byok: BYOKConfig) -> TeardownRequest {
    TeardownRequest { target_product_or_company: "Acme".into(), analysis_type: "full-teardown".into(), byok }
}

#[test]
fn every_provider_needs_a_chosen_model() {
    for byok in [
        BYOKConfig { gemini_api_key: Some("k".into()), ..Default::default() },
        BYOKConfig { anthropic_api_key: Some("k".into()), ..Default::default() },
        BYOKConfig { openai_api_key: Some("k".into()), ..Default::default() },
        BYOKConfig { ollama_endpoint: Some("http://127.0.0.1:9".into()), ..Default::default() },
    ] {
        let err = engine_at("http://127.0.0.1:9").generate_teardown(&request_with(byok)).unwrap_err();
        assert!(err.contains("Choose a model"), "{}", err);
    }
}

#[test]
fn the_selected_provider_is_used_even_when_others_are_configured() {
    let (base, requests) = fake_endpoint(200, REPLY);
    let byok = BYOKConfig {
        anthropic_api_key: Some("k".into()),
        compatible_base_url: Some(base),
        active_provider: Some(ByokProvider::Compatible),
        preferred_model: Some("nebula-7b".into()),
        ..Default::default()
    };
    let response = engine_at("http://127.0.0.1:9").generate_teardown(&request_with(byok)).unwrap();
    assert_eq!(response.source, "compatible");
    assert!(requests.recv().unwrap().contains("nebula-7b"));
}

#[test]
fn a_failing_provider_does_not_pass_its_model_to_another_provider() {
    let (base, requests) = fake_server(vec![(500, r#"{"error":"down"}"#)]);
    let byok = BYOKConfig {
        anthropic_api_key: Some("k".into()),
        openai_api_key: Some("k".into()),
        preferred_model: Some("orbit-large".into()),
        ..Default::default()
    };
    let err = engine_at(&base).generate_teardown(&request_with(byok)).unwrap_err();
    assert!(err.contains("500"), "{}", err);
    let first = requests.recv().unwrap();
    assert!(first.starts_with("POST /anthropic/"), "{}", first);
    assert!(requests.try_recv().is_err(), "no second provider was called");
}

#[test]
fn a_selected_provider_that_is_not_set_up_is_reported() {
    let byok = BYOKConfig { active_provider: Some(ByokProvider::Gemini), preferred_model: Some("m".into()), ..Default::default() };
    let err = engine_at("http://127.0.0.1:9").generate_teardown(&request_with(byok)).unwrap_err();
    assert!(err.contains("Gemini"), "{}", err);
}

#[test]
fn a_model_name_cannot_change_the_gemini_request_path() {
    let byok = BYOKConfig { gemini_api_key: Some("k".into()), preferred_model: Some("../files?x=1".into()), ..Default::default() };
    let err = engine_at("http://127.0.0.1:9").generate_teardown(&request_with(byok)).unwrap_err();
    assert!(err.contains("model name"), "{}", err);
}

#[test]
fn models_are_listed_from_a_made_up_compatible_endpoint() {
    let (base, requests) =
        fake_endpoint(200, r#"{"object":"list","data":[{"id":"nebula-7b","object":"model"},{"id":"nebula-70b","object":"model"}]}"#);
    let byok = BYOKConfig { compatible_base_url: Some(base), compatible_api_key: Some("k".into()), ..Default::default() };
    let models = ByokEngine::new().list_models(&byok, ByokProvider::Compatible).unwrap();
    assert_eq!(models, vec!["nebula-7b", "nebula-70b"]);
    let sent = requests.recv().unwrap();
    assert!(sent.starts_with("GET /v1/models "), "{}", sent);
    assert!(sent.to_ascii_lowercase().contains("authorization: bearer k"), "{}", sent);
}

#[test]
fn local_runner_models_come_from_its_own_list() {
    let (base, requests) = fake_server(vec![(200, r#"{"models":[{"name":"orbit:latest","model":"orbit:latest"}]}"#)]);
    let byok = BYOKConfig { ollama_endpoint: Some(base), ..Default::default() };
    assert_eq!(ByokEngine::new().list_models(&byok, ByokProvider::Ollama).unwrap(), vec!["orbit:latest"]);
    assert!(requests.recv().unwrap().starts_with("GET /api/tags "));
}

#[test]
fn anthropic_models_are_read_across_pages() {
    let (base, requests) = fake_server(vec![
        (200, r#"{"data":[{"type":"model","id":"made-up-a"}],"has_more":true,"first_id":"made-up-a","last_id":"made-up-a"}"#),
        (200, r#"{"data":[{"type":"model","id":"made-up-b"}],"has_more":false,"first_id":"made-up-b","last_id":"made-up-b"}"#),
    ]);
    let byok = BYOKConfig { anthropic_api_key: Some("k".into()), ..Default::default() };
    assert_eq!(engine_at(&base).list_models(&byok, ByokProvider::Claude).unwrap(), vec!["made-up-a", "made-up-b"]);
    assert!(requests.recv().unwrap().starts_with("GET /anthropic/v1/models?"));
    assert!(requests.recv().unwrap().contains("after_id=made-up-a"));
}

#[test]
fn gemini_lists_only_models_that_generate_content_across_pages() {
    let (base, requests) = fake_server(vec![
        (200, r#"{"models":[{"name":"models/made-up-pro","supportedGenerationMethods":["generateContent"]},{"name":"models/made-up-embed","supportedGenerationMethods":["embedContent"]}],"nextPageToken":"p2"}"#),
        (200, r#"{"models":[{"name":"models/made-up-lite","supportedGenerationMethods":["generateContent","countTokens"]}]}"#),
    ]);
    let byok = BYOKConfig { gemini_api_key: Some("k".into()), ..Default::default() };
    assert_eq!(engine_at(&base).list_models(&byok, ByokProvider::Gemini).unwrap(), vec!["made-up-pro", "made-up-lite"]);
    let first = requests.recv().unwrap();
    assert!(first.starts_with("GET /gemini/v1beta/models?"), "{}", first);
    assert!(!first.contains("key=k"), "the key stays out of the URL: {}", first);
    assert!(requests.recv().unwrap().contains("pageToken=p2"));
}

#[test]
fn a_server_that_never_stops_paging_is_cut_off() {
    let page = r#"{"data":[{"type":"model","id":"loop"}],"has_more":true,"last_id":"loop"}"#;
    let (base, _requests) = fake_server(vec![(200, page); 30]);
    let byok = BYOKConfig { anthropic_api_key: Some("k".into()), ..Default::default() };
    let err = engine_at(&base).list_models(&byok, ByokProvider::Claude).unwrap_err();
    assert!(err.contains("pages"), "{}", err);
}

#[test]
fn a_malformed_model_list_is_an_error() {
    let (base, _requests) = fake_endpoint(200, r#"{"unexpected":true}"#);
    let byok = BYOKConfig { compatible_base_url: Some(base), ..Default::default() };
    assert!(ByokEngine::new().list_models(&byok, ByokProvider::Compatible).is_err());
}

#[test]
fn listing_models_for_a_provider_that_is_not_set_up_is_reported() {
    let err = ByokEngine::new().list_models(&BYOKConfig::default(), ByokProvider::Openai).unwrap_err();
    assert!(err.contains("OpenAI"), "{}", err);
}

#[test]
fn a_model_listed_twice_is_offered_once_in_the_providers_order() {
    let (base, _requests) =
        fake_endpoint(200, r#"{"object":"list","data":[{"id":"zeta"},{"id":"alpha"},{"id":"zeta"},{"id":""}]}"#);
    let byok = BYOKConfig { compatible_base_url: Some(base), ..Default::default() };
    assert_eq!(ByokEngine::new().list_models(&byok, ByokProvider::Compatible).unwrap(), vec!["zeta", "alpha"]);
}

// G3: the teardown command must not hold the caller's thread (in the app: the main thread,
// which draws the window) while it waits for the model. Tauri runs non-async commands on the
// main thread: https://v2.tauri.app/develop/calling-rust/#async-commands

/// A made-up OpenAI-compatible endpoint that waits `delay` before answering.
fn slow_endpoint(delay: std::time::Duration) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let mut reader = BufReader::new(stream);
        let mut length = 0usize;
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                length = v.trim().parse().unwrap();
            }
            if line == "\r\n" || line.is_empty() {
                break;
            }
        }
        let mut payload = vec![0u8; length];
        reader.read_exact(&mut payload).unwrap();
        std::thread::sleep(delay);
        let reply = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            REPLY.len(),
            REPLY
        );
        reader.get_mut().write_all(reply.as_bytes()).unwrap();
    });
    format!("http://127.0.0.1:{}/v1", port)
}

#[test]
fn a_slow_model_does_not_hold_the_callers_thread() {
    use std::future::Future;
    use std::task::{Context, Poll, Waker};
    use std::time::{Duration, Instant};

    let base = slow_endpoint(Duration::from_millis(800));
    let mut command = Box::pin(execute_strategic_teardown(compatible(&base, None, Some("made-up-model"))));

    // What the window's thread experiences: one poll of the command.
    let started = Instant::now();
    let first = command.as_mut().poll(&mut Context::from_waker(Waker::noop()));
    let held = started.elapsed();
    println!("the command held the caller's thread for {:?}", held);
    assert!(matches!(first, Poll::Pending), "the command finished synchronously instead of in the background");
    assert!(held < Duration::from_millis(200), "the caller's thread was held for {:?}", held);

    // The work still completes, with the model's answer.
    let response = tauri::async_runtime::block_on(command).expect("teardown succeeds");
    assert_eq!(response.source, "compatible");
}

/// Baseline for G3 (kept as a record, not run by default): how long a direct call holds the
/// caller's thread when the model takes 800 ms.
#[test]
#[ignore]
fn baseline_blocking_call_duration() {
    use std::time::{Duration, Instant};
    let base = slow_endpoint(Duration::from_millis(800));
    let engine = ByokEngine::new();
    let started = Instant::now();
    let _ = engine.generate_teardown(&compatible(&base, None, Some("made-up-model")));
    println!("blocking call held the caller for {:?}", started.elapsed());
}

// G4: the Claude calls send API version 2026-10-21. Raw HTTP, so the version is the
// anthropic-version header. On 2026-10-21 temperature / top_p / top_k return a 400, so the
// Claude request must not send them. https://platform.claude.com/docs/en/api/migration-2026-10-21

#[test]
fn the_claude_request_sends_api_version_2026_10_21_and_no_sampling_fields() {
    let (base, requests) = fake_server(vec![(200, r##"{"content":[{"type":"text","text":"# Made-up teardown"}]}"##)]);
    let byok = BYOKConfig {
        anthropic_api_key: Some("k".into()),
        preferred_model: Some("made-up-model".into()),
        active_provider: Some(ByokProvider::Claude),
        ..Default::default()
    };
    let response = engine_at(&base).generate_teardown(&request_with(byok)).expect("teardown succeeds");
    assert_eq!(response.source, "claude");

    let raw = requests.recv().unwrap();
    let lower = raw.to_ascii_lowercase();
    assert!(raw.starts_with("POST /anthropic/v1/messages "), "{raw}");
    assert!(lower.contains("\r\nanthropic-version: 2026-10-21\r\n"), "{raw}");
    let body = &raw[raw.find("\r\n\r\n").unwrap() + 4..];
    for removed in ["temperature", "top_p", "top_k"] {
        assert!(!body.contains(removed), "{removed} sent: {body}");
    }
}

#[test]
fn the_claude_model_list_sends_api_version_2026_10_21() {
    let (base, requests) = fake_server(vec![(200, r#"{"data":[{"type":"model","id":"made-up-a"}],"has_more":false}"#)]);
    let byok = BYOKConfig { anthropic_api_key: Some("k".into()), ..Default::default() };
    engine_at(&base).list_models(&byok, ByokProvider::Claude).unwrap();
    assert!(requests.recv().unwrap().to_ascii_lowercase().contains("\r\nanthropic-version: 2026-10-21\r\n"));
}
