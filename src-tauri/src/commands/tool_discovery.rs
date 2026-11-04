//! Finds AI coding tools by category, never by name (TOOL-0, TOOL-1, TOOL-3, TOOL-4).
//!
//! Detectors look for what a tool *is*, using the tool's own files:
//! - editors built on the shared VS Code-family base: their own resources/app/product.json
//! - tools that use MCP: an MCP configuration file in their config folder
//!
//! Each finding carries evidence and a capability level: 3 when there is MCP evidence,
//! otherwise None ("unknown") for the user to confirm. Nothing is executed; files belonging to
//! other programs are read with size, depth and count limits and parsed tolerantly.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::commands::adapters::{bundled_adapters, Adapter};

const MAX_FILE_BYTES: u64 = 256 * 1024;
/// A tool's own MCP configuration sits at most one folder below its settings folder
/// (~/.tool/mcp.json or ~/.vendor/tool/mcp_config.json). Deeper levels hold history,
/// caches and third-party packages, which are slow to scan and are not tools.
const MAX_DEPTH: usize = 2;
const MAX_FILES_PER_FOLDER: usize = 300;

/// Kinds of folder that hold caches, history, backups or third-party packages, never a tool's
/// own settings. Names of kinds of folder, not of tools.
const SKIP_FOLDERS: &[&str] = &[
    ".cache", "cache", "caches", "cacheddata", "cachedextensionvsixs", "code cache", "gpucache", "node_modules", ".npm",
    ".cargo", ".rustup", ".git", "logs", "tmp", "temp", "crashpad", "blob_storage", "local storage", "session storage",
    "extensions", "plugins", "skills",
];

fn skipped(folder_name: &str) -> bool {
    let name = folder_name.trim_start_matches('.');
    SKIP_FOLDERS.contains(&folder_name) || SKIP_FOLDERS.contains(&name) || name.contains("backup")
}

/// Folder names that group settings without naming the tool that owns them.
const GENERIC_FOLDERS: &[&str] = &["settings", "config", "configs", "user", "data", "profiles", "default", "global"];

fn generic(folder_name: &str) -> bool {
    let name = folder_name.trim_start_matches('.');
    GENERIC_FOLDERS.contains(&name) || name.contains("mcp")
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum ToolCategory {
    Editor,
    EditorExtension,
    CommandLine,
    DesktopApp,
    /// Recognised from configuration only; the kind of tool is not known yet.
    #[default]
    Unknown,
}

/// A program and its leading arguments; the project folder is added as the last argument.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchCommand {
    pub program: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredTool {
    /// How to start the tool with a project folder, found in its own install; None when it is
    /// not started directly (command-line tools run in a terminal, extensions in their editor).
    pub launch: Option<LaunchCommand>,
    /// For an editor extension: the id of the editor it is installed in.
    pub host_editor: Option<String>,
    /// A command that starts the tool, when one was found on PATH.
    pub executable: Option<String>,
    /// True when the only evidence is the tool's own description of itself (for example
    /// package keywords): shown to the user as "please confirm", never assumed.
    pub needs_confirmation: bool,
    /// An editor's per-user settings folder name (where extension storage lives); internal.
    #[serde(skip)]
    pub user_data_name: Option<String>,
    pub id: String,
    pub name: String,
    pub category: ToolCategory,
    /// 3 = MCP, 2 = reads instruction files, 1 = chat only; None = unknown (user confirms).
    pub capability: Option<u8>,
    /// Why this tool was recognised, in plain words with file locations.
    pub evidence: Vec<String>,
    pub install_dir: Option<String>,
    pub mcp_config: Option<String>,
    pub data_folder: Option<String>,
}

#[derive(Debug, Clone)]
pub struct InstalledApp {
    pub name: String,
    pub location: Option<PathBuf>,
}

/// Where to look. Built from the environment in the app; built from temp folders in tests.
#[derive(Debug, Clone, Default)]
pub struct SystemView {
    /// Folders containing installed applications, one per child folder.
    pub install_roots: Vec<PathBuf>,
    /// Home folders: only their hidden (dot) folders are scanned, never Documents etc.
    pub home_dirs: Vec<PathBuf>,
    /// Folders whose every child is a program's settings folder (~/.config, %APPDATA%).
    pub config_roots: Vec<PathBuf>,
    pub path_dirs: Vec<PathBuf>,
    pub installed_apps: Vec<InstalledApp>,
}

impl SystemView {
    pub fn from_environment() -> Self {
        let env = |key: &str| std::env::var_os(key).map(PathBuf::from);
        let home = env("USERPROFILE").or_else(|| env("HOME"));
        let mut view = SystemView::default();
        if cfg!(windows) {
            view.install_roots.extend(env("LOCALAPPDATA").map(|p| p.join("Programs")));
            view.install_roots.extend(env("ProgramFiles"));
            view.install_roots.extend(env("ProgramFiles(x86)"));
            view.config_roots.extend(env("APPDATA"));
        } else if cfg!(target_os = "macos") {
            view.install_roots.push(PathBuf::from("/Applications"));
            view.install_roots.extend(home.as_ref().map(|h| h.join("Applications")));
            view.config_roots.extend(home.as_ref().map(|h| h.join("Library").join("Application Support")));
        } else {
            view.install_roots.extend(["/usr/share", "/usr/lib", "/opt"].iter().map(PathBuf::from));
            view.install_roots.extend(home.as_ref().map(|h| h.join(".local").join("share")));
        }
        view.config_roots.extend(home.as_ref().map(|h| h.join(".config")));
        view.home_dirs.extend(home);
        if let Some(path) = std::env::var_os("PATH") {
            view.path_dirs = std::env::split_paths(&path).collect();
        }
        view.installed_apps = installed_apps_from_system();
        view
    }
}

/// Lower-case id made of letters, digits and dashes.
fn slug(text: &str) -> String {
    let mut out = String::new();
    for ch in text.trim().trim_start_matches('.').chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_end_matches('-').to_string()
}

fn read_small(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return None;
    }
    fs::read_to_string(path).ok()
}

