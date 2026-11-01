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

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredTool {
    /// For an editor extension: the id of the editor it is installed in.
    pub host_editor: Option<String>,
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
                found.push(DiscoveredTool {
                    id,
                    name,
                    category: ToolCategory::Editor,
                    capability: None,
                    evidence: vec![format!("editor product.json at {}", product_path.display())],
                    install_dir: Some(app.to_string_lossy().into_owned()),
                    mcp_config: None,
                    data_folder: get("dataFolderName"),
                    user_data_name: get("nameShort"),
                    host_editor: None,
                });
            }
        }
    }
    found
}

fn has_mcp_section(value: &serde_json::Value, file_mentions_mcp: bool) -> bool {
    let is_object = |key: &str| value.get(key).map(|v| v.is_object()).unwrap_or(false);
    is_object("mcpServers") || is_object("mcp") || (file_mentions_mcp && is_object("servers"))
}

/// The tool that owns a config file: the nearest folder name that is not generic.
fn owner_of(file: &Path, top: &Path) -> Option<String> {
    let mut dir = file.parent();
    while let Some(d) = dir {
        let name = file_name_lower(d);
        if !generic(&name) && !name.is_empty() {
            let id = slug(&name);
            if !id.is_empty() {
                return Some(id);
            }
        }
        if d == top {
            break;
        }
        dir = d.parent();
    }
    None
}

/// Breadth first: every file at one level is checked before any folder below it, so a tool's
/// own config near the top is found even next to large history folders.
fn scan_for_mcp(top: &Path, budget: &mut usize, found: &mut Vec<DiscoveredTool>) {
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

fn check_config_file(entry: &Path, name: &str, top: &Path, budget: &mut usize, found: &mut Vec<DiscoveredTool>) {
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
    let Some(id) = owner_of(entry, top) else { return };
    found.push(DiscoveredTool {
        name: id.clone(),
        id,
        category: ToolCategory::Unknown,
        capability: Some(3),
        evidence: vec![format!("MCP configuration at {}", entry.display())],
        install_dir: None,
        mcp_config: Some(entry.to_string_lossy().into_owned()),
        data_folder: None,
        ..Default::default()
    });
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
        scan_for_mcp(&top, &mut budget, &mut found);
    }
    found
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
                existing.user_data_name = existing.user_data_name.take().or(tool.user_data_name);
            }
        }
    }
    let mut tools: Vec<DiscoveredTool> = by_id.into_values().collect();
    tools.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    tools
}

/// Every AI coding tool found in `view`, merged and sorted by name.
pub fn discover(view: &SystemView) -> Vec<DiscoveredTool> {
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
    findings.extend(find_mcp_configs(view));
    let mut tools = merge(findings);
    join_install_folders(view, &mut tools);
    tools
}

/// An installed app whose folder name matches a tool found by its configuration is that tool's
/// installation. Other installed apps are not assumed to be AI tools.
fn join_install_folders(view: &SystemView, tools: &mut [DiscoveredTool]) {
    for root in &view.install_roots {
        for app in children(root).into_iter().filter(|p| p.is_dir()) {
            let id = slug(&file_name_lower(&app));
            if let Some(tool) = tools.iter_mut().find(|t| t.id == id && t.install_dir.is_none()) {
                tool.install_dir = Some(app.to_string_lossy().into_owned());
                tool.evidence.push(format!("installed at {}", app.display()));
                if tool.category == ToolCategory::Unknown {
                    tool.category = ToolCategory::DesktopApp;
                }
            }
        }
    }
}

#[tauri::command]
pub fn discover_tools() -> Result<Vec<DiscoveredTool>, String> {
    Ok(discover(&SystemView::from_environment()))
}
