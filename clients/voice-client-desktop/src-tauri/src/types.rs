use serde::{Deserialize, Serialize};

/// Audio input device for microphone selection
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub name: String,
    pub id: String,
    pub is_default: bool,
}

/// Application settings — persisted to store + keyring
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub gateway_url: String,
    pub token: String,
    pub profile_name: String,
    pub session_key: Option<String>,
    pub microphone_device_id: Option<String>,
    pub push_to_talk_hotkey: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            gateway_url: "http://127.0.0.1:18790/voice-client".to_string(),
            token: String::new(),
            profile_name: String::new(),
            session_key: None,
            microphone_device_id: None,
            push_to_talk_hotkey: None,
        }
    }
}

/// Response from POST /session/new
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionResponse {
    pub session_id: String,
    pub created_at: String,
    pub profile_name: String,
}

/// Transcription result nested in TranscriptionResponse
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionResult {
    pub text: String,
    pub confidence: f64,
}

/// Agent response nested in TranscriptionResponse
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentResponse {
    pub text: String,
}

/// Full response from POST /audio
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionResponse {
    pub transcription: TranscriptionResult,
    pub response: AgentResponse,
}

/// Result of test_connection
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionResult {
    pub success: bool,
    pub error: Option<String>,
}

/// Request body for POST /session/new
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub profile_name: String,
}