/// Removes // and /* */ comments and trailing commas outside strings (JSONC, used by many
/// editors' settings), then parses.
fn parse_jsonc(text: &str) -> Option<serde_json::Value> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let (mut i, mut in_string) = (0, false);
    while i < chars.len() {
        let c = chars[i];
        if in_string {
            out.push(c);
            if c == '\\' && i + 1 < chars.len() {
                out.push(chars[i + 1]);
                i += 1;
            } else if c == '"' {
                in_string = false;
            }
        } else if c == '"' {
            in_string = true;
            out.push(c);
        } else if c == '/' && chars.get(i + 1) == Some(&'/') {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        } else if c == '/' && chars.get(i + 1) == Some(&'*') {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i += 2;
            continue;
        } else if c == ',' {
            let next = chars[i + 1..].iter().find(|ch| !ch.is_whitespace());
            if !matches!(next, Some('}') | Some(']')) {
                out.push(c);
            }
        } else {
            out.push(c);
        }
        i += 1;
    }
    serde_json::from_str(&out).ok()
}

fn children(dir: &Path) -> Vec<PathBuf> {
    fs::read_dir(dir).map(|it| it.filter_map(|e| e.ok()).map(|e| e.path()).collect()).unwrap_or_default()
}

fn file_name_lower(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// Editors built on the VS Code-family base, found by their own product.json.
fn find_editors(view: &SystemView) -> Vec<DiscoveredTool> {
    let mut found = Vec::new();
    for root in &view.install_roots {
        for app in children(root) {
            let mut candidates = vec![app.join("resources/app/product.json"), app.join("Contents/Resources/app/product.json")];
            // Some editors keep one versioned subfolder per update.
            candidates.extend(children(&app).into_iter().filter(|p| p.is_dir()).map(|v| v.join("resources/app/product.json")));
            for product_path in candidates.iter() {
                let Some(product) = read_small(product_path).and_then(|t| parse_jsonc(&t)) else { continue };
                let get = |key: &str| product.get(key).and_then(|v| v.as_str()).map(str::to_string);
                let id = get("applicationName").or_else(|| get("dataFolderName")).or_else(|| get("nameShort")).map(|s| slug(&s));
                let name = get("nameLong").or_else(|| get("nameShort"));
                let (Some(id), Some(name)) = (id.filter(|s| !s.is_empty()), name) else { continue };
                let launch = get("applicationName").and_then(|a| editor_launcher(&app, &a));
                found.push(DiscoveredTool {
                    launch,
                    id,
                    name,
                    category: ToolCategory::Editor,
                    capability: None,
                    evidence: vec![format!("editor product.json at {}", product_path.display())],
                    install_dir: Some(app.to_string_lossy().into_owned()),
                    mcp_config: None,
                    data_folder: get("dataFolderName"),
                    user_data_name: get("nameShort"),
                    ..Default::default()
                });
            }
        }
    }
    found
}

/// An editor's own command-line launcher: bin/<applicationName> in its install folder.
fn editor_launcher(app: &Path, application_name: &str) -> Option<LaunchCommand> {
    let file = if cfg!(windows) { format!("{}.cmd", application_name) } else { application_name.to_string() };
    [app.join("bin"), app.join("Contents/Resources/app/bin")]
        .into_iter()
        .map(|dir| dir.join(&file))
        .find(|p| p.is_file())
        .map(|p| LaunchCommand { program: p.to_string_lossy().into_owned(), args: vec![] })
}

/// A desktop app's own program: <Folder>.exe on Windows, the bundle itself on macOS.
fn app_launcher(folder: &Path) -> Option<LaunchCommand> {
    let name = folder.file_name()?.to_string_lossy().into_owned();
    if name.to_lowercase().ends_with(".app") && cfg!(target_os = "macos") {
        return Some(LaunchCommand { program: "open".into(), args: vec!["-a".into(), folder.to_string_lossy().into_owned()] });
    }
    if cfg!(windows) {
        let wanted = format!("{}.exe", name.to_lowercase());
        return children(folder)
            .into_iter()
            .find(|p| p.is_file() && file_name_lower(p) == wanted)
            .map(|p| LaunchCommand { program: p.to_string_lossy().into_owned(), args: vec![] });
    }
    None
}

fn has_mcp_section(value: &serde_json::Value, file_mentions_mcp: bool) -> bool {
    let is_object = |key: &str| value.get(key).map(|v| v.is_object()).unwrap_or(false);
    is_object("mcpServers") || is_object("mcp") || (file_mentions_mcp && is_object("servers"))
}

/// The tool that owns a config file: the nearest folder name that is not generic.
/// The tool a config file belongs to: the nearest folder with a meaningful name. The flag is
/// true when generic folders (config, settings, ...) had to be skipped to find it.
fn owner_of(file: &Path, top: &Path) -> Option<(String, bool)> {
    let mut dir = file.parent();
    let mut skipped_generic = false;
    while let Some(d) = dir {
        let name = file_name_lower(d);
        if !generic(&name) && !name.is_empty() {
            let id = slug(&name);
            if !id.is_empty() {
                return Some((id, skipped_generic));
            }
        }
        skipped_generic = true;
        if d == top {
            break;
        }
        dir = d.parent();
    }
    None
}

/// Breadth first: every file at one level is checked before any folder below it, so a tool's
/// own config near the top is found even next to large history folders.
fn scan_for_mcp(top: &Path, budget: &mut usize, found: &mut Vec<(DiscoveredTool, bool)>) {
    let mut level = vec![top.to_path_buf()];
    for depth in 1..=MAX_DEPTH {
        let mut next = Vec::new();
        for folder in &level {
            for entry in children(folder) {
                if *budget == 0 {
                    return;
                }
                let name = file_name_lower(&entry);
                if entry.is_dir() {
                    if depth < MAX_DEPTH && !skipped(&name) {
                        next.push(entry);
                    }
                } else {
                    check_config_file(&entry, &name, top, budget, found);
                }
            }
        }
        level = next;
    }
}

fn check_config_file(entry: &Path, name: &str, top: &Path, budget: &mut usize, found: &mut Vec<(DiscoveredTool, bool)>) {
    if !(name.ends_with(".json") || name.ends_with(".jsonc")) {
        return;
    }
    *budget -= 1;
    let Some(text) = read_small(entry) else { return };
    let named_for_mcp = name.contains("mcp");
    // A tool creating a file named for MCP in its own folder shows it supports MCP, even
    // before any server is configured (an empty file or {}). Other files need an MCP section.
    let evidence = if named_for_mcp && text.trim().is_empty() {
        true
    } else {
        match parse_jsonc(&text) {
            Some(value) => has_mcp_section(&value, named_for_mcp) || (named_for_mcp && value.as_object().map(|o| o.is_empty()).unwrap_or(false)),
            None => false,
        }
    };
    if !evidence {
        return;
    }
    let Some((id, via_generic)) = owner_of(entry, top) else { return };
    found.push((DiscoveredTool {
        name: id.clone(),
        id,
        category: ToolCategory::Unknown,
        capability: Some(3),
        evidence: vec![format!("MCP configuration at {}", entry.display())],
        install_dir: None,
        mcp_config: Some(entry.to_string_lossy().into_owned()),
        data_folder: None,
        ..Default::default()
    }, via_generic));
}

/// Tools that use MCP, found by their configuration files.
fn find_mcp_configs(view: &SystemView) -> Vec<DiscoveredTool> {
    let mut found = Vec::new();
    let mut tops: Vec<PathBuf> = Vec::new();
    for home in &view.home_dirs {
        tops.extend(children(home).into_iter().filter(|p| p.is_dir() && file_name_lower(p).starts_with('.')));
    }
    for root in &view.config_roots {
        tops.extend(children(root).into_iter().filter(|p| p.is_dir()));
    }
    for top in tops {
        if skipped(&file_name_lower(&top)) {
            continue;
        }
        let mut budget = MAX_FILES_PER_FOLDER;
        let mut here = Vec::new();
        scan_for_mcp(&top, &mut budget, &mut here);
        // A folder that holds several tools' own configs is a vendor folder shared by them: a
        // name found only by skipping generic folders (vendor/config/...) may belong to any of
        // them, so the user confirms it.
        let mut ids: Vec<&str> = here.iter().map(|(t, _)| t.id.as_str()).collect();
        ids.sort_unstable();
        ids.dedup();
        let shared: Vec<String> = ids.iter().map(|s| s.to_string()).collect();
        for (mut tool, via_generic) in here {
            if via_generic && shared.len() > 1 {
                tool.needs_confirmation = true;
                let others: Vec<&str> = shared.iter().map(String::as_str).filter(|id| *id != tool.id).collect();
                tool.evidence.push(format!(
                    "the folder {} also holds settings of {}, so this name is a guess; please confirm",
                    top.display(),
                    others.join(", ")
                ));
            }
            found.push(tool);
        }
    }
    found
}

/// When an adapter names a config file exactly (checked against the tool's own docs), a finding
/// made only from that file belongs to the adapter's tool, whatever folder it sits in.
fn attribute_known_configs(view: &SystemView, adapters: &[Adapter], findings: &mut [DiscoveredTool]) {
    let same = |a: &Path, b: &Path| {
        let (a, b) = (a.to_string_lossy().replace('\\', "/"), b.to_string_lossy().replace('\\', "/"));
        if cfg!(windows) { a.eq_ignore_ascii_case(&b) } else { a == b }
    };
    for tool in findings.iter_mut().filter(|t| t.category == ToolCategory::Unknown) {
        let Some(config) = tool.mcp_config.as_deref().map(PathBuf::from) else { continue };
        let known = adapters.iter().find(|a| {
            a.mcp.as_ref().is_some_and(|m| {
                m.user_config.iter().filter_map(|p| p.strip_prefix("~/")).any(|rel| view.home_dirs.iter().any(|h| same(&h.join(rel), &config)))
            })
        });
        if let Some(adapter) = known {
            tool.id = adapter.matches[0].clone();
            tool.name = adapter.name.clone();
            tool.needs_confirmation = false;
            tool.evidence.retain(|e| !e.ends_with("please confirm"));
        }
    }
}

/// Extension manifests of real AI extensions can exceed 500 KB.
const MAX_MANIFEST_BYTES: u64 = 2 * 1024 * 1024;
const MAX_EXTENSIONS_PER_EDITOR: usize = 500;

/// Manifest entries that mark an extension as an AI assistant itself: it adds a chat
/// participant or provides a language model. Extensions that only offer tools or MCP servers
/// *to* assistants (many language extensions do) are not assistants.
const AI_CONTRIBUTIONS: &[&str] = &["chatParticipants", "languageModelChatProviders"];
/// Marketplace categories that mark an extension as an AI tool.
const AI_CATEGORIES: &[&str] = &["ai", "chat"];

fn read_limited(path: &Path, max: u64) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > max {
        return None;
    }
    fs::read_to_string(path).ok()
}

