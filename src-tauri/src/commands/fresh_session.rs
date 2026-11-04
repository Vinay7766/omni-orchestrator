//! Starts the next phase in a fresh session (E11, HND-7).
//!
//! The web view sends a project folder, a tool id and the prompt (built by core from memory). The
//! same checks as the E6 handoff apply: the folder must hold project memory and the tool must be
//! selected for the project and found by discovery now. The prompt is saved in
//! .agents/handoff/next-session.md and never put on a command line: a command-line agent whose
//! adapter documents a way to take a first prompt gets LAUNCH_TEXT, a fixed sentence pointing at
//! that file. Every other tool is started or opened as usual and the person pastes the prompt.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::commands::adapters::{adapter_for, bundled_adapters, Adapter, PROMPT_PLACEHOLDER};
use crate::commands::handoff::{passes_a_link, project_folder, team_member};
use crate::commands::tool_discovery::{discover, DiscoveredTool, LaunchCommand, SystemView};

/// Where the prompt is saved (core: FRESH_SESSION_FILE inside .agents/).
pub const FRESH_SESSION_FILE: &str = ".agents/handoff/next-session.md";
/// The only text a command-line agent is started with (core: FRESH_SESSION_LAUNCH_TEXT).
pub const LAUNCH_TEXT: &str = "Read .agents/handoff/next-session.md and follow it.";
pub const MAX_PROMPT: usize = 16 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreshSessionRequest {
    pub project_path: String,
    pub tool_id: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FreshSessionResult {
    pub tool_id: String,
    pub tool_name: String,
    /// The tool was started (or opened) by the app.
    pub launched: bool,
    /// The tool was given the prompt; when false, the person pastes it.
    pub prompt_passed: bool,
    pub message: String,
}

/// A command-line agent to start in its own terminal window.
#[derive(Debug, Clone)]
pub struct TerminalCommand {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
}

fn save_prompt(project: &Path, prompt: &str) -> Result<(), String> {
    let path = project.join(FRESH_SESSION_FILE);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Could not create the folder for {}: {}", FRESH_SESSION_FILE, e))?;
    }
    let temp = PathBuf::from(format!("{}.omni-tmp", path.display()));
    let mut file = fs::File::create(&temp).map_err(|e| format!("Could not write {}: {}", FRESH_SESSION_FILE, e))?;
    file.write_all(prompt.as_bytes()).map_err(|e| format!("Could not write {}: {}", FRESH_SESSION_FILE, e))?;
    drop(file);
    fs::rename(&temp, &path).map_err(|e| {
        let _ = fs::remove_file(&temp);
        format!("Could not replace {}: {}", FRESH_SESSION_FILE, e)
    })
}

