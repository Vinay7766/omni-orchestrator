//! The memfs_* commands give the desktop web view file access for project memory only.
//! These tests cover the path policy (the security boundary) and the file semantics that
//! must match the Node adapter in @omni/core.

use std::fs;
use std::path::{Path, PathBuf};

use tauri_app_lib::commands::memory_fs::{
    memfs_append_text, memfs_create_exclusive, memfs_exists, memfs_list, memfs_mkdir, memfs_read_text,
    memfs_remove, memfs_rename, memfs_write_text,
};

/// A fresh project folder with an existing .agents directory.
fn project(name: &str) -> PathBuf {
    let base = std::env::temp_dir().join(format!("omni-memfs-{}-{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&base);
    fs::create_dir_all(base.join("app").join(".agents")).unwrap();
    base
}

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

#[test]
fn allows_reading_and_writing_inside_agents() {
    let base = project("inside");
    let file = base.join("app").join(".agents").join("state.json");
    memfs_write_text(s(&file), "{}".into()).unwrap();
    assert_eq!(memfs_read_text(s(&file)).unwrap(), Some("{}".to_string()));
    memfs_append_text(s(&file), "\n1".into()).unwrap();
    assert_eq!(memfs_read_text(s(&file)).unwrap(), Some("{}\n1".to_string()));
    let _ = fs::remove_dir_all(base);
}

#[test]
fn refuses_writes_outside_an_agents_folder() {
    let base = project("outside");
    let outside = base.join("app").join("src").join("main.rs");
    let err = memfs_write_text(s(&outside), "x".into()).unwrap_err();
    assert!(err.contains(".agents"), "unexpected message: {}", err);
    assert!(!outside.exists());
    assert!(memfs_mkdir(s(&base.join("app").join("src"))).is_err());
    assert!(memfs_remove(s(&base.join("app").join("Cargo.toml"))).is_err());
    assert!(memfs_create_exclusive(s(&base.join("startup.lnk")), "x".into()).is_err());
    let _ = fs::remove_dir_all(base);
}

#[test]
fn refuses_relative_paths_and_parent_steps() {
    let base = project("relative");
    assert!(memfs_write_text(".agents/state.json".into(), "x".into()).is_err());
    let sneaky = format!("{}/app/.agents/../../escape.txt", s(&base));
    assert!(memfs_write_text(sneaky, "x".into()).is_err());
    assert!(!base.join("escape.txt").exists());
    let _ = fs::remove_dir_all(base);
}

#[test]
fn reads_only_memory_files_and_agents_links() {
    let base = project("reads");
    let secret = base.join("app").join("secret.env");
    fs::write(&secret, "TOKEN=x").unwrap();
    assert!(memfs_read_text(s(&secret)).is_err(), "must not read files outside .agents");
    let link = base.join("worktree").join(".agents-link");
    fs::create_dir_all(link.parent().unwrap()).unwrap();
    fs::write(&link, r#"{"formatVersion":1,"projectRoot":"../app"}"#).unwrap();
    assert!(memfs_read_text(s(&link)).unwrap().is_some(), "must read .agents-link files (worktree discovery)");
    let _ = fs::remove_dir_all(base);
}

#[test]
fn exists_works_anywhere_but_reveals_nothing_else() {
    let base = project("exists");
    let file = base.join("app").join("README.md");
    fs::write(&file, "hi").unwrap();
    assert!(memfs_exists(s(&file)).unwrap());
    assert!(!memfs_exists(s(&base.join("app").join("nope.md"))).unwrap());
    assert!(memfs_exists("relative/path".into()).is_err());
    let _ = fs::remove_dir_all(base);
}

#[test]
fn rename_checks_both_ends() {
    let base = project("rename");
    let agents = base.join("app").join(".agents");
    let inside = agents.join("a.json");
    fs::write(&inside, "a").unwrap();
    assert!(memfs_rename(s(&inside), s(&base.join("app").join("stolen.json"))).is_err());
    assert!(inside.exists());
    let target = agents.join("state.json");
    fs::write(&target, "old").unwrap();
    memfs_rename(s(&inside), s(&target)).unwrap();
    assert_eq!(fs::read_to_string(&target).unwrap(), "a");
    let _ = fs::remove_dir_all(base);
}

#[test]
fn file_semantics_match_the_node_adapter() {
    let base = project("semantics");
    let agents = base.join("app").join(".agents");
    assert_eq!(memfs_read_text(s(&agents.join("missing.json"))).unwrap(), None);
    assert!(memfs_create_exclusive(s(&agents.join(".lock")), "a".into()).unwrap());
    assert!(!memfs_create_exclusive(s(&agents.join(".lock")), "b".into()).unwrap());
    memfs_remove(s(&agents.join(".lock"))).unwrap();
    memfs_remove(s(&agents.join(".lock"))).unwrap();
    memfs_mkdir(s(&agents.join("design-notes"))).unwrap();
    let mut names = memfs_list(s(&agents)).unwrap();
    names.sort();
    assert_eq!(names, vec!["design-notes".to_string()]);
    assert_eq!(memfs_list(s(&agents.join("no-such-folder"))).unwrap(), Vec::<String>::new());
    // Creating .agents itself is allowed (first use of a project).
    let fresh = base.join("fresh").join(".agents");
    memfs_mkdir(s(&fresh)).unwrap();
    assert!(fresh.is_dir());
    let _ = fs::remove_dir_all(base);
}

/// Creates a directory link: a symlink, or on Windows without symlink rights a directory
/// junction (no special rights needed, and resolved by canonicalize just like a symlink).
/// Returns false only if neither is possible.
fn symlink_dir(target: &Path, link: &Path) -> bool {
    #[cfg(unix)]
    return std::os::unix::fs::symlink(target, link).is_ok();
    #[cfg(windows)]
    {
        if std::os::windows::fs::symlink_dir(target, link).is_ok() {
            return true;
        }
        return std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false);
    }
}

#[test]
fn refuses_an_agents_folder_that_is_a_symlink_elsewhere() {
    let base = project("symlink-agents");
    let elsewhere = base.join("sensitive");
    fs::create_dir_all(&elsewhere).unwrap();
    let repo = base.join("cloned-repo");
    fs::create_dir_all(&repo).unwrap();
    if !symlink_dir(&elsewhere, &repo.join(".agents")) {
        eprintln!("SKIPPED: cannot create symlinks on this machine (needs Developer Mode on Windows); CI on Linux runs this test");
        let _ = fs::remove_dir_all(base);
        return;
    }
    let err = memfs_write_text(s(&repo.join(".agents").join("planted.txt")), "x".into()).unwrap_err();
    assert!(err.contains("symlink") || err.contains("link"), "unexpected message: {}", err);
    assert!(!elsewhere.join("planted.txt").exists());
    let _ = fs::remove_dir_all(base);
}

#[test]
fn refuses_a_symlink_inside_agents_that_points_elsewhere() {
    let base = project("symlink-inner");
    let elsewhere = base.join("sensitive");
    fs::create_dir_all(&elsewhere).unwrap();
    let agents = base.join("app").join(".agents");
    if !symlink_dir(&elsewhere, &agents.join("design-notes")) {
        eprintln!("SKIPPED: cannot create symlinks on this machine (needs Developer Mode on Windows); CI on Linux runs this test");
        let _ = fs::remove_dir_all(base);
        return;
    }
    assert!(memfs_write_text(s(&agents.join("design-notes").join("x.json")), "x".into()).is_err());
    assert!(!elsewhere.join("x.json").exists());
    let _ = fs::remove_dir_all(base);
}

// E7: the desktop app notices a changed events.jsonl by its size and change time.

#[test]
fn stamp_is_none_for_a_missing_file_and_changes_when_the_file_grows() {
    use tauri_app_lib::commands::memory_fs::memfs_stamp;
    let base = project("stamp");
    let file = base.join("app").join(".agents").join("events.jsonl");
    assert_eq!(memfs_stamp(s(&file)).unwrap(), None);
    memfs_append_text(s(&file), "{}\n".into()).unwrap();
    let first = memfs_stamp(s(&file)).unwrap().expect("a stamp for an existing file");
    assert_eq!(memfs_stamp(s(&file)).unwrap(), Some(first.clone()), "unchanged file, same stamp");
    memfs_append_text(s(&file), "{}\n".into()).unwrap();
    assert_ne!(memfs_stamp(s(&file)).unwrap(), Some(first));
}

#[test]
fn stamp_refuses_paths_outside_agents() {
    use tauri_app_lib::commands::memory_fs::memfs_stamp;
    let base = project("stamp-outside");
    let file = base.join("app").join("secret.txt");
    fs::write(&file, "x").unwrap();
    assert!(memfs_stamp(s(&file)).is_err());
    assert!(memfs_stamp("relative/.agents/events.jsonl".into()).is_err());
}
