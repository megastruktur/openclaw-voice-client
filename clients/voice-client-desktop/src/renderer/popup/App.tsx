/**
 * Popup window main component
 */

import React, { useState, useEffect } from 'react'
import { VoiceClientAPI } from '../../shared/api'
import { useAudio } from './useAudio'
import type { AppSettings, ConversationExchange } from '../../shared/types'
import './App.css'

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [api, setApi] = useState<VoiceClientAPI | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [lastExchange, setLastExchange] = useState<ConversationExchange | null>(
    null
  )
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { isRecording, startRecording, stopRecording, error: audioError } =
    useAudio()

  // Load settings on mount
  useEffect(() => {
    window.electronAPI.loadSettings().then((loadedSettings) => {
      setSettings(loadedSettings)

      if (loadedSettings.gatewayUrl && loadedSettings.profileName) {
        const apiClient = new VoiceClientAPI(
          loadedSettings.gatewayUrl,
          loadedSettings.profileName,
          loadedSettings.sessionKey
        )
        setApi(apiClient)

        // Test connection
        apiClient.testConnection().then(setConnected)
      }
    })
  }, [])

  // Create new session
  const handleNewSession = async () => {
    if (!api) return

    try {
      setError(null)
      const response = await api.createSession()
      setSessionId(response.sessionId)
      setLastExchange(null)
      console.log('New session created:', response.sessionId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session')
    }
  }

  // Handle push-to-talk button
  const handleMouseDown = () => {
    if (!connected || !sessionId || isProcessing) return
    startRecording()
  }

  const handleMouseUp = async () => {
    if (!isRecording || !api || !sessionId) return

    const audioBlob = await stopRecording()
    if (!audioBlob) return

    try {
      setIsProcessing(true)
      setError(null)

      const response = await api.sendAudio(sessionId, audioBlob)

      setLastExchange({
        userText: response.transcription.text,
        assistantText: response.response.text,
        timestamp: Date.now(),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process audio')
    } finally {
      setIsProcessing(false)
    }
  }

  // Open settings window
  const openSettings = () => {
    window.electronAPI.openSettings()
  }

  return (
    <div className="app">
      <div className="header">
        <h1>OpenClaw Voice</h1>
        <div className={`status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? '● Connected' : '○ Disconnected'}
        </div>
      </div>

      <div className="content">
        {/* Microphone button */}
        <div className="mic-container">
          <button
            className={`mic-button ${isRecording ? 'recording' : ''} ${
              isProcessing ? 'processing' : ''
            }`}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            disabled={!connected || !sessionId || isProcessing}
          >
            <div className="mic-icon">🎤</div>
            <div className="mic-label">
              {isRecording
                ? 'Release to send'
                : isProcessing
                  ? 'Processing...'
                  : 'Hold to speak'}
            </div>
          </button>
        </div>

        {/* Last exchange */}
        {lastExchange && (
          <div className="exchange">
            <div className="exchange-user">
              <strong>You:</strong> {lastExchange.userText}
            </div>
            <div className="exchange-assistant">
              <strong>MARC:</strong> {lastExchange.assistantText}
            </div>
          </div>
        )}

        {/* Error message */}
        {(error || audioError) && (
          <div className="error">{error || audioError}</div>
        )}

        {/* Session info */}
        {sessionId && (
          <div className="session-info">
            Session: {sessionId.substring(0, 12)}...
          </div>
        )}
      </div>

      <div className="footer">
        <button onClick={handleNewSession} disabled={!connected}>
          New Session
        </button>
        <button onClick={openSettings}>Settings</button>
      </div>
    </div>
  )
}
