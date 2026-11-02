use serde::{Deserialize, Serialize};
use crate::models::{BYOKConfig, ByokProvider};

// ──────────────────────────────────────────────────────────────
// Request / Response types
// ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeardownRequest {
    pub target_product_or_company: String,
    pub analysis_type: String,
    pub byok: BYOKConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeardownResponse {
    pub target_name: String,
    pub markdown_report: String,
    pub cold_outreach_sequence: String,
    pub strategic_growth_levers: Vec<String>,
    pub author_attributions: Vec<String>,
    pub source: String, // "gemini" | "claude" | "openai" | "compatible" | "ollama" | "offline"
}

// ── Gemini API shapes ──────────────────────────────────────────

#[derive(Serialize)]
struct GeminiRequest {
    contents: Vec<GeminiContent>,
    #[serde(rename = "generationConfig")]
    generation_config: GeminiGenerationConfig,
}

#[derive(Serialize)]
struct GeminiContent {
    role: String,
    parts: Vec<GeminiPart>,
}

#[derive(Serialize)]
struct GeminiPart {
    text: String,
}

#[derive(Serialize)]
struct GeminiGenerationConfig {
    temperature: f32,
    #[serde(rename = "maxOutputTokens")]
    max_output_tokens: u32,
}

#[derive(Deserialize)]
struct GeminiResponse {
    candidates: Vec<GeminiCandidate>,
}

#[derive(Deserialize)]
struct GeminiCandidate {
    content: GeminiResponseContent,
}

#[derive(Deserialize)]
struct GeminiResponseContent {
    parts: Vec<GeminiResponsePart>,
}

#[derive(Deserialize)]
struct GeminiResponsePart {
    text: String,
}

// ── Anthropic Claude API shapes ────────────────────────────────

#[derive(Serialize)]
struct ClaudeRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<ClaudeMessage>,
}

#[derive(Serialize)]
struct ClaudeMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct ClaudeResponse {
    content: Vec<ClaudeContent>,
}

#[derive(Deserialize)]
struct ClaudeContent {
    text: String,
    #[serde(rename = "type")]
    content_type: String,
}

// ── OpenAI-compatible API shapes ───────────────────────────────
// Source: github.com/openai/openai-openapi openapi.yaml (v2.3.0), createChatCompletion:
// required `model` and `messages`; reply text at choices[].message.content (nullable).
// No token-limit field: OpenAI marks `max_tokens` deprecated for `max_completion_tokens`,
// while Ollama's compatible API accepts only `max_tokens` (docs.ollama.com/api/openai-compatibility).

#[derive(Serialize)]
struct OpenAiRequest {
    model: String,
    messages: Vec<OpenAiMessage>,
}

#[derive(Serialize)]
struct OpenAiMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct OpenAiResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    message: OpenAiResponseMessage,
}

#[derive(Deserialize)]
struct OpenAiResponseMessage {
    content: Option<String>,
}

// ── Ollama API shapes ──────────────────────────────────────────

#[derive(Serialize)]
struct OllamaRequest {
    model: String,
    prompt: String,
    stream: bool,
}

#[derive(Deserialize)]
struct OllamaResponse {
    response: String,
}

// ──────────────────────────────────────────────────────────────
// ByokEngine
// ──────────────────────────────────────────────────────────────

/// Where the native provider APIs live. Overridable so tests can point them at a local server.
#[derive(Debug, Clone)]
pub struct NativeBases {
    pub gemini: String,
    pub anthropic: String,
    /// OpenAI is one OpenAI-compatible endpoint; this is its base (".../v1").
    pub openai: String,
}

impl Default for NativeBases {
    fn default() -> Self {
        Self {
            gemini: "https://generativelanguage.googleapis.com".to_string(),
            anthropic: "https://api.anthropic.com".to_string(),
            openai: "https://api.openai.com/v1".to_string(),
        }
    }
}

#[derive(Default, Clone)]
pub struct ByokEngine {
    bases: NativeBases,
}

