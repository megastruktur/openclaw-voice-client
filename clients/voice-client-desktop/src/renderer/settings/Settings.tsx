/**
 * Settings window component
 */

import React, { useState, useEffect } from 'react'
import type { AppSettings } from '../../shared/types'
import './Settings.css'

export function Settings() {
  const [settings, setSettings] = useState<AppSettings>({
    gatewayUrl: 'http://127.0.0.1:18790/voice-client',
    token: '',
    profileName: '',
    sessionKey: '',
    microphoneDeviceId: '',
    pushToTalkHotkey: '',
  })
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    success: boolean
    message: string
  } | null>(null)
  const [saved, setSaved] = useState(false)
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([])

  // Load settings on mount
  useEffect(() => {
    window.electronAPI.loadSettings().then((loadedSettings) => {
      setSettings(loadedSettings)
    })
  }, [])

  // Enumerate microphone devices after getting permission
  useEffect(() => {
    async function loadDevices() {
      try {
        // Request mic permission first so labels are populated
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach((t) => t.stop())

        const devices = await navigator.mediaDevices.enumerateDevices()
        const audioInputs = devices.filter((d) => d.kind === 'audioinput')
        setAudioDevices(audioInputs)
      } catch (err) {
        console.error('Failed to enumerate audio devices:', err)
      }
    }
    loadDevices()
  }, [])

  const handleChange = (field: keyof AppSettings, value: string) => {
    setSettings((prev) => ({ ...prev, [field]: value }))
    setSaved(false)
    setTestResult(null)
  }

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)

    try {
      const result = await window.electronAPI.testConnection(
        settings.gatewayUrl
      )

      if (result.success) {
        setTestResult({
          success: true,
          message: 'Connection successful!',
        })
      } else {
        setTestResult({
          success: false,
          message: result.error || `Failed with status ${result.status}`,
        })
      }
    } catch (error) {
      setTestResult({
        success: false,
        message:
          error instanceof Error ? error.message : 'Connection test failed',
      })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    try {
      await window.electronAPI.saveSettings(settings)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (error) {
      console.error('Failed to save settings:', error)
    }
  }

  return (
    <div className="settings">
      <div className="settings-header">
        <h1>Settings</h1>
      </div>

      <div className="settings-content">
        {/* Connection Settings */}
        <section className="settings-section">
          <h2>Connection</h2>

          <div className="form-group">
            <label htmlFor="gateway-url">Gateway URL</label>
            <input
              id="gateway-url"
              type="text"
              value={settings.gatewayUrl}
              onChange={(e) => handleChange('gatewayUrl', e.target.value)}
              placeholder="http://127.0.0.1:18790/voice-client"
            />
          </div>

          <div className="form-group">
            <label htmlFor="token">Token (Optional)</label>
            <input
              id="token"
              type="password"
              value={settings.token}
              onChange={(e) => handleChange('token', e.target.value)}
              placeholder="Enter gateway token"
            />
            <p className="form-hint">
              Token is stored securely using OS keychain
            </p>
          </div>

          <button
            className="test-button"
            onClick={handleTestConnection}
            disabled={testing || !settings.gatewayUrl}
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>

          {testResult && (
            <div
              className={`test-result ${testResult.success ? 'success' : 'error'}`}
            >
              {testResult.message}
            </div>
          )}
        </section>

        {/* Profile Settings */}
        <section className="settings-section">
          <h2>Profile</h2>

          <div className="form-group">
            <label htmlFor="profile-name">Profile Name</label>
            <input
              id="profile-name"
              type="text"
              value={settings.profileName}
              onChange={(e) => handleChange('profileName', e.target.value)}
              placeholder="Peter"
            />
            <p className="form-hint">
              Your name for voice interactions (must be in allowed list)
            </p>
          </div>

          <div className="form-group">
            <label htmlFor="session-key">Session Key (Optional)</label>
            <input
              id="session-key"
              type="text"
              value={settings.sessionKey || ''}
              onChange={(e) => handleChange('sessionKey', e.target.value)}
              placeholder="agent:main:main"
            />
            <p className="form-hint">
              Run 'openclaw sessions' on the server to find your session key (e.g. agent:main:main). This allows the voice agent to share memory and context with your main chat session.
            </p>
          </div>
        </section>

        {/* Audio Settings */}
        <section className="settings-section">
          <h2>Audio</h2>

          <div className="form-group">
            <label htmlFor="microphone">Microphone Device</label>
            <select
              id="microphone"
              value={settings.microphoneDeviceId || ''}
              onChange={(e) =>
                handleChange('microphoneDeviceId', e.target.value)
              }
            >
              <option value="">Default Microphone</option>
              {audioDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Microphone (${device.deviceId.slice(0, 8)})`}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* Hotkey Settings */}
        <section className="settings-section">
          <h2>Hotkey</h2>

          <div className="form-group">
            <label htmlFor="hotkey">Push-to-Talk Hotkey</label>
            <input
              id="hotkey"
              type="text"
              value={settings.pushToTalkHotkey || ''}
              onChange={(e) => handleChange('pushToTalkHotkey', e.target.value)}
              placeholder="Ctrl+Space"
            />
            <p className="form-hint">
              Examples: Ctrl+Space, Alt+T, CommandOrControl+Shift+V
            </p>
          </div>
        </section>
      </div>

      <div className="settings-footer">
        <button className="save-button" onClick={handleSave}>
          {saved ? '✓ Saved!' : 'Save'}
        </button>
      </div>
    </div>
  )
}
