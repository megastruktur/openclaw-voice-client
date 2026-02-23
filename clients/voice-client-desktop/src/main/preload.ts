import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, SessionResponse, TranscriptionResponse } from '../shared/types'

contextBridge.exposeInMainWorld('electronAPI', {
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings: AppSettings) =>
    ipcRenderer.invoke('settings:save', settings),

  testConnection: (url: string) => ipcRenderer.invoke('gateway:test', url),

  createSession: (baseUrl: string, profileName: string) =>
    ipcRenderer.invoke('api:create-session', baseUrl, profileName),

  sendAudio: (
    baseUrl: string,
    sessionId: string,
    profileName: string,
    sessionKey: string | undefined,
    audioData: Uint8Array
  ) =>
    ipcRenderer.invoke(
      'api:send-audio',
      baseUrl,
      sessionId,
      profileName,
      sessionKey,
      audioData
    ),

  closeWindow: () => ipcRenderer.send('window:close'),
  openSettings: () => ipcRenderer.send('window:open-settings'),
  quit: () => ipcRenderer.send('app:quit'),
})

export interface ElectronAPI {
  loadSettings: () => Promise<AppSettings>
  saveSettings: (settings: AppSettings) => Promise<{ success: boolean }>
  testConnection: (url: string) => Promise<{
    success: boolean
    status?: number
    error?: string
  }>
  createSession: (baseUrl: string, profileName: string) => Promise<SessionResponse>
  sendAudio: (
    baseUrl: string,
    sessionId: string,
    profileName: string,
    sessionKey: string | undefined,
    audioData: Uint8Array
  ) => Promise<TranscriptionResponse>
  closeWindow: () => void
  openSettings: () => void
  quit: () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