/// The order used when the user has not selected a provider.
const PROVIDER_ORDER: [ByokProvider; 5] =
    [ByokProvider::Gemini, ByokProvider::Claude, ByokProvider::Openai, ByokProvider::Compatible, ByokProvider::Ollama];

/// A server that keeps saying "more pages" is cut off here.
const MAX_MODEL_PAGES: usize = 20;

fn label(provider: ByokProvider) -> &'static str {
    match provider {
        ByokProvider::Gemini => "Gemini",
        ByokProvider::Claude => "Claude",
        ByokProvider::Openai => "OpenAI",
        ByokProvider::Compatible => "your OpenAI-compatible endpoint",
        ByokProvider::Ollama => "Ollama",
    }
}

/// The key or address that sets a provider up, if the user gave one.
fn credential(byok: &BYOKConfig, provider: ByokProvider) -> Option<&str> {
    match provider {
        ByokProvider::Gemini => configured(&byok.gemini_api_key),
        ByokProvider::Claude => configured(&byok.anthropic_api_key),
        ByokProvider::Openai => configured(&byok.openai_api_key),
        ByokProvider::Compatible => configured(&byok.compatible_base_url),
        ByokProvider::Ollama => configured(&byok.ollama_endpoint),
    }
}

fn require_credential(byok: &BYOKConfig, provider: ByokProvider) -> Result<&str, String> {
    credential(byok, provider).ok_or_else(|| {
        format!("{} is selected but not set up: add its key or address in BYOK settings.", label(provider))
    })
}

fn http_client(timeout_secs: u64) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| e.to_string())
}

/// Sends a request and parses a JSON reply. Error text names `who` and never contains `key`.
fn send_json<T: serde::de::DeserializeOwned>(
    request: reqwest::blocking::RequestBuilder,
    who: &str,
    key: Option<&str>,
) -> Result<T, String> {
    let scrub = |text: String| match key {
        Some(k) if !k.is_empty() => text.replace(k, "[key]"),
        _ => text,
    };
    let resp = request.send().map_err(|e| scrub(format!("{} request failed: {}", who, e)))?;
    let status = resp.status();
    let body = resp.text().map_err(|e| scrub(format!("{} read error: {}", who, e)))?;
    if !status.is_success() {
        return Err(scrub(format!("{} error {}: {}", who, status, body)));
    }
    serde_json::from_str(&body).map_err(|e| scrub(format!("{} returned an unexpected reply: {}", who, e)))
}

/// Keeps the first occurrence of each name, in the provider's order.
fn unique(names: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    names.into_iter().filter(|n| !n.is_empty() && seen.insert(n.clone())).collect()
}

#[derive(Deserialize)]
struct IdItem {
    id: String,
}

#[derive(Deserialize)]
struct OpenAiModelList {
    data: Vec<IdItem>,
}

#[derive(Deserialize)]
struct AnthropicModelPage {
    data: Vec<IdItem>,
    #[serde(default)]
    has_more: bool,
    last_id: Option<String>,
}

#[derive(Deserialize)]
struct GeminiModelPage {
    #[serde(default)]
    models: Vec<GeminiModelItem>,
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Deserialize)]
struct GeminiModelItem {
    name: String,
    #[serde(default, rename = "supportedGenerationMethods")]
    supported_generation_methods: Vec<String>,
}

#[derive(Deserialize)]
struct OllamaTags {
    models: Vec<OllamaTag>,
}

#[derive(Deserialize)]
struct OllamaTag {
    name: String,
}

impl ByokEngine {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_native_bases(bases: NativeBases) -> Self {
        Self { bases }
    }

