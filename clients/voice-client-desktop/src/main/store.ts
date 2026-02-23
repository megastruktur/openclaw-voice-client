/**
 * Settings store using electron-store and safeStorage
 */

import Store from 'electron-store'
import { safeStorage } from 'electron'
import type { AppSettings } from '../shared/types'

interface StoreSchema {
  gatewayUrl: string
  encryptedToken: string
  profileName: string
  microphoneDeviceId?: string
  pushToTalkHotkey?: string
  sessionKey?: string
}

const store = new Store<StoreSchema>({
  defaults: {
    gatewayUrl: 'http://127.0.0.1:18790/voice-client',
    encryptedToken: '',
    profileName: '',
  },
})

/**
 * Load settings from store
 */
export function loadSettings(): AppSettings {
  const encryptedToken = store.get('encryptedToken', '')
  let token = ''

  if (encryptedToken && safeStorage.isEncryptionAvailable()) {
    try {
      const buffer = Buffer.from(encryptedToken, 'base64')
      token = safeStorage.decryptString(buffer)
    } catch (error) {
      console.error('Failed to decrypt token:', error)
    }
  }

  return {
    gatewayUrl: store.get('gatewayUrl'),
    token,
    profileName: store.get('profileName'),
    microphoneDeviceId: store.get('microphoneDeviceId'),
    sessionKey: store.get('sessionKey'),
    pushToTalkHotkey: store.get('pushToTalkHotkey'),
  }
}

/**
 * Save settings to store
 */
export function saveSettings(settings: AppSettings): void {
  // Encrypt token if available
  let encryptedToken = ''
  if (settings.token && safeStorage.isEncryptionAvailable()) {
    try {
      const buffer = safeStorage.encryptString(settings.token)
      encryptedToken = buffer.toString('base64')
    } catch (error) {
      console.error('Failed to encrypt token:', error)
    }
  }

  store.set('gatewayUrl', settings.gatewayUrl)
  store.set('encryptedToken', encryptedToken)
  store.set('profileName', settings.profileName)

  if (settings.sessionKey !== undefined) {
    store.set('sessionKey', settings.sessionKey)
  }

  if (settings.microphoneDeviceId !== undefined) {
    store.set('microphoneDeviceId', settings.microphoneDeviceId)
  }

  if (settings.pushToTalkHotkey !== undefined) {
    store.set('pushToTalkHotkey', settings.pushToTalkHotkey)
  }
}

/**
 * Clear all settings
 */
export function clearSettings(): void {
  store.clear()
}
