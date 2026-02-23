/**
 * Preload script - exposes safe IPC methods to renderer
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings } from '../shared/types'

// Expose protected methods to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Settings
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings: AppSettings) =>
    ipcRenderer.invoke('settings:save', settings),

  // Gateway connection test
  testConnection: (url: string) => ipcRenderer.invoke('gateway:test', url),

  // Window controls
  closeWindow: () => ipcRenderer.send('window:close'),
  openSettings: () => ipcRenderer.send('window:open-settings'),
})

// Type definitions for window.electronAPI
export interface ElectronAPI {
  loadSettings: () => Promise<AppSettings>
  saveSettings: (settings: AppSettings) => Promise<{ success: boolean }>
  testConnection: (url: string) => Promise<{
    success: boolean
    status?: number
    error?: string
  }>
  closeWindow: () => void
  openSettings: () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
