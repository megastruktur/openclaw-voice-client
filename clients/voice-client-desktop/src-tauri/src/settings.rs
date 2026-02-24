use keyring::Entry;
use serde_json::Value;
use tauri_plugin_store::StoreExt;

use crate::types::AppSettings;

const KEYRING_SERVICE: &str = "openclaw-voice-client";
const KEYRING_USERNAME: &str = "token";

/// Save token to OS keyring (macOS Keychain, Windows Credential Manager, Linux libsecret)
pub fn save_token(token: &str) -> Result<(), String> {
    let entry =
        Entry::new(KEYRING_SERVICE, KEYRING_USERNAME).map_err(|e| format!("Keyring error: {e}"))?;
    entry
        .set_password(token)
        .map_err(|e| format!("Failed to save token: {e}"))
}

/// Load token from OS keyring — returns empty string if not found
pub fn load_token() -> Result<String, String> {
    let entry =
        Entry::new(KEYRING_SERVICE, KEYRING_USERNAME).map_err(|e| format!("Keyring error: {e}"))?;
    match entry.get_password() {
        Ok(token) => Ok(token),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(e) => Err(format!("Failed to load token: {e}")),
    }
}

/// Delete token from OS keyring
pub fn delete_token() -> Result<(), String> {
    let entry =
        Entry::new(KEYRING_SERVICE, KEYRING_USERNAME).map_err(|e| format!("Keyring error: {e}"))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // Already gone — not an error
        Err(e) => Err(format!("Failed to delete token: {e}")),
    }
}

/// Load settings from tauri-plugin-store + token from keyring
pub fn load_settings<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<AppSettings, String> {
    let store = app
        .store("settings.json")
        .map_err(|e| format!("Failed to open store: {e}"))?;

    let gateway_url = store
        .get("gateway_url")
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_else(|| "http://127.0.0.1:18790/voice-client".to_string());

    let profile_name = store
        .get("profile_name")
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default();

    let session_key = store
        .get("session_key")
        .and_then(|v| v.as_str().map(String::from))
        .filter(|s| !s.is_empty());

    let microphone_device_id = store
        .get("microphone_device_id")
        .and_then(|v| v.as_str().map(String::from))
        .filter(|s| !s.is_empty());

    let push_to_talk_hotkey = store
        .get("push_to_talk_hotkey")
        .and_then(|v| v.as_str().map(String::from))
        .filter(|s| !s.is_empty());


    let token = load_token().unwrap_or_default();

    Ok(AppSettings {
        gateway_url,
        token,
        profile_name,
        session_key,
        microphone_device_id,
        push_to_talk_hotkey,
    })
}

/// Save settings to tauri-plugin-store + token to keyring
pub fn save_settings<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    settings: &AppSettings,
) -> Result<(), String> {
    let store = app
        .store("settings.json")
        .map_err(|e| format!("Failed to open store: {e}"))?;


    store.set("gateway_url", Value::String(settings.gateway_url.clone()));
    store.set(
        "profile_name",
        Value::String(settings.profile_name.clone()),
    );

    if let Some(ref key) = settings.session_key {
        store.set("session_key", Value::String(key.clone()));
    } else {
        store.delete("session_key");
    }

    if let Some(ref device_id) = settings.microphone_device_id {
        store.set("microphone_device_id", Value::String(device_id.clone()));
    } else {
        store.delete("microphone_device_id");
    }

    if let Some(ref hotkey) = settings.push_to_talk_hotkey {
        store.set("push_to_talk_hotkey", Value::String(hotkey.clone()));
    } else {
        store.delete("push_to_talk_hotkey");
    }


    store
        .save()
        .map_err(|e| format!("Failed to save store: {e}"))?;


    if !settings.token.is_empty() {
        save_token(&settings.token)?;
    } else {

        let _ = delete_token();
    }

    Ok(())
}
