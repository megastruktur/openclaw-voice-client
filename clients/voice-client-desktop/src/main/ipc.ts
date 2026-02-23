/**
 * IPC handlers for communication between main and renderer processes
 */

import { ipcMain } from 'electron'
import { loadSettings, saveSettings } from './store'
import type { AppSettings } from '../shared/types'

/**
 * Register all IPC handlers
 */
export function registerIpcHandlers(callbacks: {
  onOpenSettings: () => void
}): void {
  // Load settings
  ipcMain.handle('settings:load', () => {
    return loadSettings()
  })

  // Save settings
  ipcMain.handle('settings:save', (_event, settings: AppSettings) => {
    saveSettings(settings)
    return { success: true }
  })

  // Test connection
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

  // Open settings window
  ipcMain.on('window:open-settings', () => {
    callbacks.onOpenSettings()
  })
}