/// "%key%" display names are looked up in the extension's package.nls.json.
fn display_name(manifest: &serde_json::Value, folder: &Path) -> Option<String> {
    let raw = manifest.get("displayName").and_then(|v| v.as_str())?;
    if raw.len() > 2 && raw.starts_with('%') && raw.ends_with('%') {
        let key = &raw[1..raw.len() - 1];
        return read_small(&folder.join("package.nls.json"))
            .and_then(|t| parse_jsonc(&t))
            .and_then(|nls| nls.get(key).and_then(|v| v.as_str()).map(str::to_string));
    }
    Some(raw.to_string())
}

/// An MCP-named settings file in an extension's own storage folder, if any.
fn extension_mcp_settings(view: &SystemView, user_data_name: &str, storage_id: &str) -> Option<PathBuf> {
    for root in &view.config_roots {
        let storage = root.join(user_data_name).join("User").join("globalStorage").join(storage_id);
        let mut level = vec![storage];
        for depth in 1..=MAX_DEPTH {
            let mut next = Vec::new();
            for folder in &level {
                for entry in children(folder) {
                    let name = file_name_lower(&entry);
                    if entry.is_dir() {
                        if depth < MAX_DEPTH {
                            next.push(entry);
                        }
                    } else if name.contains("mcp") && (name.ends_with(".json") || name.ends_with(".jsonc")) {
                        return Some(entry);
                    }
                }
            }
            level = next;
        }
    }
    None
}

