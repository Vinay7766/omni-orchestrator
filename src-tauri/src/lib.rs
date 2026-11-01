pub mod models;
pub mod storage;
pub mod commands;

use commands::storage_cmd::*;
use commands::skill_manager::*;
use commands::sync_launcher::*;
use commands::byok_engine::*;
use commands::memory_fs::*;
use commands::tool_discovery::discover_tools;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_app_settings,
            save_app_settings,
            get_custom_skills,
            save_custom_skill,
            delete_custom_skill,
            get_session_state,
            save_session_state,
            get_default_project_path,
            generate_project_brief,
            get_skills,
            toggle_skill,
            launch_and_build,
            prepare_project_staging,
            execute_strategic_teardown,
            list_byok_models,
            update_skill_content,
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
            // Category-based tool discovery (no fixed tool list)
            discover_tools
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
