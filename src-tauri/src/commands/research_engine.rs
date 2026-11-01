use std::path::PathBuf;
use serde::Deserialize;
use crate::models::{DiscoveredSkill, ResearchQuery, Skill, SkillCategory, AuthorAttribution};
use crate::storage::store::StorageManager;

// ──────────────────────────────────────────────────────────────
// GitHub Search API response shapes
// ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct GitHubRepo {
    full_name: String,
    description: Option<String>,
    html_url: String,
    stargazers_count: u64,
    owner: GitHubOwner,
    #[serde(default)]
    topics: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubOwner {
    login: String,
}

#[derive(Debug, Deserialize)]
struct GitHubSearchResponse {
    items: Vec<GitHubRepo>,
}

// ──────────────────────────────────────────────────────────────
// Reddit RSS response shapes
// ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct RedditPost {
    data: RedditPostData,
}

#[derive(Debug, Deserialize)]
struct RedditPostData {
    title: String,
    url: String,
    author: String,
    ups: u64,
    subreddit: String,
    selftext: String,
    permalink: String,
}

#[derive(Debug, Deserialize)]
struct RedditListing {
    data: RedditListingData,
}

#[derive(Debug, Deserialize)]
struct RedditListingData {
    children: Vec<RedditPost>,
}

// ──────────────────────────────────────────────────────────────
// Hacker News (Algolia) response shapes
// ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct HnSearchResponse {
    hits: Vec<HnHit>,
}

#[derive(Debug, Deserialize)]
struct HnHit {
    #[serde(rename = "objectID")]
    object_id: String,
    title: Option<String>,
    url: Option<String>,
    author: Option<String>,
    points: Option<u64>,
    num_comments: Option<u64>,
    story_text: Option<String>,
}

/// Parses an HN Algolia search body into discovered skills.
/// `domain` is the user's selected filter; the query was scoped to it, so
/// results are tagged with it ("All" maps to "General").
pub fn parse_hn_response(body: &str, domain: &str) -> Result<Vec<DiscoveredSkill>, String> {
    let parsed: HnSearchResponse =
        serde_json::from_str(body).map_err(|e| format!("Hacker News parse error: {}", e))?;

    let tag = if domain.eq_ignore_ascii_case("all") { "General" } else { domain };

    Ok(parsed
        .hits
        .into_iter()
        .filter_map(|hit| {
            let title = hit.title.filter(|t| !t.trim().is_empty())?;
            let author = hit.author.unwrap_or_else(|| "unknown".to_string());
            let discussion = format!("https://news.ycombinator.com/item?id={}", hit.object_id);
            let source_url = hit.url.filter(|u| !u.is_empty()).unwrap_or_else(|| discussion.clone());
            let points = hit.points.unwrap_or(0);
            let comments = hit.num_comments.unwrap_or(0);
            let text = hit.story_text.unwrap_or_default();

            Some(DiscoveredSkill {
                id: format!("hn-{}", hit.object_id),
                name: title.clone(),
                description: if text.is_empty() {
                    format!("Hacker News — {} points, {} comments", points, comments)
                } else {
                    text.chars().take(180).collect::<String>() + "..."
                },
                source_url: source_url.clone(),
                author: author.clone(),
                domain: tag.to_string(),
                stars_or_upvotes: Some(points),
                content: format!(
                    "# {}\n\nPosted by {} on Hacker News\nPoints: {}\nLink: {}\nDiscussion: {}\n\n{}",
                    title, author, points, source_url, discussion, text
                ),
                imported: false,
            })
        })
        .collect())
}

// ──────────────────────────────────────────────────────────────
// ResearchEngine
// ──────────────────────────────────────────────────────────────

#[derive(Clone, Default)]
pub struct ResearchEngine {
    storage: StorageManager,
}

impl ResearchEngine {
    pub fn new() -> Self {
        Self {
            storage: StorageManager::default_system(),
        }
    }

    pub fn with_storage(base_dir: PathBuf) -> Self {
        Self {
            storage: StorageManager::new(base_dir),
        }
    }