/// AI extensions installed in the editors found so far, and MCP evidence for those editors
/// (an extension that provides MCP servers to its editor shows the editor supports MCP).
fn find_extensions(view: &SystemView, editors: &[DiscoveredTool]) -> (Vec<DiscoveredTool>, Vec<(String, String)>) {
    let mut found = Vec::new();
    let mut editor_mcp = Vec::new();
    for editor in editors {
        let Some(data_folder) = &editor.data_folder else { continue };
        for home in &view.home_dirs {
            let installed = home.join(data_folder).join("extensions");
            for folder in children(&installed).into_iter().filter(|p| p.is_dir()).take(MAX_EXTENSIONS_PER_EDITOR) {
                let manifest_path = folder.join("package.json");
                let Some(manifest) = read_limited(&manifest_path, MAX_MANIFEST_BYTES).and_then(|t| parse_jsonc(&t)) else { continue };
                let get = |key: &str| manifest.get(key).and_then(|v| v.as_str()).map(str::to_string);
                let (Some(publisher), Some(name)) = (get("publisher"), get("name")) else { continue };
                let contributes = manifest.get("contributes");
                let declares = |key: &str| contributes.and_then(|c| c.get(key)).is_some();
                let in_ai_category = manifest
                    .get("categories")
                    .and_then(|c| c.as_array())
                    .map(|cats| cats.iter().filter_map(|c| c.as_str()).any(|c| AI_CATEGORIES.contains(&c.to_lowercase().as_str())))
                    .unwrap_or(false);
                if declares("mcpServerDefinitionProviders") {
                    editor_mcp.push((editor.id.clone(), format!("extension {}.{} provides MCP servers to this editor ({})", publisher, name, manifest_path.display())));
                }
                if !(AI_CONTRIBUTIONS.iter().any(|k| declares(k)) || in_ai_category) {
                    continue;
                }
                let storage_id = format!("{}.{}", publisher, name).to_lowercase();
                let mcp = editor.user_data_name.as_deref().and_then(|u| extension_mcp_settings(view, u, &storage_id));
                let mut evidence = vec![format!("AI extension manifest at {}", manifest_path.display())];
                if let Some(path) = &mcp {
                    evidence.push(format!("MCP settings at {}", path.display()));
                }
                found.push(DiscoveredTool {
                    id: slug(&format!("{}-{}", publisher, name)),
                    name: display_name(&manifest, &folder).unwrap_or_else(|| name.clone()),
                    category: ToolCategory::EditorExtension,
                    capability: mcp.as_ref().map(|_| 3),
                    evidence,
                    install_dir: Some(folder.to_string_lossy().into_owned()),
                    mcp_config: mcp.map(|p| p.to_string_lossy().into_owned()),
                    host_editor: Some(editor.id.clone()),
                    ..Default::default()
                });
            }
        }
    }
    (found, editor_mcp)
}

