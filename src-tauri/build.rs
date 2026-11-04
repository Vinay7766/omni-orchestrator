use std::collections::HashSet;
use std::fs;
use std::path::Path;

fn main() {
    bundle_skill_catalog();
    bundle_adapters();
    bundle_mcp_server();
    tauri_build::build()
}

/// Embeds the one-file MCP server (packages/mcp-server/dist/omni-mcp-server.cjs, made by
/// `npm run build`, which `tauri build` runs first) so the installed app can give it to AI tools
/// (retest bug 2). When it has not been built (for example `cargo test` alone), an empty file is
/// embedded and the app falls back to the repository's server.
fn bundle_mcp_server() {
    let bundle = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("packages").join("mcp-server").join("dist").join("omni-mcp-server.cjs");
    println!("cargo:rerun-if-changed={}", bundle.display());
    let text = fs::read_to_string(&bundle).unwrap_or_default();
    let out = Path::new(&std::env::var("OUT_DIR").unwrap()).join("omni-mcp-server.cjs");
    fs::write(&out, text).expect("cannot write the embedded MCP server");
}

/// Copies `packages/core/adapters/*.json` as raw `{ name, text }` entries into OUT_DIR for the
/// launcher (`include_str!`). Adapters are optional (TOOL-5): a missing or empty folder bundles
/// an empty list and the app still builds. Parsing and checks happen in `commands::adapters`,
/// so the bundled and test paths use the same code.
fn bundle_adapters() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("packages").join("core").join("adapters");
    println!("cargo:rerun-if-changed={}", dir.display());
    let mut files: Vec<(String, String)> = match fs::read_dir(&dir) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|x| x == "json"))
            .map(|p| {
                println!("cargo:rerun-if-changed={}", p.display());
                let text = fs::read_to_string(&p).unwrap_or_else(|e| panic!("cannot read {}: {}", p.display(), e));
                (p.file_name().unwrap().to_string_lossy().into_owned(), text)
            })
            .collect(),
        Err(_) => Vec::new(),
    };
    files.sort();
    let list: Vec<serde_json::Value> =
        files.into_iter().map(|(name, text)| serde_json::json!({ "name": name, "text": text })).collect();
    let out = Path::new(&std::env::var("OUT_DIR").unwrap()).join("adapters.json");
    fs::write(&out, serde_json::to_string(&list).unwrap()).expect("cannot write bundled adapters");
}

/// Assembles `/skills/catalog.json` (metadata) and `/skills/<id>/SKILL.md` (content)
/// into one JSON file in OUT_DIR, which the app embeds with `include_str!`.
/// `/skills` stays the single source of truth; nothing generated is committed.
fn bundle_skill_catalog() {
    let skills_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("skills");
    println!("cargo:rerun-if-changed={}", skills_dir.display());

    let catalog_path = skills_dir.join("catalog.json");
    let catalog_text = fs::read_to_string(&catalog_path)
        .unwrap_or_else(|e| panic!("cannot read {}: {}", catalog_path.display(), e));
    let mut entries: Vec<serde_json::Value> =
        serde_json::from_str(&catalog_text).expect("skills/catalog.json is not a valid JSON array");

    let known_phases = load_phase_ids();

    let mut listed = HashSet::new();
    for entry in entries.iter_mut() {
        let id = entry["id"]
            .as_str()
            .expect("every catalog entry needs a string \"id\"")
            .to_string();
        check_phases(&id, &entry["phases"], &known_phases);
        let skill_file = skills_dir.join(&id).join("SKILL.md");
        println!("cargo:rerun-if-changed={}", skill_file.display());
        let content = fs::read_to_string(&skill_file)
            .unwrap_or_else(|_| panic!("catalog lists skill \"{}\" but {} is missing", id, skill_file.display()))
            // Line endings differ by platform checkout; the embedded catalog is always LF.
            .replace("\r\n", "\n");
        entry["content"] = serde_json::Value::String(content);
        listed.insert(id);
    }

    // A SKILL.md folder without a catalog entry would silently never ship.
    let mut unlisted: Vec<String> = fs::read_dir(&skills_dir)
        .expect("cannot list skills directory")
        .filter_map(|e| e.ok())
        .filter(|e| e.path().join("SKILL.md").is_file())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|name| !listed.contains(name))
        .collect();
    unlisted.sort();
    if !unlisted.is_empty() {
        panic!("skills without a catalog.json entry: {}", unlisted.join(", "));
    }

    let out = Path::new(&std::env::var("OUT_DIR").unwrap()).join("skills.json");
    fs::write(&out, serde_json::to_string(&entries).unwrap()).expect("cannot write bundled skills");
}

/// Every phase id across all flows in `/schemas/phases.json`.
fn load_phase_ids() -> HashSet<String> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("schemas").join("phases.json");
    println!("cargo:rerun-if-changed={}", path.display());
    let doc: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {}: {}", path.display(), e)),
    )
    .expect("schemas/phases.json is not valid JSON");
    doc["flows"]
        .as_object()
        .expect("schemas/phases.json needs a \"flows\" object")
        .values()
        .flat_map(|flow| flow.as_array().expect("each flow must be an array of phase ids").iter())
        .map(|p| p.as_str().expect("phase ids must be strings").to_string())
        .collect()
}

/// A skill's phases must be a non-empty list of known phase ids, or exactly ["all"].
fn check_phases(id: &str, phases: &serde_json::Value, known: &HashSet<String>) {
    let list: Vec<&str> = phases
        .as_array()
        .unwrap_or_else(|| panic!("skill \"{}\" needs a \"phases\" array", id))
        .iter()
        .map(|p| p.as_str().unwrap_or_else(|| panic!("skill \"{}\" has a non-string phase", id)))
        .collect();
    if list.is_empty() {
        panic!("skill \"{}\" has an empty \"phases\" list", id);
    }
    if list.contains(&"all") {
        if list.len() > 1 {
            panic!("skill \"{}\": \"all\" cannot be combined with named phases", id);
        }
        return;
    }
    for phase in list {
        if !known.contains(phase) {
            panic!("skill \"{}\" maps to unknown phase \"{}\" (see schemas/phases.json)", id, phase);
        }
    }
}