    /// Main entry point: tries live sources first, falls back to curated catalog.
    pub fn search_domain(&self, query: &ResearchQuery) -> Vec<DiscoveredSkill> {
        let kw = query.keyword.trim().to_lowercase();
        let domain = query.domain_or_category.as_deref().unwrap_or("All");

        // Build a combined search keyword for GitHub
        let github_kw = if kw.is_empty() {
            format!("agent-skill {}", domain.to_lowercase())
        } else {
            format!("{} agent-skill", kw)
        };

        let mut results: Vec<DiscoveredSkill> = Vec::new();

        // 1. Live GitHub Search API
        if let Ok(github_results) = self.search_github(&github_kw, domain) {
            results.extend(github_results);
        }

        // 2. Live Reddit Search (r/MachineLearning, r/programming, r/devops)
        if let Ok(reddit_results) = self.search_reddit(&kw, domain) {
            results.extend(reddit_results);
        }

        // 3. Live Hacker News (Algolia search API, no auth)
        if let Ok(hn_results) = self.search_hacker_news(&kw, domain) {
            results.extend(hn_results);
        }

        // 4. Always append curated offline catalog filtered by kw/domain
        let catalog = self.curated_catalog();
        let catalog_filtered = self.filter_catalog(catalog, &kw, domain);
        results.extend(catalog_filtered);

        // Live results are tagged from repo topics, so they may belong to a
        // different domain than the one selected — honour the user's filter.
        if !domain.eq_ignore_ascii_case("all") {
            results.retain(|r| r.domain.eq_ignore_ascii_case(domain));
        }

        // Deduplicate by id
        let mut seen = std::collections::HashSet::new();
        results.retain(|r| seen.insert(r.id.clone()));

        results
    }

    // ── Live: GitHub Search API ──────────────────────────────

