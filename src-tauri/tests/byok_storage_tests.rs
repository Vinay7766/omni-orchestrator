//! G2 / NFR-10: BYOK settings survive a restart; API keys live only in the OS credential
//! store (a `SecretStore`), never in settings.json. These tests use the in-memory store;
//! the keyring-backed store is the same interface over the platform's credential manager.

use std::path::PathBuf;
use tauri_app_lib::models::*;
use tauri_app_lib::storage::secrets::MemorySecretStore;
use tauri_app_lib::storage::store::StorageManager;

const GEMINI_KEY: &str = "AIzaTEST-gemini-key-1234567890";
const COMPAT_KEY: &str = "sk-test-compatible-0987654321";

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("omni-byok-{}-{}", name, std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

fn full_config() -> BYOKConfig {
    BYOKConfig {
        gemini_api_key: Some(GEMINI_KEY.to_string()),
        compatible_base_url: Some("http://localhost:8080/v1".to_string()),
        compatible_api_key: Some(COMPAT_KEY.to_string()),
        preferred_model: Some("made-up-model-7b".to_string()),
        active_provider: Some(ByokProvider::Compatible),
        ..Default::default()
    }
}

fn settings_text(dir: &PathBuf) -> String {
    std::fs::read_to_string(dir.join("settings.json")).expect("settings.json written")
}

#[test]
fn saved_byok_survives_a_restart_with_keys_from_the_secret_store() {
    let dir = temp_dir("restart");
    let secrets = MemorySecretStore::new();
    let status = StorageManager::new(dir.clone()).save_byok(&full_config(), &secrets).unwrap();
    assert!(status.available);

    // A new StorageManager over the same folder and store is what the next app start sees.
    let loaded = StorageManager::new(dir.clone()).load_byok(&secrets).unwrap();
    assert_eq!(loaded.config, full_config());
    assert!(loaded.key_storage.available);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn keys_never_reach_settings_json() {
    let dir = temp_dir("nokeys");
    let secrets = MemorySecretStore::new();
    StorageManager::new(dir.clone()).save_byok(&full_config(), &secrets).unwrap();

    let text = settings_text(&dir);
    assert!(!text.contains(GEMINI_KEY), "Gemini key written to settings.json");
    assert!(!text.contains(COMPAT_KEY), "endpoint key written to settings.json");
    assert!(text.contains("made-up-model-7b"), "non-secret fields are kept in settings.json");
    assert_eq!(secrets.get_plain("geminiApiKey").as_deref(), Some(GEMINI_KEY));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn clearing_a_key_removes_it_from_the_secret_store() {
    let dir = temp_dir("clear");
    let secrets = MemorySecretStore::new();
    let storage = StorageManager::new(dir.clone());
    storage.save_byok(&full_config(), &secrets).unwrap();

    let mut cleared = full_config();
    cleared.gemini_api_key = Some(String::new());
    storage.save_byok(&cleared, &secrets).unwrap();

    assert_eq!(secrets.get_plain("geminiApiKey"), None);
    assert_eq!(storage.load_byok(&secrets).unwrap().config.gemini_api_key, None);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn without_a_credential_store_keys_are_not_saved_and_the_status_says_why() {
    let dir = temp_dir("nostore");
    let secrets = MemorySecretStore::unavailable("no Secret Service running");
    let storage = StorageManager::new(dir.clone());

    let status = storage.save_byok(&full_config(), &secrets).unwrap();
    assert!(!status.available);
    assert!(status.message.as_deref().unwrap_or("").contains("no Secret Service running"));

    let text = settings_text(&dir);
    assert!(!text.contains(GEMINI_KEY) && !text.contains(COMPAT_KEY));
    let loaded = storage.load_byok(&secrets).unwrap();
    assert_eq!(loaded.config.gemini_api_key, None);
    assert_eq!(loaded.config.preferred_model.as_deref(), Some("made-up-model-7b"));
    assert!(!loaded.key_storage.available);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn general_settings_writes_strip_keys_and_keep_the_stored_byok() {
    let dir = temp_dir("general");
    let secrets = MemorySecretStore::new();
    let storage = StorageManager::new(dir.clone());
    storage.save_byok(&full_config(), &secrets).unwrap();

    // Another screen (projects list) saves settings with an old or key-carrying byok.
    let mut other = storage.load_settings().unwrap();
    other.project_folders = vec!["D:/work".to_string()];
    other.byok = BYOKConfig { openai_api_key: Some("sk-should-not-be-written".to_string()), ..Default::default() };
    storage.save_settings_keeping_byok(&other).unwrap();

    let text = settings_text(&dir);
    assert!(!text.contains("sk-should-not-be-written"));
    let loaded = storage.load_byok(&secrets).unwrap();
    assert_eq!(loaded.config, full_config(), "the BYOK screen's settings are not overwritten");
    assert_eq!(storage.load_settings().unwrap().project_folders, vec!["D:/work".to_string()]);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn save_settings_never_writes_keys_whatever_it_is_given() {
    let dir = temp_dir("strip");
    let storage = StorageManager::new(dir.clone());
    let mut settings = AppSettings::default();
    settings.byok = full_config();
    storage.save_settings(&settings).unwrap();

    let text = settings_text(&dir);
    assert!(!text.contains(GEMINI_KEY) && !text.contains(COMPAT_KEY));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_key_left_in_an_old_settings_file_moves_to_the_secret_store() {
    let dir = temp_dir("legacy");
    std::fs::create_dir_all(&dir).unwrap();
    let legacy = format!(
        r#"{{"defaultTrack":"track-a","theme":"dark","byok":{{"geminiApiKey":"{}","preferredModel":"m1"}}}}"#,
        GEMINI_KEY
    );
    std::fs::write(dir.join("settings.json"), legacy).unwrap();
    let secrets = MemorySecretStore::new();

    let loaded = StorageManager::new(dir.clone()).load_byok(&secrets).unwrap();
    assert_eq!(loaded.config.gemini_api_key.as_deref(), Some(GEMINI_KEY));
    assert_eq!(secrets.get_plain("geminiApiKey").as_deref(), Some(GEMINI_KEY));
    assert!(!settings_text(&dir).contains(GEMINI_KEY), "plain-text key removed from the file");
    let _ = std::fs::remove_dir_all(dir);
}

/// The real OS credential store (Windows Credential Manager, macOS Keychain, Secret Service).
/// Opt-in (`cargo test -- --ignored`): CI runners may have no credential store running.
/// Uses its own entry name, so it never touches the user's saved keys.
#[test]
#[ignore]
fn real_credential_store_round_trip() {
    use tauri_app_lib::storage::secrets::{KeyringStore, SecretStore};
    let store = KeyringStore;
    store.status().expect("a credential store is available on this machine");
    let name = format!("omni-test-entry-{}", std::process::id());
    store.set(&name, "test-value-123").unwrap();
    assert_eq!(store.get(&name).unwrap().as_deref(), Some("test-value-123"));
    store.delete(&name).unwrap();
    assert_eq!(store.get(&name).unwrap(), None);
    store.delete(&name).expect("deleting a missing entry is not an error");
}
