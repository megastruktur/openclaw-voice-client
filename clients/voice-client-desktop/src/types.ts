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

/** SSE event types streamed from POST /audio */
export type VoiceEventType = "user" | "openclaw" | "system";

export interface VoiceEventBase {
  type: VoiceEventType;
  timestamp: string;
}

export interface UserEvent extends VoiceEventBase {
  type: "user";
  text: string;
  confidence: number;
}

export interface OpenClawEvent extends VoiceEventBase {
  type: "openclaw";
  text: string;
  done: boolean;
}

export type SystemStatus = "transcribing" | "typing" | "done" | "error" | "empty_transcription" | "timeout" | "aborted";

export interface SystemEvent extends VoiceEventBase {
  type: "system";
  status: SystemStatus;
  message?: string;
}

export type VoiceEvent = UserEvent | OpenClawEvent | SystemEvent;
