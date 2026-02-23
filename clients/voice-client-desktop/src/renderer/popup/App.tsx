import React, { useState, useEffect } from 'react'
import { useAudio } from './useAudio'
import type { AppSettings, ConversationExchange } from '../../shared/types'
import './App.css'

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [lastExchange, setLastExchange] = useState<ConversationExchange | null>(
    null
  )
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { isRecording, startRecording, stopRecording, error: audioError } =
    useAudio()

  useEffect(() => {
    window.electronAPI.loadSettings().then((loadedSettings) => {
      setSettings(loadedSettings)

      if (loadedSettings.gatewayUrl && loadedSettings.profileName) {
        window.electronAPI
          .testConnection(loadedSettings.gatewayUrl)
          .then((result) => setConnected(result.success))
      }
    })
  }, [])

  const handleNewSession = async () => {
    if (!settings?.gatewayUrl || !settings?.profileName) return

    try {
      setError(null)
      const response = await window.electronAPI.createSession(
        settings.gatewayUrl,
        settings.profileName
      )
      setSessionId(response.sessionId)
      setLastExchange(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session')
    }
  }

  const handleMouseDown = () => {
    if (!connected || !sessionId || isProcessing) return
    startRecording()
  }

  const handleMouseUp = async () => {
    if (!isRecording || !settings || !sessionId) return

    const audioBlob = await stopRecording()
    if (!audioBlob) return

    try {
      setIsProcessing(true)
      setError(null)

      const audioBytes = new Uint8Array(await audioBlob.arrayBuffer())
      const response = await window.electronAPI.sendAudio(
        settings.gatewayUrl,
        sessionId,
        settings.profileName,
        settings.sessionKey,
        audioBytes
      )

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

  return (
    <div className="app">
      <div className="header">
        <h1>OpenClaw Voice</h1>
        <div className={`status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? '● Connected' : '○ Disconnected'}
        </div>
      </div>

      <div className="content">
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

        {(error || audioError) && (
          <div className="error">{error || audioError}</div>
        )}

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
        <button onClick={() => window.electronAPI.openSettings()}>
          Settings
        </button>
        <button
          className="quit-button"
          onClick={() => window.electronAPI.quit()}
        >
          Quit
        </button>
      </div>
    </div>
  )
}
