/**
 * Voice Client Plugin Types
 */

/**
 * Plugin configuration from openclaw.json
 */
export interface VoiceClientConfig {
  enabled: boolean;
  sonioxApiKey: string;
  serve: {
    port: number;
    path: string;
    bind?: string;
  };
  profiles: {
    allowed: string[];
  };
}

/**
 * Voice client session state
 */
export interface VoiceClientSession {
  id: string; // OpenClaw session key
  createdAt: Date;
  lastActivity: Date;
  profileName: string;
  messages: SessionMessage[];
}

/**
 * Message in a session
 */
export interface SessionMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  audioUrl?: string; // For TTS playback
  timestamp: Date;
}

/**
 * Audio transcription request
 */
export interface TranscriptionRequest {
  audioBuffer: Buffer;
  profileName: string;
  sessionId?: string;
}

/**
 * Audio transcription response
 */
export interface TranscriptionResponse {
  text: string;
  confidence?: number;
}

/**
 * Session creation response
 */
export interface SessionResponse {
  sessionId: string;
  createdAt: string;
  profileName: string;
}

/**
 * Profile information
 */
export interface ProfileInfo {
  name: string;
  allowed: boolean;
}

/**
 * HTTP request context with authentication
 */
export interface AuthenticatedRequest {
  profileName: string;
  token: string;
}
