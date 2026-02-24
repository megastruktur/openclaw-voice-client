export interface AudioDevice {
  name: string;
  id: string;
  isDefault: boolean;
}

export interface AppSettings {
  gatewayUrl: string;
  token: string;
  profileName: string;
  sessionKey?: string;
  microphoneDeviceId?: string;
  pushToTalkHotkey?: string;
}

export interface SessionResponse {
  sessionId: string;
  createdAt: string;
  profileName: string;
}

export interface TranscriptionResult {
  text: string;
  confidence: number;
}

export interface AgentResponse {
  text: string;
}

export interface TranscriptionResponse {
  transcription: TranscriptionResult;
  response: AgentResponse;
}

export interface ConnectionResult {
  success: boolean;
  error?: string;
}
