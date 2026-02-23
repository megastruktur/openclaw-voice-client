/**
 * API client for OpenClaw Voice Client Plugin
 */

import type {
  SessionResponse,
  SessionInfo,
  ProfileInfo,
  TranscriptionResponse,
} from './types'

export class VoiceClientAPI {
  private baseUrl: string
  private profileName: string
  private sessionKey?: string

  constructor(baseUrl: string, profileName: string, sessionKey?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.profileName = profileName
    this.sessionKey = sessionKey
  }

  /**
   * Test connection to the gateway
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/profiles`)
      return response.ok
    } catch (error) {
      return false
    }
  }

  /**
   * Get list of allowed profiles
   */
  async getProfiles(): Promise<ProfileInfo[]> {
    const response = await fetch(`${this.baseUrl}/profiles`)
    if (!response.ok) {
      throw new Error(`Failed to get profiles: ${response.statusText}`)
    }
    const data = await response.json()
    return data.profiles
  }

  /**
   * Create a new session
   */
  async createSession(): Promise<SessionResponse> {
    const response = await fetch(`${this.baseUrl}/session/new`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ profileName: this.profileName }),
    })

    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.statusText}`)
    }

    return response.json()
  }

  /**
   * Get session info
   */
  async getSession(sessionId: string): Promise<SessionInfo> {
    const response = await fetch(`${this.baseUrl}/session?id=${sessionId}`)
    if (!response.ok) {
      throw new Error(`Failed to get session: ${response.statusText}`)
    }
    return response.json()
  }

  /**
   * Send audio for transcription and agent response
   */
  async sendAudio(
    sessionId: string,
    audioBlob: Blob
  ): Promise<TranscriptionResponse> {
    const headers: Record<string, string> = {
      'X-Profile': this.profileName,
      'Content-Type': 'audio/wav',
    }

    // Add session key header if configured
    if (this.sessionKey) {
      headers['X-Session-Key'] = this.sessionKey
    }

    const response = await fetch(
      `${this.baseUrl}/audio?sessionId=${sessionId}`,
      {
        method: 'POST',
        headers,
        body: audioBlob,
      }
    )

    if (!response.ok) {
      throw new Error(`Failed to send audio: ${response.statusText}`)
    }

    return response.json()
  }
}
