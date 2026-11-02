//! E5: the planning workspace writes each phase's document into the user's project. The web view
//! may only write `docs/planning/<name>.md` in a folder that is already an OmniOrchestrator
//! project; these tests are the abuse cases for that boundary.

use std::fs;
use std::path::{Path, PathBuf};

use tauri_app_lib::commands::planning_docs::{read_planning_document, write_planning_document};

/// A fresh folder; `with_project` adds .agents/project.json.
fn folder(name: &str, with_project: bool) -> PathBuf {
    let base = std::env::temp_dir().join(format!("omni-planning-{}-{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&base);
    fs::create_dir_all(base.join(".agents")).unwrap();
    if with_project {
        fs::write(base.join(".agents").join("project.json"), "{}").unwrap();
    }
    base
}

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

#[test]
fn writes_and_reads_a_planning_document() {
    let root = folder("roundtrip", true);
    write_planning_document(s(&root), "prd.md".into(), "# PRD\n".into()).unwrap();
    assert_eq!(fs::read_to_string(root.join("docs").join("planning").join("prd.md")).unwrap(), "# PRD\n");
    assert_eq!(read_planning_document(s(&root), "prd.md".into()).unwrap(), Some("# PRD\n".to_string()));
}

#[test]
fn a_document_not_written_yet_reads_as_none() {
    let root = folder("missing", true);
    assert_eq!(read_planning_document(s(&root), "research.md".into()).unwrap(), None);
}

#[test]
fn rewriting_a_document_replaces_it() {
    let root = folder("rewrite", true);
    write_planning_document(s(&root), "prd.md".into(), "old".into()).unwrap();
    write_planning_document(s(&root), "prd.md".into(), "new".into()).unwrap();
    assert_eq!(read_planning_document(s(&root), "prd.md".into()).unwrap(), Some("new".to_string()));
}

#[test]
fn a_folder_that_is_not_a_project_is_refused() {
    let root = folder("not-project", false);
    let err = write_planning_document(s(&root), "prd.md".into(), "x".into()).unwrap_err();
    assert!(err.contains("not an OmniOrchestrator project"), "{err}");
    assert!(!root.join("docs").exists());
}

#[test]
fn names_that_leave_the_planning_folder_are_refused() {
    let root = folder("names", true);
    for name in ["../escape.md", "..\\escape.md", "sub/prd.md", "C:\\x.md", "/etc/x.md", "prd.txt", "prd", ".md", "PRD.md", "a b.md", ""] {
        assert!(write_planning_document(s(&root), name.into(), "x".into()).is_err(), "accepted {name:?}");
        assert!(read_planning_document(s(&root), name.into()).is_err(), "read accepted {name:?}");
    }
    assert!(!root.join("escape.md").exists());
}

#[test]
fn a_relative_project_folder_is_refused() {
    let err = write_planning_document("--version".into(), "prd.md".into(), "x".into()).unwrap_err();
    assert!(err.contains("absolute"), "{err}");
}

#[test]
fn an_oversized_document_is_refused() {
    let root = folder("big", true);
    let err = write_planning_document(s(&root), "prd.md".into(), "x".repeat(2_000_001)).unwrap_err();
    assert!(err.contains("too large"), "{err}");
}

/// A directory junction: Windows lets any user create one (a symlink needs extra rights), and
/// it redirects writes just as a symlink does.
#[cfg(windows)]
fn link_dir(target: &Path, link: &Path) -> bool {
    std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(link)
        .arg(target)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
#[cfg(unix)]
fn link_dir(target: &Path, link: &Path) -> bool {
    std::os::unix::fs::symlink(target, link).is_ok()
}

#[test]
fn a_planning_folder_that_links_elsewhere_is_refused() {
    let root = folder("link", true);
    let outside = folder("link-target", false);
    fs::create_dir_all(root.join("docs")).unwrap();
    assert!(link_dir(&outside, &root.join("docs").join("planning")), "could not create the link");
    let err = write_planning_document(s(&root), "prd.md".into(), "x".into()).unwrap_err();
    assert!(err.contains("link"), "{err}");
    assert!(!outside.join("prd.md").exists());
}