    /// Calls the selected provider (or the first one set up) with the chosen model. Only that
    /// provider is called. The offline template is used only when nothing is set up.
    pub fn generate_teardown(&self, req: &TeardownRequest) -> Result<TeardownResponse, String> {
        let name = &req.target_product_or_company;
        let byok = &req.byok;
        let provider = match byok.active_provider {
            Some(p) => p,
            None => match PROVIDER_ORDER.into_iter().find(|p| credential(byok, *p).is_some()) {
                Some(p) => p,
                None => return Ok(self.generate_offline_template(req)),
            },
        };
        let credential = require_credential(byok, provider)?;
        let model = configured(&byok.preferred_model).ok_or_else(|| {
            format!(
                "Choose a model for {}: use Load models in BYOK settings, or type the model name.",
                label(provider)
            )
        })?;
        let prompt = build_teardown_prompt(name, &req.analysis_type);
        let (report, source) = match provider {
            ByokProvider::Gemini => (self.call_gemini(credential, model, &prompt)?, "gemini"),
            ByokProvider::Claude => (self.call_claude(credential, model, &prompt)?, "claude"),
            ByokProvider::Openai => (chat_openai_compatible(&self.bases.openai, Some(credential), model, &prompt)?, "openai"),
            ByokProvider::Compatible => {
                let key = configured(&byok.compatible_api_key);
                (chat_openai_compatible(credential, key, model, &prompt)?, "compatible")
            }
            ByokProvider::Ollama => (self.call_ollama(credential, model, &prompt)?, "ollama"),
        };
        Ok(build_response(name, report, source))
    }

    /// The models a provider offers, read from the provider itself (TOOL-6: no model list in
    /// code). The user can always type a model name instead.
    pub fn list_models(&self, byok: &BYOKConfig, provider: ByokProvider) -> Result<Vec<String>, String> {
        let credential = require_credential(byok, provider)?;
        let client = http_client(30)?;
        let names = match provider {
            // Source: openai-openapi v2.3.0 listModels: GET /models -> { object: "list", data: [{ id }] }
            ByokProvider::Openai | ByokProvider::Compatible => {
                let (base, key) = if provider == ByokProvider::Openai {
                    (self.bases.openai.as_str(), Some(credential))
                } else {
                    (credential, configured(&byok.compatible_api_key))
                };
                let url = endpoint_base(base, key.is_some())?;
                let host = url.host_str().unwrap_or("").to_string();
                let mut request = client.get(format!("{}/models", url.as_str().trim_end_matches('/')));
                if let Some(k) = key {
                    request = request.bearer_auth(k);
                }
                let list: OpenAiModelList = send_json(request, &format!("Endpoint {}", host), key)?;
                list.data.into_iter().map(|m| m.id).collect()
            }
            // Source: github.com/ollama/ollama docs/api.md "List Local Models": GET /api/tags -> { models: [{ name }] }
            ByokProvider::Ollama => {
                let url = endpoint_base(credential, false)?;
                let tags: OllamaTags =
                    send_json(client.get(format!("{}/api/tags", url.as_str().trim_end_matches('/'))), "Ollama", None)?;
                tags.models.into_iter().map(|m| m.name).collect()
            }
            // Source: platform.claude.com/docs/en/api/models-list: GET /v1/models, data[].id,
            // has_more + last_id, next page with after_id; limit up to 1000.
            ByokProvider::Claude => {
                let mut names = Vec::new();
                let mut after: Option<String> = None;
                for _ in 0..MAX_MODEL_PAGES {
                    let mut query = vec![("limit", "1000".to_string())];
                    if let Some(a) = &after {
                        query.push(("after_id", a.clone()));
                    }
                    let request = client
                        .get(format!("{}/v1/models", self.bases.anthropic.trim_end_matches('/')))
                        .query(&query)
                        .header("x-api-key", credential)
                        .header("anthropic-version", "2023-06-01");
                    let page: AnthropicModelPage = send_json(request, "Claude", Some(credential))?;
                    names.extend(page.data.into_iter().map(|m| m.id));
                    match (page.has_more, page.last_id) {
                        (true, Some(last)) => after = Some(last),
                        _ => return Ok(unique(names)),
                    }
                }
                return Err(format!("Claude kept returning more pages; stopped after {} pages.", MAX_MODEL_PAGES));
            }
            // Source: ai.google.dev/api/models models.list: GET v1beta/models, models[].name
            // ("models/x"), supportedGenerationMethods, nextPageToken -> pageToken; pageSize up to 1000.
            ByokProvider::Gemini => {
                let mut names = Vec::new();
                let mut token: Option<String> = None;
                for _ in 0..MAX_MODEL_PAGES {
                    let mut query = vec![("pageSize", "1000".to_string())];
                    if let Some(t) = &token {
                        query.push(("pageToken", t.clone()));
                    }
                    // Key in a header (as for generateContent), never in the URL.
                    let request = client
                        .get(format!("{}/v1beta/models", self.bases.gemini.trim_end_matches('/')))
                        .query(&query)
                        .header("x-goog-api-key", credential);
                    let page: GeminiModelPage = send_json(request, "Gemini", Some(credential))?;
                    names.extend(
                        page.models
                            .into_iter()
                            .filter(|m| m.supported_generation_methods.iter().any(|g| g == "generateContent"))
                            .map(|m| m.name.strip_prefix("models/").unwrap_or(&m.name).to_string()),
                    );
                    match page.next_page_token.filter(|t| !t.is_empty()) {
                        Some(t) => token = Some(t),
                        None => return Ok(unique(names)),
                    }
                }
                return Err(format!("Gemini kept returning more pages; stopped after {} pages.", MAX_MODEL_PAGES));
            }
        };
        Ok(unique(names))
    }

