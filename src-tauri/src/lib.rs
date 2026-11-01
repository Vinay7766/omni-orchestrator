pub mod models;
pub mod storage;
pub mod commands;

use commands::storage_cmd::*;
use commands::tool_detector::*;
use commands::skill_manager::*;
use commands::research_engine::*;
use commands::sync_launcher::*;
use commands::byok_engine::*;

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
            detect_installed_tools,
            get_skills,
            toggle_skill,
            search_research_skills,
            import_research_skill,
            launch_and_build,
            prepare_project_staging,
            execute_strategic_teardown,
            update_skill_content
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
