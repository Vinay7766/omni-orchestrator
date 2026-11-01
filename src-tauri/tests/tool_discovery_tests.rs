//! Tool discovery by category. Every tool here is made up: discovery must find tools by what
//! they are (an editor's own product.json, an MCP configuration file), never by name.

use std::fs;
use std::path::{Path, PathBuf};

use tauri_app_lib::commands::tool_discovery::{discover, SystemView, ToolCategory};

struct FakeMachine {
    base: PathBuf,
}

impl FakeMachine {
    fn new(name: &str) -> Self {
        let base = std::env::temp_dir().join(format!("omni-discovery-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("programs")).unwrap();
        fs::create_dir_all(base.join("applications")).unwrap();
        fs::create_dir_all(base.join("home")).unwrap();
        FakeMachine { base }
    }
    fn view(&self) -> SystemView {
        SystemView {
            install_roots: vec![self.base.join("programs"), self.base.join("applications"), self.base.join("missing-root")],
            // Only hidden (dot) folders of a home folder are scanned, never Documents etc.
            home_dirs: vec![self.base.join("home")],
            config_roots: vec![],
            path_dirs: vec![],
            installed_apps: vec![],
        }
    }
    fn write(&self, rel: &str, content: &str) {
        let p = self.base.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, content).unwrap();
    }
    /// A VS Code-family editor laid out the Windows/Linux way.
    fn editor(&self, folder: &str, product: &str) {
        self.write(&format!("programs/{}/resources/app/product.json", folder), product);
    }
}

impl Drop for FakeMachine {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}

fn find<'a>(tools: &'a [tauri_app_lib::commands::tool_discovery::DiscoveredTool], id: &str) -> Option<&'a tauri_app_lib::commands::tool_discovery::DiscoveredTool> {
    tools.iter().find(|t| t.id == id)
}