    // ── Gemini API ────────────────────────────────────────────

    fn call_gemini(&self, api_key: &str, model: &str, prompt: &str) -> Result<String, String> {
        // The model name goes into the URL path, so it may not carry path or query characters.
        if !model.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_')) || model.starts_with('.') {
            return Err(format!(
                "Gemini model name \"{}\" may contain only letters, digits, '-', '.' and '_'.",
                model
            ));
        }
        // Key goes in a header, not the query string, so it never appears in request error text.
        let url = format!("{}/v1beta/models/{}:generateContent", self.bases.gemini.trim_end_matches('/'), model);

        let body = GeminiRequest {
            contents: vec![GeminiContent {
                role: "user".to_string(),
                parts: vec![GeminiPart { text: prompt.to_string() }],
            }],
            generation_config: GeminiGenerationConfig {
                temperature: 0.7,
                max_output_tokens: 2048,
            },
        };
        let request = http_client(30)?
            .post(&url)
            .header("x-goog-api-key", api_key)
            .header("Content-Type", "application/json")
            .json(&body);
        let parsed: GeminiResponse = send_json(request, "Gemini", Some(api_key))?;
        parsed
            .candidates
            .first()
            .and_then(|c| c.content.parts.first())
            .map(|p| p.text.clone())
            .ok_or_else(|| "Gemini returned empty response".to_string())
    }

    // ── Anthropic Claude API ──────────────────────────────────

    fn call_claude(&self, api_key: &str, model: &str, prompt: &str) -> Result<String, String> {
        let body = ClaudeRequest {
            model: model.to_string(),
            max_tokens: 2048,
            messages: vec![ClaudeMessage {
                role: "user".to_string(),
                content: prompt.to_string(),
            }],
        };
        let request = http_client(30)?
            .post(format!("{}/v1/messages", self.bases.anthropic.trim_end_matches('/')))
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .json(&body);
        let parsed: ClaudeResponse = send_json(request, "Claude", Some(api_key))?;
        parsed
            .content
            .iter()
            .find(|c| c.content_type == "text")
            .map(|c| c.text.clone())
            .ok_or_else(|| "Claude returned empty response".to_string())
    }

    // ── Ollama (local) ────────────────────────────────────────

    fn call_ollama(&self, endpoint: &str, model: &str, prompt: &str) -> Result<String, String> {
        let url = endpoint_base(endpoint, false)?;
        let body = OllamaRequest {
            model: model.to_string(),
            prompt: prompt.to_string(),
            stream: false,
        };
        let request = http_client(120)? // local models can be slow
            .post(format!("{}/api/generate", url.as_str().trim_end_matches('/')))
            .header("Content-Type", "application/json")
            .json(&body);
        let parsed: OllamaResponse = send_json(request, "Ollama", None)?;
        Ok(parsed.response)
    }

    // ── Offline template fallback ─────────────────────────────

    fn generate_offline_template(&self, req: &TeardownRequest) -> TeardownResponse {
        let name = &req.target_product_or_company;

        let report = format!(
            r#"# Executive Teardown & Strategic Flywheel: {}

*Generated offline by Agent Orchestrator Track B (no API key configured)*
*Framework: Yan Liu (Staff Product Strategist) & Corey Haines*

---

## 1. Core Users, JTBD & ICP
- **Primary Audience:** High-velocity tech workers, collaborative cross-functional teams, and solo creators.
- **Core JTBD:** Consolidate fragmented knowledge bases, tasks, and documentation into a singular workspace.

## 2. Core Habit Loops & Information Architecture
- **Trigger:** Internal project kickoff or asynchronous team update.
- **Action:** Open modular document canvas; create dynamic relations.
- **Variable Reward:** Clean, beautifully formatted workspace without context switching.
- **Investment:** Adding persistent databases, internal wikis, and integrations.

## 3. Monetization Engine & Enterprise Friction
- Freemium bottom-up adoption converting into team seats.
- Enterprise tier barriers: HIPAA/SOC2 compliance, SSO, granular permission controls.

## 4. Key Growth Levers & Moat Analysis
- Viral template gallery multiplying inbound user acquisition.
- Network effects through external document sharing.

---
> **To get an AI-powered teardown:** In the BYOK Settings panel above, add a provider key, a local runner, or any OpenAI-compatible endpoint, and choose a model.

*Framework Attributions: Product Teardown by Yan Liu; Strategic Framing by Corey Haines.*
"#,
            name
        );

        let outreach = format!(
            r#"### Subject: Quick observation on {}'s onboarding loop

Hi [First Name],

I spent time analyzing {}'s growth loops and user activation flows.

I noticed a high-leverage opportunity in the transition between template discovery and team workspace onboarding—specifically reducing friction for non-technical members.

I've documented a teardown with 3 concrete architectural adjustments.

Would you be open to a 5-minute video walkthrough?

Best,
[Your Name]
"#,
            name, name
        );

        TeardownResponse {
            target_name: name.clone(),
            markdown_report: report,
            cold_outreach_sequence: outreach,
            strategic_growth_levers: vec![
                "Template ecosystem expansion".to_string(),
                "Frictionless team seat invitations".to_string(),
                "Local-first performance cache".to_string(),
            ],
            author_attributions: vec![
                "Yan Liu (Product Teardown Skill)".to_string(),
                "Corey Haines (Customer Research & Cold Email)".to_string(),
            ],
            source: "offline".to_string(),
        }
    }
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