    fn search_github(&self, keyword: &str, domain: &str) -> Result<Vec<DiscoveredSkill>, String> {
        let encoded = urlencoding_simple(keyword);
        let url = format!(
            "https://api.github.com/search/repositories?q={}&sort=stars&order=desc&per_page=12",
            encoded
        );

        let client = reqwest::blocking::Client::builder()
            .user_agent("OmniOrchestrator/1.0 (github.com/Vinay7766/omni-orchestrator)")
            .timeout(std::time::Duration::from_secs(8))
            .build()
            .map_err(|e| e.to_string())?;

        let resp = client
            .get(&url)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("GitHub API error: {}", resp.status()));
        }

        let parsed: GitHubSearchResponse = resp.json().map_err(|e| e.to_string())?;

        let skills: Vec<DiscoveredSkill> = parsed
            .items
            .into_iter()
            .map(|repo| {
                let inferred_domain = infer_domain_from_topics(&repo.topics, domain);
                DiscoveredSkill {
                    id: format!("gh-{}", repo.full_name.replace('/', "-")),
                    name: repo.full_name.clone(),
                    description: repo
                        .description
                        .unwrap_or_else(|| "No description provided.".to_string()),
                    source_url: repo.html_url.clone(),
                    author: repo.owner.login.clone(),
                    domain: inferred_domain,
                    stars_or_upvotes: Some(repo.stargazers_count),
                    content: format!(
                        "# {}\n\nSource: {}\nAuthor: {}\n\nDiscovered via GitHub Search API.",
                        repo.full_name, repo.html_url, repo.owner.login
                    ),
                    imported: false,
                }
            })
            .collect();

        Ok(skills)
    }

    // ── Live: Hacker News Algolia API ─────────────────────────

    fn search_hacker_news(&self, keyword: &str, domain: &str) -> Result<Vec<DiscoveredSkill>, String> {
        let base_kw = if keyword.is_empty() { "agent skills" } else { keyword };
        // Scope the query to the selected domain so results can be tagged with it.
        let query = if domain.eq_ignore_ascii_case("all") {
            base_kw.to_string()
        } else {
            format!("{} {}", base_kw, domain)
        };
        let url = format!(
            "https://hn.algolia.com/api/v1/search?query={}&tags=story&hitsPerPage=8",
            urlencoding_simple(&query)
        );

        let client = reqwest::blocking::Client::builder()
            .user_agent("OmniOrchestrator/1.0 (+github.com/Vinay7766/omni-orchestrator)")
            .timeout(std::time::Duration::from_secs(6))
            .build()
            .map_err(|e| e.to_string())?;

        let resp = client.get(&url).send().map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("Hacker News API error: {}", resp.status()));
        }
        let body = resp.text().map_err(|e| e.to_string())?;
        parse_hn_response(&body, domain)
    }

    // ── Live: Reddit JSON API ────────────────────────────────

    fn search_reddit(&self, keyword: &str, domain: &str) -> Result<Vec<DiscoveredSkill>, String> {
        // Choose subreddit based on domain
        let subreddits = domain_to_subreddits(domain);
        let mut all: Vec<DiscoveredSkill> = Vec::new();

        let client = reqwest::blocking::Client::builder()
            .user_agent("OmniOrchestrator/1.0 (+github.com/Vinay7766/omni-orchestrator)")
            .timeout(std::time::Duration::from_secs(6))
            .build()
            .map_err(|e| e.to_string())?;

        for subreddit in subreddits.iter().take(2) {
            // Use Reddit's JSON API (no auth required for public subreddits)
            let search_kw = if keyword.is_empty() { "skills agent" } else { keyword };
            let encoded = urlencoding_simple(search_kw);
            let url = format!(
                "https://www.reddit.com/r/{}/search.json?q={}&restrict_sr=1&sort=top&t=year&limit=6",
                subreddit, encoded
            );

            let resp = match client.get(&url).send() {
                Ok(r) => r,
                Err(_) => continue,
            };

            if !resp.status().is_success() {
                continue;
            }

            let parsed: RedditListing = match resp.json() {
                Ok(p) => p,
                Err(_) => continue,
            };

            for post in parsed.data.children {
                let d = post.data;
                let full_url = format!("https://www.reddit.com{}", d.permalink);
                all.push(DiscoveredSkill {
                    id: format!("reddit-{}", urlencoding_simple(&d.title)[..20.min(urlencoding_simple(&d.title).len())].to_string()),
                    name: d.title.clone(),
                    description: if d.selftext.is_empty() {
                        format!("r/{} — {} upvotes", d.subreddit, d.ups)
                    } else {
                        d.selftext.chars().take(180).collect::<String>() + "..."
                    },
                    source_url: full_url,
                    author: d.author.clone(),
                    domain: infer_domain_from_subreddit(&d.subreddit),
                    stars_or_upvotes: Some(d.ups),
                    content: format!(
                        "# {}\n\nPosted by u/{} in r/{}\nUpvotes: {}\n\n{}",
                        d.title, d.author, d.subreddit, d.ups, d.selftext
                    ),
                    imported: false,
                });
            }
        }

        Ok(all)
    }

    // ── Offline curated catalog (expanded to 20+ items) ──────

    fn curated_catalog(&self) -> Vec<DiscoveredSkill> {
        vec![
            // DevOps
            make_skill("curated-playwright", "Playwright E2E Resilience Engineer",
                "Auto-recovering Playwright test suite generator with trace debugging and CI/CD pipeline integration.",
                "https://github.com/microsoft/playwright", "Playwright Community", "DevOps", 67_200),
            make_skill("curated-k8s-operator", "Kubernetes Operator Skill",
                "Automated K8s cluster deployments with GitOps patterns and Helm chart management.",
                "https://github.com/kubernetes/kubernetes", "Cloud Native Foundation", "DevOps", 112_000),
            make_skill("curated-github-actions", "GitHub Actions CI/CD Master",
                "Production-grade GitHub Actions workflows with matrix builds, caching, and artifact publishing.",
                "https://github.com/actions/runner", "GitHub", "DevOps", 4_800),
            make_skill("curated-docker-compose", "Docker Compose Orchestrator",
                "Multi-container application orchestration with health checks, networking, and secrets management.",
                "https://github.com/docker/compose", "Docker", "DevOps", 33_000),
            // Security
            make_skill("curated-owasp-api", "OWASP API Security Auditor",
                "Automated static analysis for JWT flaws, SQLi, CORS misconfigurations, and API Top-10 mitigations.",
                "https://github.com/OWASP/API-Security", "OWASP Foundation", "Security", 5_120),
            make_skill("curated-semgrep", "Semgrep SAST Skill",
                "Semantic code analysis for security vulnerabilities across Python, TypeScript, Go, Java, and Rust.",
                "https://github.com/returntocorp/semgrep", "Semgrep", "Security", 10_400),
            make_skill("curated-snyk", "Snyk Dependency Vulnerability Scanner",
                "Automated dependency vulnerability scanning with CVSS scoring and patch recommendation.",
                "https://github.com/snyk/cli", "Snyk", "Security", 3_200),
            // Frontend
            make_skill("curated-wcag", "WCAG 2.1 AA Accessibility Specialist",
                "Screen reader testing, color contrast verification, keyboard trap elimination, and ARIA live regions.",
                "https://github.com/w3c/wcag", "W3C Accessibility Lead", "Frontend", 4_230),
            make_skill("curated-react-perf", "React Performance Optimizer",
                "Profiling, memoization, code-splitting, lazy loading, and Core Web Vitals optimization for React apps.",
                "https://github.com/facebook/react", "Meta Open Source", "Frontend", 228_000),
            make_skill("curated-tailwind", "Tailwind CSS Design System Architect",
                "Design token system, component library, responsive utilities, and dark mode implementation with Tailwind v4.",
                "https://github.com/tailwindlabs/tailwindcss", "Tailwind Labs", "Frontend", 84_000),
            // Marketing
            make_skill("curated-growth-flywheel", "Growth Loop & Viral Coefficient Architect",
                "Frameworks from top creators to reverse-engineer B2B SaaS onboarding loops and acquisition flywheels.",
                "https://github.com/growth-engineering/playbooks", "Vaibhav Sisinty & Community", "Marketing", 2_940),
            make_skill("curated-cold-email", "Cold Email Sequencing Skill",
                "Personalized cold email system with A/B testing, deliverability optimization, and CRM integration.",
                "https://github.com/postal-server/postal", "Corey Haines", "Marketing", 1_800),
            // Architecture
            make_skill("curated-ddd", "Domain-Driven Design Architect",
                "Strategic DDD patterns: bounded contexts, aggregates, domain events, CQRS, and event sourcing.",
                "https://github.com/ddd-crew/ddd-starter-modelling-process", "DDD Crew", "Architecture", 3_700),
            make_skill("curated-microservices", "Microservices Architecture Skill",
                "Service decomposition, API gateway patterns, distributed tracing, circuit breakers, and saga patterns.",
                "https://github.com/dotnet/eShop", "Microsoft", "Architecture", 6_900),
            // AI Agents
            make_skill("curated-langchain", "LangChain Agent Orchestration Skill",
                "Build production-grade LLM chains, tool-using agents, RAG pipelines, and memory management systems.",
                "https://github.com/langchain-ai/langchain", "LangChain AI", "AI Agents", 95_000),
            make_skill("curated-autogen", "AutoGen Multi-Agent Framework Skill",
                "Orchestrate conversational multi-agent systems with code execution, human-in-the-loop, and group chats.",
                "https://github.com/microsoft/autogen", "Microsoft Research", "AI Agents", 38_000),
            make_skill("curated-crewai", "CrewAI Role-Based Agent Skill",
                "Create specialized AI crews with defined roles, goals, delegation, and collaborative task completion.",
                "https://github.com/joaomdmoura/crewAI", "João Moura", "AI Agents", 25_000),
            make_skill("curated-gemini-api", "Gemini API Integration Skill",
                "Production Gemini 2.5 Flash/Pro integration with streaming, function calling, and multimodal inputs.",
                "https://github.com/google-gemini/cookbook", "Google DeepMind", "AI Agents", 11_000),
            // Mobile
            make_skill("curated-flutter", "Flutter Cross-Platform Mobile Skill",
                "Production Flutter app architecture with BLoC, routing, localization, testing, and CI/CD.",
                "https://github.com/flutter/flutter", "Google", "Mobile", 165_000),
            make_skill("curated-react-native", "React Native Mobile Architecture Skill",
                "React Native performance optimization, native module bridging, and app store deployment workflows.",
                "https://github.com/facebook/react-native", "Meta Open Source", "Mobile", 118_000),
        ]
    }

    fn filter_catalog(
        &self,
        catalog: Vec<DiscoveredSkill>,
        kw: &str,
        domain: &str,
    ) -> Vec<DiscoveredSkill> {
        let domain_is_all = domain.eq_ignore_ascii_case("all") || domain.eq_ignore_ascii_case("General");
        let kw_tokens: Vec<&str> = kw
            .split(|c: char| c.is_whitespace() || c == '-')
            .filter(|s| !s.is_empty())
            .collect();

        catalog
            .into_iter()
            .filter(|item| {
                let domain_match = domain_is_all || item.domain.eq_ignore_ascii_case(domain);
                let kw_match = kw_tokens.is_empty()
                    || kw_tokens.iter().any(|token| {
                        item.name.to_lowercase().contains(token)
                            || item.description.to_lowercase().contains(token)
                            || item.domain.to_lowercase().contains(token)
                    });
                domain_match && kw_match
            })
            .collect()
    }

    pub fn import_skill_to_library(&self, item: DiscoveredSkill) -> Result<Skill, String> {
        let skill = Skill {
            id: item.id,
            name: item.name,
            description: item.description,
            category: match item.domain.to_lowercase().as_str() {
                "devops" => SkillCategory::Engineering,
                "security" => SkillCategory::Security,
                "frontend" => SkillCategory::Engineering,
                "marketing" => SkillCategory::Marketing,
                "architecture" => SkillCategory::Architecture,
                "ai agents" => SkillCategory::Custom,
                "mobile" => SkillCategory::Engineering,
                _ => SkillCategory::Custom,
            },
            attribution: AuthorAttribution {
                name: item.author,
                role: Some(format!("Discovered via {}", item.domain)),
                source_url: item.source_url,
                verified: true,
                avatar_url: None,
            },
            enabled: true,
            content: item.content,
            is_custom: true,
            phase_scope: None,
        };

        self.storage.save_custom_skill(skill.clone())?;
        Ok(skill)
    }
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