/// Merges findings that describe the same tool (same id, or an editor's data folder name).
fn merge(findings: Vec<DiscoveredTool>) -> Vec<DiscoveredTool> {
    let mut by_id: BTreeMap<String, DiscoveredTool> = BTreeMap::new();
    let mut aliases: BTreeMap<String, String> = BTreeMap::new();
    for tool in &findings {
        if let Some(folder) = &tool.data_folder {
            aliases.insert(slug(folder), tool.id.clone());
        }
    }
    for tool in findings {
        let key = aliases.get(&tool.id).cloned().unwrap_or_else(|| tool.id.clone());
        match by_id.get_mut(&key) {
            None => {
                by_id.insert(key, tool);
            }
            Some(existing) => {
                if existing.category == ToolCategory::Unknown && tool.category != ToolCategory::Unknown {
                    existing.category = tool.category.clone();
                    existing.name = tool.name.clone();
                }
                existing.capability = existing.capability.max(tool.capability);
                existing.evidence.extend(tool.evidence);
                existing.install_dir = existing.install_dir.take().or(tool.install_dir);
                existing.mcp_config = existing.mcp_config.take().or(tool.mcp_config);
                existing.data_folder = existing.data_folder.take().or(tool.data_folder);
                existing.host_editor = existing.host_editor.take().or(tool.host_editor);
                existing.executable = existing.executable.take().or(tool.executable);
                existing.launch = existing.launch.take().or(tool.launch);
                // Any source with real evidence (a config, a manifest) confirms the tool.
                existing.needs_confirmation = existing.needs_confirmation && tool.needs_confirmation;
                existing.user_data_name = existing.user_data_name.take().or(tool.user_data_name);
            }
        }
    }
    let mut tools: Vec<DiscoveredTool> = by_id.into_values().collect();
    tools.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    tools
}