fn build_teardown_prompt(name: &str, analysis_type: &str) -> String {
    format!(
        r#"You are an expert product strategist performing a deep teardown of "{}".

Analysis type requested: {}

Please provide a comprehensive teardown in Markdown format covering:

1. **Core Users, JTBD & ICP** — Who uses it, what job do they hire it for, who is the ideal customer?
2. **Core Habit Loops** — What triggers daily use? What is the habit loop (Trigger → Action → Reward → Investment)?
3. **Information Architecture** — How is the product organized? What are the key flows?
4. **Monetization Engine** — How does it make money? What are the conversion triggers?
5. **Growth Levers & Moat** — What drives viral/organic growth? What creates defensibility?
6. **3 Strategic Opportunities** — What are the 3 highest-leverage improvements you would recommend?
7. **Cold Outreach Email** — Write a 5-sentence personalized cold email pitching a specific insight.

Be specific, data-driven where possible, and actionable. Use the Yan Liu product teardown framework and Corey Haines strategic growth frameworks.
"#,
        name, analysis_type
    )
}

/// Returns the trimmed value when it is set and non-blank.
fn configured(value: &Option<String>) -> Option<&str> {
    value.as_deref().map(str::trim).filter(|v| !v.is_empty())
}

/// Checks a user-entered endpoint base URL before anything is sent to it. A key may travel over
/// plain http only to this machine; addresses carrying a user name or password are refused.
pub fn endpoint_base(base: &str, has_key: bool) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(base.trim())
        .map_err(|_| format!("Endpoint address \"{}\" is not a valid URL.", base.trim()))?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Endpoint address must start with http:// or https://.".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Endpoint address must not contain a user name or password; put the key in the API key field.".to_string());
    }
    let host = url.host_str().unwrap_or("").trim_matches(|c| c == '[' || c == ']');
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback());
    if has_key && url.scheme() == "http" && !loopback {
        return Err(format!(
            "Endpoint {} uses http, which would send your API key unencrypted; use https for an endpoint on another machine.",
            url.host_str().unwrap_or("")
        ));
    }
    Ok(url)
}