fn make_skill(
    id: &str,
    name: &str,
    description: &str,
    url: &str,
    author: &str,
    domain: &str,
    stars: i64,
) -> DiscoveredSkill {
    DiscoveredSkill {
        id: id.to_string(),
        name: name.to_string(),
        description: description.to_string(),
        source_url: url.to_string(),
        author: author.to_string(),
        domain: domain.to_string(),
        stars_or_upvotes: Some(stars as u64),
        content: format!("# {}\n\n{}\n\nSource: {}\nAuthor: {}", name, description, url, author),
        imported: false,
    }
}

fn urlencoding_simple(s: &str) -> String {
    // Percent-encode UTF-8 bytes (not code points) so non-ASCII queries are valid.
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            b' ' => "+".to_string(),
            _ => format!("%{:02X}", b),
        })
        .collect()
}

fn infer_domain_from_topics(topics: &[String], fallback: &str) -> String {
    for t in topics {
        match t.to_lowercase().as_str() {
            "devops" | "ci-cd" | "kubernetes" | "docker" | "github-actions" => return "DevOps".to_string(),
            "security" | "owasp" | "vulnerability" | "pentest" | "sast" => return "Security".to_string(),
            "frontend" | "react" | "vue" | "tailwind" | "css" | "accessibility" | "wcag" => return "Frontend".to_string(),
            "marketing" | "growth" | "seo" | "analytics" => return "Marketing".to_string(),
            "architecture" | "ddd" | "microservices" | "system-design" => return "Architecture".to_string(),
            "ai" | "llm" | "agent" | "langchain" | "openai" | "gemini" | "anthropic" => return "AI Agents".to_string(),
            "mobile" | "flutter" | "react-native" | "android" | "ios" => return "Mobile".to_string(),
            _ => {}
        }
    }
    // Fallback: use the domain filter they selected, or General
    if fallback.eq_ignore_ascii_case("all") || fallback.eq_ignore_ascii_case("General") {
        "General".to_string()
    } else {
        fallback.to_string()
    }
}

