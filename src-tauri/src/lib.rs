pub mod models;
pub mod storage;
pub mod commands;

use commands::storage_cmd::*;
use commands::skill_manager::*;
use commands::byok_engine::*;
use commands::memory_fs::*;
use commands::tool_discovery::discover_tools;
use commands::mcp_setup::setup_mcp;
use commands::handoff::hand_off_tool;
use commands::fresh_session::start_fresh_session_cmd;
use commands::setup_guide::{git_version, open_folder};
use commands::projects::find_projects;
use commands::planning_docs::{read_planning_document, write_planning_document};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_app_settings,
            save_app_settings,
            // BYOK settings; keys in the OS credential store (NFR-10)
            get_byok_config,
            save_byok_config,
            get_custom_skills,
            save_custom_skill,
            delete_custom_skill,
            get_session_state,
            load_ui_state,
            save_ui_state,
            save_session_state,
            get_default_project_path,
            get_skills,
            toggle_skill,
            execute_strategic_teardown,
            byok_complete,
            list_byok_models,
            update_skill_content,
            add_skill,
            // Project memory file access for @omni/core in the web view (path policy in memory_fs.rs)
            memfs_read_text,
            memfs_write_text,
            memfs_append_text,
            memfs_create_exclusive,
            memfs_exists,
            memfs_mkdir,
            memfs_rename,
            memfs_remove,
            memfs_list,
            memfs_stamp,
            // Category-based tool discovery (no fixed tool list)
            discover_tools,
            // Automatic MCP setup for discovered tools (D5)
            setup_mcp,
            hand_off_tool,
            // Next phase in a fresh session (E11, HND-7)
            start_fresh_session_cmd,
            // Setup guide checks (E9, NTU-4)
            git_version,
            open_folder,
            // Projects under the folders the person configured (E2)
            find_projects,
            // Planning documents in docs/planning of a project (E5)
            write_planning_document,
            read_planning_document
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
