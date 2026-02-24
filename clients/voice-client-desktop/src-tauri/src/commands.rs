use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::types::{
    AppSettings, AudioDevice, ConnectionResult, SessionResponse,
};
use crate::{audio, api, settings};

#[tauri::command]
pub async fn list_audio_devices() -> Result<Vec<AudioDevice>, String> {
    audio::list_audio_devices()
}

#[tauri::command]
pub async fn start_recording(
    device_id: Option<String>,
    state: State<'_, crate::audio::AudioState>,
) -> Result<(), String> {
    audio::start_recording(&state, device_id.as_deref())
}

#[tauri::command]
pub async fn stop_and_send(
    app: AppHandle,
    base_url: String,
    session_id: String,
    profile_name: String,
    session_key: Option<String>,
    state: State<'_, crate::audio::AudioState>,
) -> Result<(), String> {
    let wav_bytes = audio::stop_recording(&state)?;
    api::send_audio_streaming(
        &app,
        base_url.as_str(),
        session_id.as_str(),
        profile_name.as_str(),
        session_key.as_deref(),
        wav_bytes,
    )
    .await
}

#[tauri::command]
pub async fn create_session(
    base_url: String,
    profile_name: String,
) -> Result<SessionResponse, String> {
    api::create_session(base_url.as_str(), profile_name.as_str()).await
}

#[tauri::command]
pub async fn test_connection(base_url: String) -> Result<ConnectionResult, String> {
    api::test_connection(base_url.as_str()).await
}

#[tauri::command]
pub async fn load_settings(app: AppHandle) -> Result<AppSettings, String> {
    settings::load_settings(&app)
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    settings::save_settings(&app, &settings)
}

#[tauri::command]
pub async fn open_settings_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App("settings.html".into()))
        .title("OpenClaw Settings")
        .inner_size(500.0, 600.0)
        .center()
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn quit_app(app: AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}
