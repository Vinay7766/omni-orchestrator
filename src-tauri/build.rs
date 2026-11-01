use std::collections::HashSet;
use std::fs;
use std::path::Path;

fn main() {
    bundle_skill_catalog();
    tauri_build::build()
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
