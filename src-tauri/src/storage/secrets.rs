//! Where BYOK API keys are kept (NFR-10): the operating system's credential store, never a
//! plain file. `KeyringStore` is the real one; `MemorySecretStore` is for tests.

use std::collections::HashMap;
use std::sync::Mutex;

/// A place to keep secrets by name.
pub trait SecretStore {
    /// Ok when secrets can be kept; otherwise why not (shown to the user).
    fn status(&self) -> Result<(), String>;
    fn get(&self, name: &str) -> Result<Option<String>, String>;
    fn set(&self, name: &str, value: &str) -> Result<(), String>;
    /// Removing a secret that does not exist is not an error.
    fn delete(&self, name: &str) -> Result<(), String>;
}

/// Service name the entries are filed under in the credential manager.
const SERVICE: &str = "OmniOrchestrator";

/// The OS credential store: Windows Credential Manager, macOS Keychain, or the Secret
/// Service on Linux (keyring's default "v1" store choice).
/// API: https://docs.rs/keyring/4.2.0/keyring/v1/struct.Entry.html
pub struct KeyringStore;

impl KeyringStore {
    fn entry(name: &str) -> Result<keyring::v1::Entry, String> {
        keyring::v1::Entry::new(SERVICE, name).map_err(|e| format!("credential store: {}", e))
    }
}

impl SecretStore for KeyringStore {
    fn status(&self) -> Result<(), String> {
        keyring::v1::Entry::store_status()
            .as_ref()
            .map(|_| ())
            .map_err(|e| format!("no system credential store is available ({})", e))
    }

    fn get(&self, name: &str) -> Result<Option<String>, String> {
        match Self::entry(name)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::v1::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("could not read {} from the credential store: {}", name, e)),
        }
    }

    fn set(&self, name: &str, value: &str) -> Result<(), String> {
        Self::entry(name)?
            .set_password(value)
            .map_err(|e| format!("could not save {} in the credential store: {}", name, e))
    }

    fn delete(&self, name: &str) -> Result<(), String> {
        match Self::entry(name)?.delete_credential() {
            Ok(()) | Err(keyring::v1::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("could not remove {} from the credential store: {}", name, e)),
        }
    }
}

/// In-memory store for tests; can pretend no credential store exists.
pub struct MemorySecretStore {
    values: Mutex<HashMap<String, String>>,
    unavailable: Option<String>,
}

impl MemorySecretStore {
    pub fn new() -> Self {
        Self { values: Mutex::new(HashMap::new()), unavailable: None }
    }

    pub fn unavailable(reason: &str) -> Self {
        Self { values: Mutex::new(HashMap::new()), unavailable: Some(reason.to_string()) }
    }

    /// What is stored under `name` (tests inspect the store directly).
    pub fn get_plain(&self, name: &str) -> Option<String> {
        self.values.lock().unwrap().get(name).cloned()
    }
}

impl Default for MemorySecretStore {
    fn default() -> Self {
        Self::new()
    }
}

impl SecretStore for MemorySecretStore {
    fn status(&self) -> Result<(), String> {
        match &self.unavailable {
            Some(reason) => Err(format!("no system credential store is available ({})", reason)),
            None => Ok(()),
        }
    }

    fn get(&self, name: &str) -> Result<Option<String>, String> {
        self.status()?;
        Ok(self.get_plain(name))
    }

    fn set(&self, name: &str, value: &str) -> Result<(), String> {
        self.status()?;
        self.values.lock().unwrap().insert(name.to_string(), value.to_string());
        Ok(())
    }

    fn delete(&self, name: &str) -> Result<(), String> {
        self.status()?;
        self.values.lock().unwrap().remove(name);
        Ok(())
    }
}
