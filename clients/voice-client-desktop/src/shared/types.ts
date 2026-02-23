/**
 * Shared types for Voice Client Desktop App
 */

export interface AppSettings {
  gatewayUrl: string;
  token: string;
  profileName: string;
  microphoneDeviceId?: string;
  pushToTalkHotkey?: string;
}

export interface SessionInfo {
  sessionId: string;
  profileName: string;
  createdAt: string;
  lastActivity: string;
  messageCount: number;
}

export interface ProfileInfo {
  name: string;
  allowed: boolean;
}

export interface TranscriptionResponse {
  transcription: {
    text: string;
    confidence: number;
  };
  response: {
    text: string;
  };
}

export interface SessionResponse {
  sessionId: string;
  createdAt: string;
  profileName: string;
}

export interface ConversationExchange {
  userText: string;
  assistantText: string;
  timestamp: number;
}
