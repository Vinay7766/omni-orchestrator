//! E9: the setup guide's checks (NTU-4). Nothing is installed or opened here.

use std::fs;
use tauri_app_lib::commands::setup_guide::{folder_to_open, parse_git_version};

#[test]
fn reads_the_version_from_git_output() {
    assert_eq!(parse_git_version("git version 2.47.1.windows.1\n").as_deref(), Some("2.47.1.windows.1"));
    assert_eq!(parse_git_version("git version 2.39.5 (Apple Git-154)\n").as_deref(), Some("2.39.5 (Apple Git-154)"));
}

#[test]
fn output_that_is_not_git_is_not_taken_as_git() {
    assert_eq!(parse_git_version(""), None);
    assert_eq!(parse_git_version("'git' is not recognized as an internal or external command"), None);
}

#[test]
fn opens_only_an_existing_folder_given_as_a_full_path() {
    let dir = std::env::temp_dir().join(format!("omni-setup-{}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    assert_eq!(folder_to_open(&dir.to_string_lossy()).unwrap(), dir);

    assert!(folder_to_open("relative/folder").unwrap_err().contains("full folder path"));
    assert!(folder_to_open(&dir.join("missing").to_string_lossy()).unwrap_err().contains("does not exist"));

    // A file is never opened: opening it could run it.
    let file = dir.join("setup.exe");
    fs::write(&file, "x").unwrap();
    assert!(folder_to_open(&file.to_string_lossy()).unwrap_err().contains("not a folder"));
    let _ = fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn a_link_is_not_followed() {
    let dir = std::env::temp_dir().join(format!("omni-setup-link-{}", std::process::id()));
    fs::create_dir_all(dir.join("real")).unwrap();
    let _ = fs::remove_file(dir.join("link"));
    std::os::unix::fs::symlink(dir.join("real"), dir.join("link")).unwrap();
    assert!(folder_to_open(&dir.join("link").to_string_lossy()).unwrap_err().contains("link"));
    let _ = fs::remove_dir_all(&dir);
}