/// Keywords a package uses to describe itself as an AI tool (self-declared, like extension
/// categories), and keywords that mark it as a server that serves AI tools instead.
const AI_KEYWORDS: &[&str] = &["ai", "agent", "agents", "ai-agent", "coding-agent", "llm", "assistant", "ai-assistant"];
const SERVER_KEYWORDS: &[&str] = &["mcp-server", "mcp-servers"];
const MAX_PACKAGES: usize = 2000;

/// Folders where global packages live next to the commands on PATH (npm prefixes).
fn package_roots(view: &SystemView) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for dir in &view.path_dirs {
        for candidate in [dir.join("node_modules"), dir.join("..").join("lib").join("node_modules")] {
            if candidate.is_dir() && !roots.contains(&candidate) {
                roots.push(candidate);
            }
        }
    }
    roots
}

/// Globally installed packages that provide a command and describe themselves as AI tools.
/// Keywords are a hint, so these are marked needs_confirmation unless other evidence joins.
fn find_global_packages(view: &SystemView) -> Vec<DiscoveredTool> {
    let mut found = Vec::new();
    for root in package_roots(view) {
        let mut folders = Vec::new();
        for entry in children(&root).into_iter().filter(|p| p.is_dir()) {
            if file_name_lower(&entry).starts_with('@') {
                folders.extend(children(&entry).into_iter().filter(|p| p.is_dir()));
            } else {
                folders.push(entry);
            }
        }
        for folder in folders.into_iter().take(MAX_PACKAGES) {
            let manifest_path = folder.join("package.json");
            let Some(manifest) = read_small(&manifest_path).and_then(|t| parse_jsonc(&t)) else { continue };
            let Some(name) = manifest.get("name").and_then(|v| v.as_str()).map(str::to_string) else { continue };
            let commands: Vec<String> = match manifest.get("bin") {
                Some(serde_json::Value::String(_)) => vec![name.rsplit('/').next().unwrap_or(&name).to_string()],
                Some(serde_json::Value::Object(map)) => map.keys().cloned().collect(),
                _ => continue, // provides no command
            };
            if commands.is_empty() {
                continue;
            }
            let keywords: Vec<String> = manifest
                .get("keywords")
                .and_then(|k| k.as_array())
                .map(|k| k.iter().filter_map(|v| v.as_str()).map(|s| s.to_lowercase()).collect())
                .unwrap_or_default();
            if keywords.iter().any(|k| SERVER_KEYWORDS.contains(&k.as_str())) || name.to_lowercase().contains("mcp-server") {
                continue;
            }
            let matched: Vec<&String> = keywords.iter().filter(|k| AI_KEYWORDS.contains(&k.as_str())).collect();
            if matched.is_empty() {
                continue;
            }
            let id = if commands.len() == 1 { slug(&commands[0]) } else { slug(&name) };
            found.push(DiscoveredTool {
                id,
                name: name.clone(),
                category: ToolCategory::CommandLine,
                capability: None,
                needs_confirmation: true,
                evidence: vec![format!(
                    "global package {} provides a command and describes itself as {} ({})",
                    name,
                    matched.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", "),
                    manifest_path.display()
                )],
                install_dir: Some(folder.to_string_lossy().into_owned()),
                ..Default::default()
            });
        }
    }
    found
}

