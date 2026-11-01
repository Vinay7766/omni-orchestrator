use tauri_app_lib::commands::tool_detector::ToolDetector;
use tauri_app_lib::models::ToolId;

#[test]
fn test_tool_detector_detects_system_tools() {
    let detector = ToolDetector::new();
    let tools = detector.detect_all();

    // Verify all 6 target tools are checked
    assert_eq!(tools.len(), 6);

    let tool_ids: Vec<_> = tools.iter().map(|t| t.id.clone()).collect();
    assert!(tool_ids.contains(&ToolId::Antigravity));
    assert!(tool_ids.contains(&ToolId::Cursor));
    assert!(tool_ids.contains(&ToolId::Vscode));
    assert!(tool_ids.contains(&ToolId::Windsurf));
    assert!(tool_ids.contains(&ToolId::ClaudeCode));
    assert!(tool_ids.contains(&ToolId::Ollama));

    // Verify all tools have metadata populated
    for tool in &tools {
        assert!(!tool.name.is_empty());
        assert!(!tool.config_directory.is_empty());
        assert!(!tool.command_snippet.is_empty());
    }
}
