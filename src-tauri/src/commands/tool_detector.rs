use std::path::{Path, PathBuf};
use crate::models::{InstalledTool, ToolId};

#[derive(Default, Clone)]
pub struct ToolDetector;

impl ToolDetector {
    pub fn new() -> Self {
        Self
    }

    pub fn detect_all(&self) -> Vec<InstalledTool> {
        vec![
            self.detect_antigravity(),
            self.detect_cursor(),
            self.detect_vscode(),
            self.detect_windsurf(),
            self.detect_claude_code(),
            self.detect_ollama(),
        ]
    }

    fn check_path_or_candidates(&self, bin_name: &str, candidates: &[PathBuf]) -> (bool, String) {
        // 1. Check direct candidate paths
        for path in candidates {
            if path.exists() {
                return (true, path.to_string_lossy().to_string());
            }
        }

        // 2. Check PATH environment variable
        if let Ok(path_var) = std::env::var("PATH") {
            let separator = if cfg!(windows) { ';' } else { ':' };
            for dir in path_var.split(separator) {
                let candidate = Path::new(dir).join(bin_name);
                if candidate.exists() {
                    return (true, candidate.to_string_lossy().to_string());
                }
                if cfg!(windows) {
                    let cmd_candidate = Path::new(dir).join(format!("{}.cmd", bin_name));
                    if cmd_candidate.exists() {
                        return (true, cmd_candidate.to_string_lossy().to_string());
                    }
                    let exe_candidate = Path::new(dir).join(format!("{}.exe", bin_name));
                    if exe_candidate.exists() {
                        return (true, exe_candidate.to_string_lossy().to_string());
                    }
                }
            }
        }

        (false, String::new())
    }

    pub fn detect_antigravity(&self) -> InstalledTool {
        let mut candidates = Vec::new();
        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            candidates.push(PathBuf::from(&userprofile).join(".gemini").join("antigravity").join("bin").join("agy.cmd"));
            candidates.push(PathBuf::from(&userprofile).join(".gemini").join("antigravity").join("bin").join("agy.exe"));
        }
        if let Ok(home) = std::env::var("HOME") {
            candidates.push(PathBuf::from(&home).join(".gemini").join("antigravity").join("bin").join("agy"));
        }

        let (installed, exec_path) = self.check_path_or_candidates("agy", &candidates);

        InstalledTool {
            id: ToolId::Antigravity,
            name: "Google Antigravity".to_string(),
            executable_path: exec_path,
            installed,
            version: if installed { Some("2.0".to_string()) } else { None },
            config_directory: ".gemini/config/skills/".to_string(),
            command_snippet: "agy .".to_string(),
        }
    }

    pub fn detect_cursor(&self) -> InstalledTool {
        let mut candidates = Vec::new();
        if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
            candidates.push(PathBuf::from(&local_appdata).join("Programs").join("cursor").join("Cursor.exe"));
        }
        candidates.push(PathBuf::from("/Applications/Cursor.app"));

        let (installed, exec_path) = self.check_path_or_candidates("cursor", &candidates);

        InstalledTool {
            id: ToolId::Cursor,
            name: "Cursor AI Editor".to_string(),
            executable_path: exec_path,
            installed,
            version: if installed { Some("Latest".to_string()) } else { None },
            config_directory: ".cursor/skills/".to_string(),
            command_snippet: "cursor .".to_string(),
        }
    }

    pub fn detect_vscode(&self) -> InstalledTool {
        let mut candidates = Vec::new();
        if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
            candidates.push(PathBuf::from(&local_appdata).join("Programs").join("Microsoft VS Code").join("Code.exe"));
        }
        candidates.push(PathBuf::from("C:\\Program Files\\Microsoft VS Code\\Code.exe"));
        candidates.push(PathBuf::from("/Applications/Visual Studio Code.app"));

        let (installed, exec_path) = self.check_path_or_candidates("code", &candidates);

        InstalledTool {
            id: ToolId::Vscode,
            name: "Visual Studio Code".to_string(),
            executable_path: exec_path,
            installed,
            version: if installed { Some("Latest".to_string()) } else { None },
            config_directory: ".agents/skills/".to_string(),
            command_snippet: "code .".to_string(),
        }
    }

    pub fn detect_windsurf(&self) -> InstalledTool {
        let mut candidates = Vec::new();
        if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
            candidates.push(PathBuf::from(&local_appdata).join("Programs").join("windsurf").join("Windsurf.exe"));
        }
        candidates.push(PathBuf::from("/Applications/Windsurf.app"));

        let (installed, exec_path) = self.check_path_or_candidates("windsurf", &candidates);

        InstalledTool {
            id: ToolId::Windsurf,
            name: "Windsurf IDE".to_string(),
            executable_path: exec_path,
            installed,
            version: if installed { Some("Latest".to_string()) } else { None },
            config_directory: ".windsurfrules".to_string(),
            command_snippet: "windsurf .".to_string(),
        }
    }

    pub fn detect_claude_code(&self) -> InstalledTool {
        let mut candidates = Vec::new();
        if let Ok(appdata) = std::env::var("APPDATA") {
            candidates.push(PathBuf::from(&appdata).join("npm").join("claude.cmd"));
        }
        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            candidates.push(PathBuf::from(&userprofile).join(".local").join("bin").join("claude.exe"));
        }

        let (installed, exec_path) = self.check_path_or_candidates("claude", &candidates);

        InstalledTool {
            id: ToolId::ClaudeCode,
            name: "Claude Code CLI".to_string(),
            executable_path: exec_path,
            installed,
            version: if installed { Some("Latest".to_string()) } else { None },
            config_directory: ".claude/skills/".to_string(),
            command_snippet: "claude".to_string(),
        }
    }

    pub fn detect_ollama(&self) -> InstalledTool {
        let mut candidates = Vec::new();
        if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
            candidates.push(PathBuf::from(&local_appdata).join("Programs").join("Ollama").join("ollama.exe"));
        }

        let (installed, exec_path) = self.check_path_or_candidates("ollama", &candidates);

        InstalledTool {
            id: ToolId::Ollama,
            name: "Ollama (Local Models)".to_string(),
            executable_path: exec_path,
            installed,
            version: if installed { Some("Local".to_string()) } else { None },
            config_directory: "http://localhost:11434".to_string(),
            command_snippet: "ollama run llama3.3".to_string(),
        }
    }
}

#[tauri::command]
pub fn detect_installed_tools() -> Result<Vec<InstalledTool>, String> {
    let detector = ToolDetector::new();
    Ok(detector.detect_all())
}