/// A command on PATH named like a discovered tool is that tool's command line.
fn join_executables(view: &SystemView, tools: &mut [DiscoveredTool]) {
    const COMMAND_SUFFIXES: &[&str] = &[".exe", ".cmd", ".bat", ".ps1"];
    let wanted: std::collections::HashSet<String> = tools.iter().map(|t| t.id.clone()).collect();
    for dir in &view.path_dirs {
        // PATH folders such as the system folder hold thousands of files: compare names first
        // and only look at the file itself when the name matches a discovered tool.
        let Ok(entries) = fs::read_dir(dir) else { continue };
        for entry in entries.filter_map(|e| e.ok()) {
            let lower = entry.file_name().to_string_lossy().to_lowercase();
            let base = COMMAND_SUFFIXES.iter().find_map(|s| lower.strip_suffix(s)).unwrap_or(&lower);
            let id = slug(base);
            if !wanted.contains(&id) {
                continue;
            }
            let file = entry.path();
            if !file.is_file() {
                continue;
            }
            if let Some(tool) = tools.iter_mut().find(|t| t.id == id && t.executable.is_none()) {
                tool.executable = Some(file.to_string_lossy().into_owned());
                tool.evidence.push(format!("command on PATH at {}", file.display()));
                if tool.category == ToolCategory::Unknown {
                    tool.category = ToolCategory::CommandLine;
                }
            }
        }
    }
}

/// An app from the system's installed-apps list whose name matches a discovered tool.
fn join_installed_apps(view: &SystemView, tools: &mut [DiscoveredTool]) {
    for app in &view.installed_apps {
        let id = slug(&app.name);
        let compact = id.replace('-', "");
        if let Some(tool) = tools.iter_mut().find(|t| (t.id == id || t.id == compact) && t.install_dir.is_none()) {
            if let Some(location) = &app.location {
                tool.install_dir = Some(location.to_string_lossy().into_owned());
                if tool.launch.is_none() {
                    tool.launch = app_launcher(location);
                }
            }
            tool.evidence.push(format!("listed as an installed app: {}", app.name));
            if tool.category == ToolCategory::Unknown {
                tool.category = ToolCategory::DesktopApp;
            }
        }
    }
}

/// Parses `reg query <Uninstall key> /s` output into installed apps (Windows).
pub fn parse_registry_output(output: &str) -> Vec<InstalledApp> {
    let mut apps = Vec::new();
    let (mut name, mut location): (Option<String>, Option<PathBuf>) = (None, None);
    let flush = |name: &mut Option<String>, location: &mut Option<PathBuf>, apps: &mut Vec<InstalledApp>| {
        if let Some(n) = name.take() {
            apps.push(InstalledApp { name: n, location: location.take() });
        }
        *location = None;
    };
    for line in output.lines() {
        if line.starts_with("HKEY_") {
            flush(&mut name, &mut location, &mut apps);
            continue;
        }
        let mut parts = line.trim().splitn(3, "    ").map(str::trim);
        let (Some(key), Some(kind), Some(value)) = (parts.next(), parts.next(), parts.next()) else { continue };
        if !kind.starts_with("REG_") || value.is_empty() {
            continue;
        }
        match key {
            "DisplayName" => name = Some(value.to_string()),
            "InstallLocation" => location = Some(PathBuf::from(value)),
            _ => {}
        }
    }
    flush(&mut name, &mut location, &mut apps);
    apps
}

/// Parses a freedesktop .desktop entry (Linux) into an installed app, if it is an application.
pub fn parse_desktop_entry(text: &str) -> Option<InstalledApp> {
    let (mut in_entry, mut name, mut exec, mut is_app) = (false, None, None, false);
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') {
            in_entry = line == "[Desktop Entry]";
            continue;
        }
        if !in_entry {
            continue;
        }
        if let Some(v) = line.strip_prefix("Name=") {
            name.get_or_insert_with(|| v.to_string());
        } else if let Some(v) = line.strip_prefix("Exec=") {
            exec = Some(v.to_string());
        } else if line == "Type=Application" {
            is_app = true;
        }
    }
    if !is_app {
        return None;
    }
    let location = exec
        .and_then(|e| e.split_whitespace().next().map(str::to_string))
        // .desktop files are Linux files: "/..." is absolute whatever OS parses them.
        .filter(|p| p.starts_with('/'))
        .map(PathBuf::from)
        .and_then(|p| p.parent().map(Path::to_path_buf));
    Some(InstalledApp { name: name?, location })
}

