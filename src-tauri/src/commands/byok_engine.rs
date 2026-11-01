use serde::{Deserialize, Serialize};
use crate::models::BYOKConfig;

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
    pub source: String, // "gemini" | "claude" | "openai" | "ollama" | "offline"
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

// ── OpenAI API shapes ──────────────────────────────────────────

#[derive(Serialize)]
struct OpenAiRequest {
    model: String,
    messages: Vec<OpenAiMessage>,
    max_completion_tokens: u32,
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

#[derive(Default, Clone)]
pub struct ByokEngine;

impl ByokEngine {
    pub fn new() -> Self {
        Self
    }

    /// Dispatches to the configured live LLM APIs in priority order.
    /// Uses the offline template only when no provider is configured; if every
    /// configured provider fails, their errors are returned instead.
    pub fn generate_teardown(&self, req: &TeardownRequest) -> Result<TeardownResponse, String> {
        let name = &req.target_product_or_company;
        let prompt = build_teardown_prompt(name, &req.analysis_type);
        let mut errors: Vec<String> = Vec::new();

        // Priority: Gemini → Claude → OpenAI → Ollama → Offline
        if let Some(key) = configured(&req.byok.gemini_api_key) {
            match self.call_gemini(key, &prompt, &req.byok) {
                Ok(report) => return Ok(build_response(name, report, "gemini")),
                Err(e) => errors.push(e),
            }
        }

        if let Some(key) = configured(&req.byok.anthropic_api_key) {
            match self.call_claude(key, &prompt, &req.byok) {
                Ok(report) => return Ok(build_response(name, report, "claude")),
                Err(e) => errors.push(e),
            }
        }

        if let Some(key) = configured(&req.byok.openai_api_key) {
            match self.call_openai(key, &prompt, &req.byok) {
                Ok(report) => return Ok(build_response(name, report, "openai")),
                Err(e) => errors.push(e),
            }
        }

        if let Some(endpoint) = configured(&req.byok.ollama_endpoint) {
            match self.call_ollama(endpoint, &prompt, &req.byok) {
                Ok(report) => return Ok(build_response(name, report, "ollama")),
                Err(e) => errors.push(e),
            }
        }

        if !errors.is_empty() {
            return Err(errors.join("\n"));
        }

        // No provider configured — use offline template
        Ok(self.generate_offline_template(req))
    }

    // ── Gemini API ────────────────────────────────────────────

    fn call_gemini(&self, api_key: &str, prompt: &str, config: &BYOKConfig) -> Result<String, String> {
        let model = configured(&config.preferred_model).unwrap_or("gemini-2.0-flash");

        // Key goes in a header, not the query string, so it never appears in request error text.
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
            model
        );

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

        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| e.to_string())?;

        let resp = client
            .post(&url)
            .header("x-goog-api-key", api_key)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .map_err(|e| format!("Gemini request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body_text = resp.text().unwrap_or_default();
            return Err(format!("Gemini API error {}: {}", status, body_text));
        }

        let parsed: GeminiResponse = resp.json().map_err(|e| format!("Gemini parse error: {}", e))?;

        parsed
            .candidates
            .first()
            .and_then(|c| c.content.parts.first())
            .map(|p| p.text.clone())
            .ok_or_else(|| "Gemini returned empty response".to_string())
    }

    // ── Anthropic Claude API ──────────────────────────────────

    fn call_claude(&self, api_key: &str, prompt: &str, config: &BYOKConfig) -> Result<String, String> {
        let model = configured(&config.preferred_model).unwrap_or("claude-3-5-haiku-20241022");

        let body = ClaudeRequest {
            model: model.to_string(),
            max_tokens: 2048,
            messages: vec![ClaudeMessage {
                role: "user".to_string(),
                content: prompt.to_string(),
            }],
        };

        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| e.to_string())?;

        let resp = client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .map_err(|e| format!("Claude request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body_text = resp.text().unwrap_or_default();
            return Err(format!("Claude API error {}: {}", status, body_text));
        }

        let parsed: ClaudeResponse = resp.json().map_err(|e| format!("Claude parse error: {}", e))?;

        parsed
            .content
            .iter()
            .find(|c| c.content_type == "text")
            .map(|c| c.text.clone())
            .ok_or_else(|| "Claude returned empty response".to_string())
    }

    // ── OpenAI API ────────────────────────────────────────────

    fn call_openai(&self, api_key: &str, prompt: &str, config: &BYOKConfig) -> Result<String, String> {
        let model = configured(&config.preferred_model).unwrap_or("gpt-4o-mini");

        let body = OpenAiRequest {
            model: model.to_string(),
            messages: vec![OpenAiMessage {
                role: "user".to_string(),
                content: prompt.to_string(),
            }],
            max_completion_tokens: 2048,
        };

        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| e.to_string())?;

        let resp = client
            .post("https://api.openai.com/v1/chat/completions")
            .bearer_auth(api_key)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .map_err(|e| format!("OpenAI request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body_text = resp.text().unwrap_or_default();
            return Err(format!("OpenAI API error {}: {}", status, body_text));
        }

        let body_text = resp.text().map_err(|e| format!("OpenAI read error: {}", e))?;
        parse_openai_response(&body_text)
    }

    // ── Ollama (local) ────────────────────────────────────────

    fn call_ollama(&self, endpoint: &str, prompt: &str, config: &BYOKConfig) -> Result<String, String> {
        let model = configured(&config.preferred_model).unwrap_or("llama3.2");

        let base = endpoint.trim_end_matches('/');
        let url = format!("{}/api/generate", base);

        let body = OllamaRequest {
            model: model.to_string(),
            prompt: prompt.to_string(),
            stream: false,
        };

        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(120)) // Ollama can be slow
            .build()
            .map_err(|e| e.to_string())?;

        let resp = client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .map_err(|e| format!("Ollama request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            return Err(format!("Ollama error {}", status));
        }

        let parsed: OllamaResponse = resp.json().map_err(|e| format!("Ollama parse error: {}", e))?;
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
> **To get an AI-powered teardown:** Add your Gemini, Claude, or OpenAI API key, or an Ollama endpoint, in the BYOK Settings panel above.

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

/// Extracts the assistant text from an OpenAI Chat Completions response body.
pub fn parse_openai_response(body: &str) -> Result<String, String> {
    let parsed: OpenAiResponse =
        serde_json::from_str(body).map_err(|e| format!("OpenAI parse error: {}", e))?;

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

#[tauri::command]
pub fn execute_strategic_teardown(request: TeardownRequest) -> Result<TeardownResponse, String> {
    let engine = ByokEngine::new();
    engine.generate_teardown(&request)
}
