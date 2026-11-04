//! Signed person decisions (C17; red-team findings RT-1, RT-2; threats T2.1, T2.2, T2.6).
//!
//! A decision on a phase (approve, request changes, skip, withdraw) is signed here, in Rust, only
//! after the person confirms it in a native dialog that the web view cannot draw or click. The
//! Ed25519 private key is kept in the operating system's credential store; the public key is
//! written to `trust.json` in the app's data folder, outside every project, where the app, the
//! MCP server and the extension read it to check signatures.
//!
//! The text signed is built by @omni/core (`decisionMessage`); Rust parses it to tell the person
//! what they are confirming, so the dialog shows what is really signed.

use std::fs;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use ed25519_dalek::{Signature, Signer as _, SigningKey, Verifier as _, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::storage::secrets::{KeyringStore, SecretStore};

/// The credential-store entry holding the signing key's 32-byte seed (base64).
pub const KEY_ENTRY: &str = "decision-signing-key";
/// The trusted public keys, in the app's data folder.
pub const TRUST_FILE: &str = "trust.json";
/// Must match `decisionMessage` in packages/core/src/memory/integrity.ts.
pub const MESSAGE_PREFIX: &str = "omni-decision-v1\n";
const DECISIONS: &[&str] = &["phase_approved", "changes_requested", "phase_skipped", "approval_withdrawn"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DecisionSignature {
    pub key_id: String,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureCheck {
    pub key_id: String,
    pub message: String,
    pub signature: String,
}

/// The decision a message describes, read back from the message itself.
#[derive(Debug, Clone, PartialEq)]
pub struct Decision {
    pub kind: String,
    pub phase: String,
    pub notes: Option<String>,
}

/// Reads a message built by `decisionMessage`; refuses anything that is not a person's decision.
pub fn parse_decision(message: &str) -> Result<Decision, String> {
    let body = message.strip_prefix(MESSAGE_PREFIX).ok_or("Not a decision message.")?;
    let value: Value = serde_json::from_str(body).map_err(|_| "The decision message is not valid JSON.".to_string())?;
    let kind = value["type"].as_str().unwrap_or_default().to_string();
    if !DECISIONS.contains(&kind.as_str()) {
        return Err(format!("\"{}\" is not a decision on a phase.", kind));
    }
    if value["actor"]["kind"] != "human" {
        return Err("Only a person's decision is signed.".into());
    }
    for field in ["project", "id", "time"] {
        if value[field].as_str().is_none_or(str::is_empty) {
            return Err(format!("The decision message has no {}.", field));
        }
    }
    let phase = value["payload"]["phase"].as_str().unwrap_or_default().to_string();
    if phase.is_empty() {
        return Err("The decision names no phase.".into());
    }
    let notes = value["payload"]["notes"].as_str().or(value["payload"]["reason"].as_str()).map(str::to_string);
    Ok(Decision { kind, phase, notes })
}

/// What the native dialog asks, from the parsed decision (never from text the web view wrote).
pub fn confirmation_text(decision: &Decision, project_name: &str) -> (String, String) {
    let verb = match decision.kind.as_str() {
        "phase_approved" => "Approve",
        "changes_requested" => "Request changes to",
        "phase_skipped" => "Skip",
        _ => "Withdraw your approval of",
    };
    let short: String = project_name.chars().filter(|c| !c.is_control()).take(80).collect();
    let mut text = format!("{} the phase \"{}\" in {}?", verb, decision.phase, short);
    if let Some(notes) = &decision.notes {
        let notes: String = notes.chars().take(300).collect();
        text.push_str(&format!("\n\n{}", notes));
    }
    text.push_str("\n\nOnly you can make this decision. If you did not just choose this in OmniOrchestrator, press Cancel.");
    (format!("{} \"{}\"", verb, decision.phase), text)
}

/// A key id from the public key, so a replaced key is a different id.
pub fn key_id(public: &VerifyingKey) -> String {
    let bytes = public.to_bytes();
    format!("omni-desktop-{}", bytes[..6].iter().map(|b| format!("{:02x}", b)).collect::<String>())
}

/// The signing key from the credential store, created on first use.
pub fn load_or_create_key(store: &dyn SecretStore) -> Result<SigningKey, String> {
    if let Some(seed) = store.get(KEY_ENTRY)? {
        let bytes: [u8; 32] = B64.decode(seed.trim()).ok().and_then(|b| b.try_into().ok()).ok_or("The stored signing key is damaged.")?;
        return Ok(SigningKey::from_bytes(&bytes));
    }
    let mut seed = [0u8; 32];
    getrandom::fill(&mut seed).map_err(|e| format!("no secure random numbers: {}", e))?;
    store.set(KEY_ENTRY, &B64.encode(seed))?;
    Ok(SigningKey::from_bytes(&seed))
}

/// The trust file's content for this app's key.
pub fn trust_document(public: &VerifyingKey) -> Value {
    json!({
        "formatVersion": 1,
        "keys": [{ "id": key_id(public), "publicKey": B64.encode(public.to_bytes()), "holder": "omni-desktop" }]
    })
}

/// What writing the trust file found.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TrustWrite {
    Unchanged,
    /// There was no file yet.
    Created,
    /// The file named other keys or was damaged: something else changed it (a monitoring signal).
    Restored,
}

/// Writes the trust file for this key, reporting what was there before.
pub fn write_trust(app_dir: &Path, public: &VerifyingKey) -> Result<TrustWrite, String> {
    fs::create_dir_all(app_dir).map_err(|e| e.to_string())?;
    let path = app_dir.join(TRUST_FILE);
    let wanted = trust_document(public);
    let before = fs::read_to_string(&path).ok();
    let current: Option<Value> = before.as_ref().and_then(|t| serde_json::from_str(t).ok());
    if current.as_ref() == Some(&wanted) {
        return Ok(TrustWrite::Unchanged);
    }
    let tmp = app_dir.join(format!("{}.tmp", TRUST_FILE));
    fs::write(&tmp, serde_json::to_string_pretty(&wanted).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(if before.is_none() { TrustWrite::Created } else { TrustWrite::Restored })
}

/// Signs a decision message (after the person confirmed it).
pub fn sign_message(key: &SigningKey, message: &str) -> DecisionSignature {
    DecisionSignature { key_id: key_id(&key.verifying_key()), value: B64.encode(key.sign(message.as_bytes()).to_bytes()) }
}

/// Reads the trusted public keys; a missing or damaged file trusts nothing.
pub fn read_trusted_keys(file: &Path) -> Vec<(String, VerifyingKey)> {
    let Some(doc) = fs::read_to_string(file).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) else { return vec![] };
    if doc["formatVersion"] != 1 {
        return vec![];
    }
    doc["keys"]
        .as_array()
        .map(|keys| {
            keys.iter()
                .filter_map(|k| {
                    let id = k["id"].as_str()?.to_string();
                    let raw: [u8; 32] = B64.decode(k["publicKey"].as_str()?).ok()?.try_into().ok()?;
                    Some((id, VerifyingKey::from_bytes(&raw).ok()?))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Checks each signature against the trusted keys.
pub fn verify_all(keys: &[(String, VerifyingKey)], items: &[SignatureCheck]) -> Vec<bool> {
    items
        .iter()
        .map(|item| {
            let Some((_, key)) = keys.iter().find(|(id, _)| *id == item.key_id) else { return false };
            let Some(bytes) = B64.decode(&item.signature).ok().and_then(|b| <[u8; 64]>::try_from(b).ok()) else { return false };
            key.verify(item.message.as_bytes(), &Signature::from_bytes(&bytes)).is_ok()
        })
        .collect()
}

fn app_dir() -> PathBuf {
    crate::commands::mcp_setup::app_data_dir()
}

/// Makes sure the key exists and the trust file names it.
pub fn ensure_trust() -> Result<TrustWrite, String> {
    let key = load_or_create_key(&KeyringStore)?;
    write_trust(&app_dir(), &key.verifying_key())
}

/// Signs a person's decision after they confirm it in a native dialog; None when they cancel.
#[tauri::command]
pub async fn sign_decision(app: tauri::AppHandle, message: String, project_name: String) -> Result<Option<DecisionSignature>, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let decision = parse_decision(&message)?;
    let (title, text) = confirmation_text(&decision, &project_name);
    let verb = title.split(' ').next().unwrap_or("Confirm").to_string();
    let confirmed = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .message(text)
            .title(title)
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(verb, "Cancel".into()))
            .blocking_show()
    })
    .await
    .map_err(|e| e.to_string())?;
    if !confirmed {
        return Ok(None);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let key = load_or_create_key(&KeyringStore)?;
        write_trust(&app_dir(), &key.verifying_key())?;
        Ok(Some(sign_message(&key, &message)))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Checks signatures against the trust file, for the web view's Trust.
#[tauri::command]
pub async fn verify_decisions(items: Vec<SignatureCheck>) -> Result<Vec<bool>, String> {
    tauri::async_runtime::spawn_blocking(move || verify_all(&read_trusted_keys(&app_dir().join(TRUST_FILE)), &items)).await.map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustStatus {
    /// The app's key id, when the credential store could be used.
    pub key_id: Option<String>,
    /// What was found: `restored` means something else had changed trust.json.
    pub trust_file: Option<TrustWrite>,
    /// Why signing is not available, if it is not.
    pub problem: Option<String>,
}

/// Checks the key and restores the trust file (monitoring: a changed trust file is reported).
#[tauri::command]
pub async fn trust_status() -> Result<TrustStatus, String> {
    tauri::async_runtime::spawn_blocking(|| match load_or_create_key(&KeyringStore) {
        Ok(key) => match write_trust(&app_dir(), &key.verifying_key()) {
            Ok(found) => TrustStatus { key_id: Some(key_id(&key.verifying_key())), trust_file: Some(found), problem: None },
            Err(e) => TrustStatus { key_id: Some(key_id(&key.verifying_key())), trust_file: None, problem: Some(e) },
        },
        Err(e) => TrustStatus { key_id: None, trust_file: None, problem: Some(e) },
    })
    .await
    .map_err(|e| e.to_string())
}