fn domain_to_subreddits(domain: &str) -> Vec<&'static str> {
    match domain.to_lowercase().as_str() {
        "devops" => vec!["devops", "kubernetes"],
        "security" => vec!["netsec", "cybersecurity"],
        "frontend" => vec!["webdev", "reactjs"],
        "marketing" => vec!["Entrepreneur", "marketing"],
        "architecture" => vec!["softwarearchitecture", "ExperiencedDevs"],
        "ai agents" => vec!["MachineLearning", "LocalLLaMA"],
        "mobile" => vec!["FlutterDev", "reactnative"],
        _ => vec!["programming", "MachineLearning"],
    }
}

fn infer_domain_from_subreddit(sub: &str) -> String {
    match sub.to_lowercase().as_str() {
        "devops" | "kubernetes" => "DevOps",
        "netsec" | "cybersecurity" => "Security",
        "webdev" | "reactjs" => "Frontend",
        "entrepreneur" | "marketing" => "Marketing",
        "softwarearchitecture" | "experienceddevs" => "Architecture",
        "machinelearning" | "localllama" | "artificial" => "AI Agents",
        "flutterdev" | "reactnative" => "Mobile",
        _ => "General",
    }
    .to_string()
}

// ──────────────────────────────────────────────────────────────
// Tauri commands
// ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn search_research_skills(query: ResearchQuery) -> Result<Vec<DiscoveredSkill>, String> {
    let engine = ResearchEngine::new();
    Ok(engine.search_domain(&query))
}

#[tauri::command]
pub fn import_research_skill(skill: DiscoveredSkill) -> Result<Skill, String> {
    let engine = ResearchEngine::new();
    engine.import_skill_to_library(skill)
}