/// One chat completion against an OpenAI-compatible server at `base` (e.g. ".../v1").
fn chat_openai_compatible(base: &str, api_key: Option<&str>, model: &str, prompt: &str) -> Result<String, String> {
    let url = endpoint_base(base, api_key.is_some())?;
    let body = OpenAiRequest {
        model: model.to_string(),
        messages: vec![OpenAiMessage { role: "user".to_string(), content: prompt.to_string() }],
    };
    let mut request = http_client(120)? // local runners can be slow
        .post(format!("{}/chat/completions", url.as_str().trim_end_matches('/')))
        .header("Content-Type", "application/json")
        .json(&body);
    // The key is only ever in a header; send_json also scrubs it from any echoed error text.
    if let Some(key) = api_key {
        request = request.bearer_auth(key);
    }
    let who = format!("Endpoint {}", url.host_str().unwrap_or(""));
    first_choice_text(send_json(request, &who, api_key)?)
}

/// Extracts the assistant text from an OpenAI Chat Completions response body.
pub fn parse_openai_response(body: &str) -> Result<String, String> {
    first_choice_text(serde_json::from_str(body).map_err(|e| format!("OpenAI parse error: {}", e))?)
}

fn first_choice_text(parsed: OpenAiResponse) -> Result<String, String> {
    parsed
        .choices
        .into_iter()
        .next()
        .and_then(|c| c.message.content)
        .filter(|text| !text.is_empty())
        .ok_or_else(|| "OpenAI returned empty response".to_string())
}

fn build_response(name: &str, ai_text: String, source: &str) -> TeardownResponse {
    // Try to extract cold outreach section if the AI included it
    let outreach = if let Some(idx) = ai_text.to_lowercase().find("cold outreach") {
        ai_text[idx..]
            .lines()
            .skip(1)
            .take(10)
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        format!(
            "### Subject: Observations on {}\n\nHi [First Name],\n\nSee the teardown report for my analysis.\n\nBest,\n[Your Name]",
            name
        )
    };

    TeardownResponse {
        target_name: name.to_string(),
        markdown_report: ai_text,
        cold_outreach_sequence: outreach,
        strategic_growth_levers: vec![
            "See full report for AI-generated growth levers".to_string(),
        ],
        author_attributions: vec![
            format!("Generated via {} API", source),
            "Yan Liu (Product Teardown Skill)".to_string(),
            "Corey Haines (Customer Research & Cold Email)".to_string(),
        ],
        source: source.to_string(),
    }
}

// ──────────────────────────────────────────────────────────────
// Tauri command
// ──────────────────────────────────────────────────────────────

/// Lists the models a provider offers. Runs off the main thread: it waits on the network.
#[tauri::command]
pub async fn list_byok_models(byok: BYOKConfig, provider: ByokProvider) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || ByokEngine::new().list_models(&byok, provider))
        .await
        .map_err(|e| e.to_string())?
}

/// Async, so Tauri does not run it on the main thread (which draws the window), and the
/// blocking HTTP call runs on a blocking-task thread, so the window never waits for the model.
/// Non-async commands run on the main thread: https://v2.tauri.app/develop/calling-rust/#async-commands
#[tauri::command]
pub async fn execute_strategic_teardown(request: TeardownRequest) -> Result<TeardownResponse, String> {
    tauri::async_runtime::spawn_blocking(move || ByokEngine::new().generate_teardown(&request))
        .await
        .map_err(|e| e.to_string())?
}
