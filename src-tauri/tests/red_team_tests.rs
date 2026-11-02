//! Red-team tests (security pass dry run, 2026-11-02; report: docs/security/red-team-2026-11-02.md).
//! Each test is an abuse case from docs/threat-model.md and asserts the SAFE outcome. An open
//! finding (the attack works today) is `#[ignore = "RT-n: ..."]` so the suite stays green; run
//! `cargo test --test red_team_tests -- --ignored` to see it fail. No network, no real keys, and
//! no program is ever started: the launcher's spawn step is replaced by a recorder.

use std::cell::RefCell;
use std::fs;
use std::path::PathBuf;
use tauri_app_lib::commands::byok_engine::endpoint_base;
use tauri_app_lib::commands::sync_launcher::{LaunchPayload, SyncLauncher};
use tauri_app_lib::commands::tool_discovery::{DiscoveredTool, LaunchCommand, ToolCategory};

// ── T3.4: a key sent in clear text (endpoint_base) ─────────────────────────────

fn refused(base: &str) -> bool {
    endpoint_base(base, true).is_err()
}

#[test]
fn rt10_t3_4_plain_http_to_another_machine_is_refused_when_a_key_is_sent() {
    for base in [
        "http://example.com/v1",
        "http://192.168.1.20:8080/v1",
        "http://10.0.0.1/v1",
        "http://0.0.0.0:11434",           // not a loopback address
        "http://[::ffff:127.0.0.1]/v1",   // IPv4-mapped: refused, which is the safe side
        "HTTP://EXAMPLE.COM/v1",          // scheme case does not matter
    ] {
        assert!(refused(base), "{} must be refused with a key", base);
    }
}

#[test]
fn rt10_t3_4_lookalike_localhost_hosts_are_refused() {
    for base in [
        "http://localhost.evil.com/v1",
        "http://localhost.evil.com./v1",
        "http://evil.com#@localhost/v1",
        "http://evil.com\\@localhost/v1", // backslash is a path separator in special URLs
        "http://localhost%2eevil.com/v1",
        "http://127.0.0.1.nip.io/v1",
        "http://localhostevil.com/v1",
    ] {
        assert!(refused(base), "{} must be refused with a key", base);
    }
}

#[test]
fn rt10_t3_4_credentials_in_the_url_are_refused() {
    for base in [
        "https://user:secret@api.example.com/v1",
        "https://user@api.example.com/v1",
        "http://localhost:80@evil.com/v1", // looks local, is a user name and password on evil.com
        "https://:secret@api.example.com/v1",
    ] {
        assert!(endpoint_base(base, true).is_err(), "{} must be refused", base);
        assert!(endpoint_base(base, false).is_err(), "{} must be refused even without a key", base);
    }
}

#[test]
fn rt10_t3_4_other_schemes_are_refused() {
    for base in ["file:///C:/keys.txt", "ftp://example.com/", "javascript:alert(1)", "ws://localhost:1234", "not a url"] {
        assert!(endpoint_base(base, false).is_err(), "{} must be refused", base);
    }
}

#[test]
fn rt10_t3_4_loopback_over_http_and_remote_over_https_are_allowed() {
    for base in [
        "http://localhost:11434/v1",
        "http://LOCALHOST:1234/v1",
        "http://127.0.0.1:1234/v1",
        "http://127.1:1234/v1", // normalised to 127.0.0.1
        "http://[::1]:1234/v1",
        "https://api.example.com/v1",
    ] {
        assert!(endpoint_base(base, true).is_ok(), "{} should be allowed", base);
    }
}

// ── T6.2: argument injection through a relative "project path" ──────────────────

fn editor() -> Vec<DiscoveredTool> {
    vec![DiscoveredTool {
        id: "nebula".into(),
        name: "nebula app".into(),
        category: ToolCategory::Editor,
        launch: Some(LaunchCommand { program: "/opt/nebula/bin/nebula".into(), args: vec![] }),
        ..Default::default()
    }]
}

fn payload(project_path: &str) -> LaunchPayload {
    LaunchPayload {
        project_path: project_path.into(),
        project_name: "red-team".into(),
        selected_tool: "nebula".into(),
        idea_description: "x".into(),
        skills: vec![],
    }
}

/// RT-11 (T6.2): script in the web view (or a crafted launch payload) sends the "project path"
/// `--version`. validate_safe_path accepts relative paths, so the launcher creates a folder
/// named `--version` in the app's working directory and hands `--version` to the editor as its
/// last argument, where it is read as an option, not a folder. Safe outcome: refused, or made
/// absolute before it reaches the editor.
///
/// The test changes the process working directory to a fresh temporary folder so the relative
/// folder is created there, not in the repository. No program is started: spawn is a recorder.
#[test]
#[ignore = "RT-11: validate_safe_path accepts a relative path such as --version and passes it to the editor as an option (T6.2, open)"]
fn rt11_t6_2_a_relative_path_that_looks_like_an_option_never_reaches_the_editor() {
    let scratch: PathBuf = std::env::temp_dir().join(format!("omni-red-team-t62-{}", std::process::id()));
    let _ = fs::remove_dir_all(&scratch);
    fs::create_dir_all(&scratch).unwrap();
    let previous = std::env::current_dir().unwrap();
    std::env::set_current_dir(&scratch).unwrap();

    let spawned = RefCell::new(Vec::<String>::new());
    let result = SyncLauncher::with_adapters(vec![]).launch_with(&payload("--version"), &editor(), |_, project| {
        spawned.borrow_mut().push(project.to_string());
        Ok(())
    });

    std::env::set_current_dir(&previous).unwrap();
    let _ = fs::remove_dir_all(&scratch);

    match result {
        Err(_) => {} // refused: safe
        Ok(_) => {
            for arg in spawned.borrow().iter() {
                assert!(!arg.starts_with('-'), "the editor received {:?}, which it reads as an option", arg);
                assert!(PathBuf::from(arg).is_absolute(), "the editor received the relative path {:?}", arg);
            }
        }
    }
}

/// Control for T6.2: a relative path that climbs out with `..` is refused today.
#[test]
fn rt11_t6_2_control_relative_parent_traversal_is_refused() {
    let result = SyncLauncher::with_adapters(vec![]).launch_with(&payload("../../outside"), &editor(), |_, _| {
        panic!("must not spawn")
    });
    assert!(result.is_err());
}