/// Saves the prompt and starts `request.tool_id` (see module docs).
pub fn start_fresh_session(
    request: &FreshSessionRequest,
    tools: &[DiscoveredTool],
    adapters: &[Adapter],
    run_in_terminal: impl Fn(&TerminalCommand) -> std::io::Result<()>,
    open: impl Fn(&LaunchCommand, &str) -> std::io::Result<()>,
) -> Result<FreshSessionResult, String> {
    // 1. Check everything before writing anything.
    let project = project_folder(&request.project_path)?;
    team_member(&project, &request.tool_id)?;
    let tool = tools
        .iter()
        .find(|t| t.id == request.tool_id)
        .ok_or_else(|| format!("\"{}\" was not found on this computer any more.", request.tool_id))?;
    let prompt = request.prompt.trim();
    if prompt.is_empty() || request.prompt.len() > MAX_PROMPT {
        return Err(format!("The prompt must be between 1 and {} characters.", MAX_PROMPT));
    }
    if passes_a_link(&project, FRESH_SESSION_FILE) {
        return Err(format!("{} is a link to another file, so it was not written. Replace the link with a plain file.", FRESH_SESSION_FILE));
    }

    // 2. Save the prompt.
    save_prompt(&project, &request.prompt)?;

    // 3. Start the tool.
    let project_text = project.to_string_lossy().into_owned();
    let result = |launched: bool, prompt_passed: bool, message: String| FreshSessionResult {
        tool_id: tool.id.clone(),
        tool_name: tool.name.clone(),
        launched,
        prompt_passed,
        message,
    };
    if let Some(program) = &tool.executable {
        let start = adapter_for(&tool.id, adapters).and_then(|a| a.start_prompt.as_ref());
        let args: Vec<String> = start
            .map(|s| s.args.iter().map(|a| if a == PROMPT_PLACEHOLDER { LAUNCH_TEXT.to_string() } else { a.clone() }).collect())
            .unwrap_or_default();
        let command = TerminalCommand { program: program.clone(), args, cwd: project.clone() };
        return Ok(match run_in_terminal(&command) {
            Ok(()) if start.is_some() => result(true, true, format!("{} was started in a new terminal and told to read the prompt.", tool.name)),
            Ok(()) => result(true, false, format!("{} was started in a new terminal. Paste the prompt into it.", tool.name)),
            Err(e) => result(false, false, format!("{} could not be started ({}). Run {} in a terminal inside {} and paste the prompt.", tool.name, e, program, project_text)),
        });
    }
    if let Some(launch) = &tool.launch {
        return Ok(match open(launch, &project_text) {
            Ok(()) => result(true, false, format!("{} was opened with the project. Paste the prompt into a new chat there.", tool.name)),
            Err(e) => result(false, false, format!("{} could not be opened ({}). Open {} in it and paste the prompt into a new chat.", tool.name, e, project_text)),
        });
    }
    Ok(result(false, false, format!("{} is not started directly: open {} in it and paste the prompt into a new chat.", tool.name, project_text)))
}

/// Quotes a value for a POSIX shell script (single quotes; a quote inside becomes '\'').
/// Used on macOS and Linux; tested on every platform.
#[cfg_attr(windows, allow(dead_code))]
fn sh_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// Starts a command-line agent in its own terminal window, in the project folder. The program
/// comes from discovery and the arguments from adapter data plus LAUNCH_TEXT, never from the web view.
fn run_in_new_terminal(cmd: &TerminalCommand) -> std::io::Result<std::process::Child> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        Command::new(&cmd.program).args(&cmd.args).current_dir(&cmd.cwd).creation_flags(CREATE_NEW_CONSOLE).spawn()
    }
    #[cfg(not(windows))]
    {
        let line = std::iter::once(&cmd.program).chain(cmd.args.iter()).map(|a| sh_quote(a)).collect::<Vec<_>>().join(" ");
        let script = format!("#!/bin/sh\ncd {} || exit 1\nexec {}\n", sh_quote(&cmd.cwd.to_string_lossy()), line);
        let path = cmd.cwd.join(".agents").join("handoff").join("start-session.command");
        fs::write(&path, script)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o700))?;
        }
        if cfg!(target_os = "macos") {
            // Finder opens .command files in Terminal.
            Command::new("open").arg(&path).spawn()
        } else {
            Command::new("x-terminal-emulator").arg("-e").arg(&path).spawn()
        }
    }
}

/// The fresh session on this computer: discovered tools and shipped adapters.
#[tauri::command]
pub async fn start_fresh_session_cmd(request: FreshSessionRequest) -> Result<FreshSessionResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let view = SystemView::from_environment();
        let tools = discover(&view);
        let (adapters, _) = bundled_adapters();
        // A command-line agent needs its terminal, but only one while it is still running; an
        // editor or app opens without a console window (retest bug 1).
        let terminal = |cmd: &TerminalCommand| {
            crate::commands::handoff::launch_once(&format!("terminal|{}|{}", cmd.program, cmd.cwd.display()), || run_in_new_terminal(cmd))
        };
        start_fresh_session(&request, &tools, &adapters, terminal, |cmd, project| {
            crate::commands::tool_discovery::window_launch(cmd, project).spawn().map(|_| ())
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::sh_quote;

    #[test]
    fn quotes_a_single_quote_for_the_shell() {
        assert_eq!(sh_quote("it's"), "'it'\\''s'");
        assert_eq!(sh_quote("$(rm -rf ~)"), "'$(rm -rf ~)'");
    }
}
