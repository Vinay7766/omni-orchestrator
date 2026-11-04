//! C17: the person's decisions are signed in Rust after a native confirmation (RT-1, RT-2).
use std::fs;
use std::path::PathBuf;

use base64::Engine;
use ed25519_dalek::SigningKey;
use tauri_app_lib::commands::decisions::*;
use tauri_app_lib::storage::secrets::{MemorySecretStore, SecretStore};

fn temp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("omni-decisions-{}-{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}

/// Same text @omni/core's decisionMessage builds (see integrity.test.ts, "cross-language").
const MESSAGE: &str = "omni-decision-v1\n{\"project\":\"proj-1\",\"id\":\"evt-1\",\"time\":\"2026-11-04T10:00:00.000Z\",\"type\":\"phase_approved\",\"actor\":{\"kind\":\"human\",\"tool\":\"omni-desktop\"},\"payload\":{\"phase\":\"prd\"}}";

#[test]
fn a_decision_message_is_read_back_for_the_dialog() {
    let d = parse_decision(MESSAGE).unwrap();
    assert_eq!(d, Decision { kind: "phase_approved".into(), phase: "prd".into(), notes: None });
    let (title, text) = confirmation_text(&d, "Orbit planner");
    assert_eq!(title, "Approve \"prd\"");
    assert!(text.starts_with("Approve the phase \"prd\" in Orbit planner?"));
}

#[test]
fn only_a_persons_decision_on_a_phase_is_signed() {
    for bad in [
        "{}".to_string(),
        MESSAGE.replace("phase_approved", "task_completed"),
        MESSAGE.replace("\"human\"", "\"agent\""),
        MESSAGE.replace("{\"phase\":\"prd\"}", "{}"),
        MESSAGE.replace("\"proj-1\"", "\"\""),
    ] {
        assert!(parse_decision(&bad).is_err(), "{}", bad);
    }
}

#[test]
fn the_key_is_kept_in_the_credential_store_and_reused() {
    let store = MemorySecretStore::default();
    let first = load_or_create_key(&store).unwrap();
    assert!(store.get(KEY_ENTRY).unwrap().is_some());
    let again = load_or_create_key(&store).unwrap();
    assert_eq!(first.to_bytes(), again.to_bytes());
}

#[test]
fn a_signature_verifies_only_with_the_trusted_key_and_the_same_text() {
    let dir = temp("verify");
    let key = SigningKey::from_bytes(&[7u8; 32]);
    assert_eq!(write_trust(&dir, &key.verifying_key()).unwrap(), TrustWrite::Created);
    let keys = read_trusted_keys(&dir.join(TRUST_FILE));
    let signed = sign_message(&key, MESSAGE);
    let check = |message: &str, s: &DecisionSignature| SignatureCheck { key_id: s.key_id.clone(), message: message.into(), signature: s.value.clone() };
    let other = sign_message(&SigningKey::from_bytes(&[9u8; 32]), MESSAGE);
    let results = verify_all(&keys, &[check(MESSAGE, &signed), check(&MESSAGE.replace("prd", "build"), &signed), check(MESSAGE, &other)]);
    assert_eq!(results, vec![true, false, false]);
}

#[test]
fn the_same_signature_as_node_for_the_same_key_and_text() {
    // Ed25519 is deterministic: @omni/core's test verifies this exact signature with node:crypto.
    let key = SigningKey::from_bytes(&[7u8; 32]);
    let b64 = base64::engine::general_purpose::STANDARD;
    assert_eq!(b64.encode(key.verifying_key().to_bytes()), "6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw=");
    assert_eq!(sign_message(&key, MESSAGE).value, "a9GX1P7cXu3lc0abHBy9JJVY5xLXka4xS0vl2tSHC7a1PWCYElUPppabt5B19hzvghcEiNTm3gg54o53h+lDCQ==");
}

#[test]
fn a_changed_trust_file_is_restored_and_reported() {
    let dir = temp("restore");
    let key = SigningKey::from_bytes(&[7u8; 32]);
    write_trust(&dir, &key.verifying_key()).unwrap();
    assert_eq!(write_trust(&dir, &key.verifying_key()).unwrap(), TrustWrite::Unchanged);
    // Another program adds its own key so its signatures would be trusted.
    let added = SigningKey::from_bytes(&[1u8; 32]);
    let mut doc = trust_document(&key.verifying_key());
    doc["keys"].as_array_mut().unwrap().push(trust_document(&added.verifying_key())["keys"][0].clone());
    fs::write(dir.join(TRUST_FILE), doc.to_string()).unwrap();
    assert_eq!(write_trust(&dir, &key.verifying_key()).unwrap(), TrustWrite::Restored);
    assert_eq!(read_trusted_keys(&dir.join(TRUST_FILE)).len(), 1);
}