#[test]
fn finds_a_vscode_family_editor_nobody_named_from_its_product_json() {
    let m = FakeMachine::new("editor");
    m.editor("Nebula Editor", r#"{ "nameShort": "Nebula", "nameLong": "Nebula Editor", "applicationName": "nebula", "dataFolderName": ".nebula" }"#);
    let tools = discover(&m.view());
    let nebula = find(&tools, "nebula").expect("editor not discovered");
    assert_eq!(nebula.name, "Nebula Editor");
    assert_eq!(nebula.category, ToolCategory::Editor);
    assert_eq!(nebula.capability, None, "capability is unknown until there is evidence");
    assert!(nebula.evidence.iter().any(|e| e.contains("product.json")));
    assert!(nebula.install_dir.as_deref().unwrap().ends_with("Nebula Editor"));
}

#[test]
fn finds_an_editor_in_a_macos_app_bundle() {
    let m = FakeMachine::new("macos");
    m.write(
        "applications/Quasar.app/Contents/Resources/app/product.json",
        r#"{ "nameLong": "Quasar", "applicationName": "quasar", "dataFolderName": ".quasar" }"#,
    );
    let tools = discover(&m.view());
    assert_eq!(find(&tools, "quasar").map(|t| t.category.clone()), Some(ToolCategory::Editor));
}

#[test]
fn finds_a_tool_by_its_mcp_configuration_and_marks_it_mcp_capable() {
    let m = FakeMachine::new("mcp");
    m.write("home/.zephyr/mcp.json", r#"{ "mcpServers": { "files": { "command": "x" } } }"#);
    let tools = discover(&m.view());
    let zephyr = find(&tools, "zephyr").expect("MCP tool not discovered");
    assert_eq!(zephyr.capability, Some(3));
    assert!(zephyr.mcp_config.as_deref().unwrap().ends_with("mcp.json"));
}

#[test]
fn names_a_tool_after_the_nearest_meaningful_folder() {
    let m = FakeMachine::new("names");
    m.write("home/.vendor/orbit/mcp_config.json", r#"{ "mcpServers": {} }"#);
    m.write("home/.quill/settings/mcp.json", r#"{ "mcpServers": {} }"#);
    m.write("home/.config/lumen/lumen.json", r#"{ "mcp": { "files": { "type": "local" } } }"#);
    let ids: Vec<String> = discover(&m.view()).into_iter().map(|t| t.id).collect();
    assert!(ids.contains(&"orbit".to_string()), "nested folder: {:?}", ids);
    assert!(ids.contains(&"quill".to_string()), "generic 'settings' folder skipped: {:?}", ids);
    assert!(ids.contains(&"lumen".to_string()), "'mcp' key in a tool's own config: {:?}", ids);
    assert!(!ids.contains(&"vendor".to_string()) && !ids.contains(&"settings".to_string()) && !ids.contains(&"config".to_string()));
}

#[test]
fn merges_an_editor_with_its_own_mcp_configuration() {
    let m = FakeMachine::new("merge");
    m.editor("Nebula", r#"{ "nameLong": "Nebula Editor", "applicationName": "nebula", "dataFolderName": ".nebula" }"#);
    m.write("home/.nebula/mcp.json", r#"{ "mcpServers": {} }"#);
    let tools = discover(&m.view());
    let matching: Vec<_> = tools.iter().filter(|t| t.id == "nebula").collect();
    assert_eq!(matching.len(), 1, "one tool, not two");
    assert_eq!(matching[0].category, ToolCategory::Editor);
    assert_eq!(matching[0].capability, Some(3));
    assert!(matching[0].evidence.len() >= 2);
}

#[test]
fn reads_json_with_comments_and_ignores_files_without_mcp() {
    let m = FakeMachine::new("jsonc");
    m.write("home/.comet/settings.jsonc", "{\n  // servers\n  \"mcpServers\": { /* none yet */ }\n}");
    m.write("home/.plain/settings.json", r#"{ "theme": "dark" }"#);
    let ids: Vec<String> = discover(&m.view()).into_iter().map(|t| t.id).collect();
    assert!(ids.contains(&"comet".to_string()));
    assert!(!ids.contains(&"plain".to_string()));
}

#[test]
fn survives_broken_huge_and_cache_files() {
    let m = FakeMachine::new("robust");
    m.write("home/.broken/mcp.json", "{ not json");
    m.write("home/.huge/config.json", &format!(r#"{{ "mcpServers": {{}}, "pad": "{}" }}"#, "x".repeat(300_000)));
    m.write("home/.cache/some-tool/mcp.json", r#"{ "mcpServers": {} }"#);
    m.editor("NoNames", r#"{ "version": "1.0" }"#);
    let ids: Vec<String> = discover(&m.view()).into_iter().map(|t| t.id).collect();
    assert!(!ids.contains(&"huge".to_string()), "files over the size limit are skipped");
    assert!(!ids.contains(&"some-tool".to_string()), "cache folders are skipped");
    assert!(ids.iter().all(|id| !id.is_empty()));
}

#[test]
fn finds_an_editor_installed_in_a_versioned_subfolder() {
    let m = FakeMachine::new("versioned");
    m.write(
        "programs/Prism Code/1a2b3c4d5e/resources/app/product.json",
        r#"{ "nameLong": "Prism Code", "applicationName": "prism", "dataFolderName": ".prism" }"#,
    );
    m.write(
        "programs/Prism Code/9f8e7d6c5b/resources/app/product.json",
        r#"{ "nameLong": "Prism Code", "applicationName": "prism", "dataFolderName": ".prism" }"#,
    );
    let tools = discover(&m.view());
    assert_eq!(tools.iter().filter(|t| t.id == "prism").count(), 1, "several versions are one tool");
}

#[test]
fn finds_a_shallow_config_even_next_to_thousands_of_history_files() {
    let m = FakeMachine::new("budget");
    for i in 0..400 {
        m.write(&format!("home/.vendor/a-history/item-{}/state-{}.json", i, i), r#"{ "x": 1 }"#);
    }
    m.write("home/.vendor/zz-agentx/mcp_config.json", r#"{ "mcpServers": {} }"#);
    let started = std::time::Instant::now();
    let ids: Vec<String> = discover(&m.view()).into_iter().map(|t| t.id).collect();
    assert!(ids.contains(&"zz-agentx".to_string()), "shallow config must be found: {:?}", ids);
    assert!(started.elapsed() < std::time::Duration::from_secs(2), "took {:?}", started.elapsed());
}

#[test]
fn skips_extensions_plugins_skills_and_backups() {
    let m = FakeMachine::new("kinds");
    m.write("home/.someeditor/extensions/acme.helper-1.2.3/mcp.json", r#"{ "servers": {} }"#);
    m.write("home/.agentz/plugins/thing/mcp.json", r#"{ "mcpServers": {} }"#);
    m.write("home/.agentz/skills/notes/mcp.json", r#"{ "mcpServers": {} }"#);
    m.write("home/.vendor/agenty-backup/mcp_config.json", r#"{ "mcpServers": {} }"#);
    m.write("home/.vendor2/mcp-configs/mcp.json", r#"{ "mcpServers": {} }"#);
    let ids: Vec<String> = discover(&m.view()).into_iter().map(|t| t.id).collect();
    for bad in ["acme-helper-1-2-3", "thing", "notes", "agenty-backup", "mcp-configs"] {
        assert!(!ids.contains(&bad.to_string()), "'{}' is not a tool: {:?}", bad, ids);
    }
    assert!(ids.contains(&"vendor2".to_string()), "a folder named like 'mcp-configs' names no tool; its parent does: {:?}", ids);
}

#[test]
fn joins_an_installed_app_folder_to_the_tool_found_by_its_config() {
    let m = FakeMachine::new("join");
    m.write("programs/Stellar/Stellar.exe", "binary");
    m.write("home/.vendor/stellar/mcp_config.json", r#"{ "mcpServers": {} }"#);
    m.write("programs/Unrelated Photo App/app.exe", "binary");
    let tools = discover(&m.view());
    let stellar = tools.iter().find(|t| t.id == "stellar").expect("stellar");
    assert_eq!(stellar.category, ToolCategory::DesktopApp);
    assert!(stellar.install_dir.as_deref().unwrap().ends_with("Stellar"));
    assert!(tools.iter().all(|t| t.id != "unrelated-photo-app"), "other installed apps are not AI tools");
}

#[test]
fn an_empty_file_named_for_mcp_still_shows_the_tool_supports_mcp() {
    let m = FakeMachine::new("empty-mcp");
    m.write("home/.vendor/nova/mcp_config.json", "");
    m.write("home/.vendor/pulsar/mcp.json", "{}");
    m.write("home/.other/settings.json", "{}");
    let tools = discover(&m.view());
    for id in ["nova", "pulsar"] {
        assert_eq!(tools.iter().find(|t| t.id == id).and_then(|t| t.capability), Some(3), "{} should be found", id);
    }
    assert!(tools.iter().all(|t| t.id != "other"), "an empty settings file with no MCP name proves nothing");
}

#[test]
fn skips_hidden_folders_of_a_skipped_kind() {
    let m = FakeMachine::new("hidden-kind");
    m.write("home/.skills/some-pack/mcp.json", r#"{ "mcpServers": {} }"#);
    m.write("home/.plugins/thing/mcp.json", r#"{ "mcpServers": {} }"#);
    let ids: Vec<String> = discover(&m.view()).into_iter().map(|t| t.id).collect();
    assert!(ids.is_empty(), "a hidden skills or plugins store is not a tool: {:?}", ids);
}

#[test]
fn never_scans_ordinary_folders_in_a_home_folder() {
    let m = FakeMachine::new("home-privacy");
    m.write("home/Documents/project-x/mcp.json", r#"{ "mcpServers": {} }"#);
    let ids: Vec<String> = discover(&m.view()).into_iter().map(|t| t.id).collect();
    assert!(!ids.contains(&"project-x".to_string()), "Documents must not be scanned: {:?}", ids);
}

mod extensions {
    use super::*;

    /// A made-up editor "Nebula" (data folder .nebula, user data folder "Nebula") with
    /// extensions installed under home/.nebula/extensions.
    fn nebula(name: &str) -> FakeMachine {
        let m = FakeMachine::new(name);
        m.editor("Nebula", r#"{ "nameShort": "Nebula", "nameLong": "Nebula Editor", "applicationName": "nebula", "dataFolderName": ".nebula" }"#);
        m
    }
    fn extension(m: &FakeMachine, folder: &str, manifest: &str) {
        m.write(&format!("home/.nebula/extensions/{}/package.json", folder), manifest);
    }
    fn view_with_user_data(m: &FakeMachine) -> SystemView {
        let mut view = m.view();
        view.config_roots.push(m.base.join("appdata"));
        view
    }

    #[test]
    fn finds_an_ai_extension_by_what_it_declares() {
        let m = nebula("ext-chat");
        extension(&m, "acme.thinker-1.0.0", r#"{ "publisher": "acme", "name": "thinker", "displayName": "Thinker", "contributes": { "chatParticipants": [ { "id": "thinker" } ] } }"#);
        let tools = discover(&m.view());
        let ext = find(&tools, "acme-thinker").expect("AI extension not discovered");
        assert_eq!(ext.category, ToolCategory::EditorExtension);
        assert_eq!(ext.name, "Thinker");
        assert_eq!(ext.host_editor.as_deref(), Some("nebula"));
    }

    #[test]
    fn finds_an_extension_listed_in_the_ai_category() {
        let m = nebula("ext-category");
        extension(&m, "beta.helper-2.0.0", r#"{ "publisher": "beta", "name": "helper", "displayName": "Helper", "categories": ["Programming Languages", "AI"] }"#);
        assert!(find(&discover(&m.view()), "beta-helper").is_some());
    }

    #[test]
    fn ignores_extensions_that_are_not_ai_tools() {
        let m = nebula("ext-theme");
        extension(&m, "gamma.colors-1.0.0", r#"{ "publisher": "gamma", "name": "colors", "categories": ["Themes"], "contributes": { "themes": [] } }"#);
        assert!(find(&discover(&m.view()), "gamma-colors").is_none());
    }

    #[test]
    fn an_extension_that_only_offers_tools_or_servers_to_ai_is_not_itself_an_ai_tool() {
        let m = nebula("ext-offers-tools");
        extension(&m, "lang.support-3.0.0", r#"{ "publisher": "lang", "name": "support", "categories": ["Programming Languages"], "contributes": { "languageModelTools": [ { "name": "run_tests" } ] } }"#);
        extension(&m, "delta.bridge-1.0.0", r#"{ "publisher": "delta", "name": "bridge", "contributes": { "mcpServerDefinitionProviders": [ { "id": "bridge" } ] } }"#);
        let tools = discover(&m.view());
        assert!(find(&tools, "lang-support").is_none(), "offering tools to AI assistants does not make an extension one");
        assert!(find(&tools, "delta-bridge").is_none(), "providing MCP servers does not make an extension an AI tool");
    }

    #[test]
    fn an_extension_providing_mcp_servers_shows_the_editor_supports_mcp() {
        let m = nebula("ext-mcp-provider");
        extension(&m, "delta.bridge-1.0.0", r#"{ "publisher": "delta", "name": "bridge", "contributes": { "mcpServerDefinitionProviders": [ { "id": "bridge" } ] } }"#);
        let editor = discover(&m.view()).into_iter().find(|t| t.id == "nebula").unwrap();
        assert_eq!(editor.capability, Some(3));
        assert!(editor.evidence.iter().any(|e| e.contains("MCP")));
    }

    #[test]
    fn an_mcp_settings_file_in_the_extensions_storage_makes_it_mcp_capable() {
        let m = nebula("ext-storage");
        extension(&m, "acme.thinker-1.0.0", r#"{ "publisher": "acme", "name": "thinker", "categories": ["AI"] }"#);
        m.write("appdata/Nebula/User/globalStorage/acme.thinker/settings/thinker_mcp_settings.json", r#"{ "mcpServers": {} }"#);
        let ext = discover(&view_with_user_data(&m)).into_iter().find(|t| t.id == "acme-thinker").unwrap();
        assert_eq!(ext.capability, Some(3));
        assert!(ext.mcp_config.as_deref().unwrap().contains("globalStorage"));
    }

    #[test]
    fn resolves_a_localised_display_name() {
        let m = nebula("ext-nls");
        extension(&m, "acme.thinker-1.0.0", r#"{ "publisher": "acme", "name": "thinker", "displayName": "%ext.displayName%", "categories": ["Chat"] }"#);
        m.write("home/.nebula/extensions/acme.thinker-1.0.0/package.nls.json", r#"{ "ext.displayName": "Thinker Assistant" }"#);
        assert_eq!(find(&discover(&m.view()), "acme-thinker").map(|t| t.name.clone()), Some("Thinker Assistant".to_string()));
    }

    #[test]
    fn merges_several_installed_versions_of_one_extension() {
        let m = nebula("ext-versions");
        for v in ["1.0.0", "1.1.0"] {
            extension(&m, &format!("acme.thinker-{}", v), r#"{ "publisher": "acme", "name": "thinker", "categories": ["AI"] }"#);
        }
        assert_eq!(discover(&m.view()).iter().filter(|t| t.id == "acme-thinker").count(), 1);
    }

    #[test]
    fn reads_large_extension_manifests() {
        let m = nebula("ext-large");
        let padding = "x".repeat(600_000);
        extension(&m, "big.agent-1.0.0", &format!(r#"{{ "publisher": "big", "name": "agent", "categories": ["AI"], "description": "{}" }}"#, padding));
        assert!(find(&discover(&m.view()), "big-agent").is_some(), "real AI extensions can have manifests over 500 KB");
    }
}

#[test]
fn source_code_names_no_tools() {
    let source = fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/commands/tool_discovery.rs")).unwrap().to_lowercase();
    for name in ["antigravity", "cursor", "vscode", "windsurf", "kiro", "claude", "ollama", "opencode", "codex", "copilot"] {
        assert!(!source.contains(name), "tool_discovery.rs mentions the tool name '{}'; discovery must work by category", name);
    }
}

/// Manual check on the real machine: `cargo test --test tool_discovery_tests real_machine -- --ignored --nocapture`.
#[test]
#[ignore]
fn real_machine() {
    let started = std::time::Instant::now();
    let tools = discover(&SystemView::from_environment());
    for t in &tools {
        println!("{:<28} {:<17} capability={:<8} evidence={}", t.id, format!("{:?}", t.category), format!("{:?}", t.capability), t.evidence.len());
    }
    println!("{} tools in {:?}", tools.len(), started.elapsed());
}
