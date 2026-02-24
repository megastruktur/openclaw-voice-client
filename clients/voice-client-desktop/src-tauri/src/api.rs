use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use reqwest::Client;
use futures_util::StreamExt;
use tauri::{AppHandle, Emitter};

use crate::sse::SseParser;
use crate::types::{ConnectionResult, CreateSessionRequest, SessionResponse};

/// Test connection to the gateway by hitting GET /profiles
pub async fn test_connection(base_url: &str) -> Result<ConnectionResult, String> {
    let client = Client::new();
    let url = format!("{base_url}/profiles");

    match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => Ok(ConnectionResult {
            success: true,
            error: None,
        }),
        Ok(resp) => Ok(ConnectionResult {
            success: false,
            error: Some(format!("Server returned status {}", resp.status())),
        }),
        Err(e) => Ok(ConnectionResult {
            success: false,
            error: Some(format!("Connection failed: {e}")),
        }),
    }
}

/// Create a new voice session via POST /session/new
pub async fn create_session(
    base_url: &str,
    profile_name: &str,
) -> Result<SessionResponse, String> {
    let client = Client::new();
    let url = format!("{base_url}/session/new");

    let body = CreateSessionRequest {
        profile_name: profile_name.to_string(),
    };

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to create session: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Session creation failed ({status}): {text}"));
    }

    resp.json::<SessionResponse>()
        .await
        .map_err(|e| format!("Failed to parse session response: {e}"))
}

/// Send WAV audio bytes to the gateway and stream SSE events back via Tauri events.
///
/// POST {base_url}/audio?sessionId={session_id}
/// Headers: X-Profile, Content-Type: audio/wav, X-Session-Key (optional)
/// Body: raw WAV bytes
/// Events are emitted as "voice-event" to all webview windows.
pub async fn send_audio_streaming(
    app: &AppHandle,
    base_url: &str,
    session_id: &str,
    profile_name: &str,
    session_key: Option<&str>,
    wav_bytes: Vec<u8>,
) -> Result<(), String> {
    let client = Client::new();
    let url = format!("{base_url}/audio?sessionId={session_id}");

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("audio/wav"));
    headers.insert(
        "X-Profile",
        HeaderValue::from_str(profile_name)
            .map_err(|e| format!("Invalid profile name header: {e}"))?,
    );
    if let Some(key) = session_key {
        if !key.is_empty() {
            headers.insert(
                "X-Session-Key",
                HeaderValue::from_str(key)
                    .map_err(|e| format!("Invalid session key header: {e}"))?,
            );
        }
    }

    let resp = client
        .post(&url)
        .headers(headers)
        .body(wav_bytes)
        .send()
        .await
        .map_err(|e| format!("Failed to send audio: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Audio upload failed ({status}): {text}"));
    }

    // Stream SSE events
    let mut parser = SseParser::new();
    let mut stream = resp.bytes_stream();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result
            .map_err(|e| format!("Stream read error: {e}"))?;
        let text = String::from_utf8_lossy(&chunk);
        let events = parser.feed(&text);

        for event in events {
            app.emit("voice-event", &event)
                .map_err(|e| format!("Failed to emit event: {e}"))?;
        }
    }

    Ok(())
}