/// Installed apps from the operating system's own list (best effort; empty if unavailable).
fn installed_apps_from_system() -> Vec<InstalledApp> {
    let mut apps = Vec::new();
    if cfg!(windows) {
        let keys = [
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall",
            r"HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall",
            r"HKLM\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        ];
        // reg.exe is the system's own registry reader; no discovered program is run.
        // The three lists are read in parallel (the system-wide ones take hundreds of ms each).
        let readers: Vec<_> = keys
            .iter()
            .map(|key| {
                let key = key.to_string();
                std::thread::spawn(move || {
                    background_command("reg")
                        .args(["query", &key, "/s"])
                        .output()
                        .map(|out| parse_registry_output(&String::from_utf8_lossy(&out.stdout)))
                        .unwrap_or_default()
                })
            })
            .collect();
        for reader in readers {
            apps.extend(reader.join().unwrap_or_default());
        }
    } else if cfg!(target_os = "linux") {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let mut folders = vec![PathBuf::from("/usr/share/applications")];
        folders.extend(home.map(|h| h.join(".local/share/applications")));
        for folder in folders {
            for file in children(&folder).into_iter().filter(|p| file_name_lower(p).ends_with(".desktop")) {
                apps.extend(read_small(&file).and_then(|t| parse_desktop_entry(&t)));
            }
        }
    }
    apps
}

/// A background helper the app runs and reads (the registry reader, `git --version`): on Windows it
/// gets no console window, so nothing flashes on screen (owner's v0.1 issue A, 2026-11-04).
pub fn background_command(program: &str) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Every AI coding tool found in `view`, merged and sorted by name.
pub fn discover(view: &SystemView) -> Vec<DiscoveredTool> {
    discover_with(view, &bundled_adapters().0)
}

/// Like discover, with the adapters given (none at all is fine: they only add knowledge).
pub fn discover_with(view: &SystemView, adapters: &[Adapter]) -> Vec<DiscoveredTool> {
    let mut editors = find_editors(view);
    let (extensions, editor_mcp) = find_extensions(view, &editors);
    for (editor_id, evidence) in editor_mcp {
        for editor in editors.iter_mut().filter(|e| e.id == editor_id) {
            editor.capability = Some(3);
            if !editor.evidence.contains(&evidence) {
                editor.evidence.push(evidence.clone());
            }
        }
    }
    let mut findings = editors;
    findings.extend(extensions);
    let mut configs = find_mcp_configs(view);
    attribute_known_configs(view, adapters, &mut configs);
    findings.extend(configs);
    findings.extend(find_global_packages(view));
    let mut tools = merge(findings);
    join_install_folders(view, &mut tools);
    join_installed_apps(view, &mut tools);
    join_executables(view, &mut tools);
    tools
}

/// An installed app whose folder name matches a tool found by its configuration is that tool's
/// installation. Other installed apps are not assumed to be AI tools.
fn join_install_folders(view: &SystemView, tools: &mut [DiscoveredTool]) {
    for root in &view.install_roots {
        for app in children(root).into_iter().filter(|p| p.is_dir()) {
            let folder = file_name_lower(&app);
            let id = slug(folder.strip_suffix(".app").unwrap_or(&folder));
            if let Some(tool) = tools.iter_mut().find(|t| t.id == id && t.install_dir.is_none()) {
                tool.install_dir = Some(app.to_string_lossy().into_owned());
                tool.evidence.push(format!("installed at {}", app.display()));
                if tool.launch.is_none() {
                    tool.launch = app_launcher(&app);
                }
                if tool.category == ToolCategory::Unknown {
                    tool.category = ToolCategory::DesktopApp;
                }
            }
        }
    }
}

#[tauri::command]
pub async fn discover_tools() -> Result<Vec<DiscoveredTool>, String> {
    // Off the main thread: the scan reads the disk and the registry, and the window must not freeze.
    tauri::async_runtime::spawn_blocking(|| discover(&SystemView::from_environment())).await.map_err(|e| e.to_string())
}
