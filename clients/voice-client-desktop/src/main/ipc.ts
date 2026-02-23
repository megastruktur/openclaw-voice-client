import { ipcMain } from 'electron'
import { loadSettings, saveSettings } from './store'
import type { AppSettings } from '../shared/types'

export function registerIpcHandlers(callbacks: {
  onOpenSettings: () => void
  onQuit: () => void
}): void {
  ipcMain.handle('settings:load', () => {
    return loadSettings()
  })

  ipcMain.handle('settings:save', (_event, settings: AppSettings) => {
    saveSettings(settings)
    return { success: true }
  })

  ipcMain.handle('gateway:test', async (_event, url: string) => {
    try {
      const response = await fetch(`${url}/profiles`)
      return { success: response.ok, status: response.status }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      }
    }
  })

  ipcMain.handle(
    'api:create-session',
    async (_event, baseUrl: string, profileName: string) => {
      const response = await fetch(`${baseUrl}/session/new`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileName }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${response.status}`)
      }
      return response.json()
    }
  )

  ipcMain.handle(
    'api:send-audio',
    async (
      _event,
      baseUrl: string,
      sessionId: string,
      profileName: string,
      sessionKey: string | undefined,
      audioData: Uint8Array
    ) => {
      const headers: Record<string, string> = {
        'X-Profile': profileName,
        'Content-Type': 'audio/webm',
      }
      if (sessionKey) {
        headers['X-Session-Key'] = sessionKey
      }

      const response = await fetch(
        `${baseUrl}/audio?sessionId=${encodeURIComponent(sessionId)}`,
        {
          method: 'POST',
          headers,
          body: Buffer.from(audioData),
        }
      )
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${response.status}`)
      }
      return response.json()
    }
  )

  ipcMain.on('window:open-settings', () => {
    callbacks.onOpenSettings()
  })

  ipcMain.on('app:quit', () => {
    callbacks.onQuit()
  })
}
