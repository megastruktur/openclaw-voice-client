import { app, BrowserWindow, globalShortcut, systemPreferences } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createTray, showPopupNearTray, destroyTray } from './tray'
import { registerIpcHandlers } from './ipc'
import { loadSettings } from './store'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

app.disableHardwareAcceleration()

process.env.DIST = path.join(__dirname, '..', 'dist')
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(process.env.DIST, '../public')

let popupWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let tray: ReturnType<typeof createTray> | null = null
let isQuitting = false

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function getPreloadPath(): string {
  const preloadMjs = path.join(__dirname, 'preload.mjs')
  const preloadJs = path.join(__dirname, 'preload.js')

  if (fs.existsSync(preloadMjs)) {
    return preloadMjs
  }
  return preloadJs
}

function createPopupWindow(): BrowserWindow {
  popupWindow = new BrowserWindow({
    width: 320,
    height: 480,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  popupWindow.on('blur', () => {
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.hide()
    }
  })

  if (VITE_DEV_SERVER_URL) {
    popupWindow.loadURL(`${VITE_DEV_SERVER_URL}/src/renderer/popup/index.html`)
  } else {
    popupWindow.loadFile(
      path.join(process.env.DIST!, 'src/renderer/popup/index.html')
    )
  }

  return popupWindow
}

function createSettingsWindow(): BrowserWindow {
  settingsWindow = new BrowserWindow({
    width: 500,
    height: 600,
    show: false,
    resizable: false,
    title: 'OpenClaw Voice - Settings',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  settingsWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      settingsWindow?.hide()
    }
  })

  if (VITE_DEV_SERVER_URL) {
    settingsWindow.loadURL(
      `${VITE_DEV_SERVER_URL}/src/renderer/settings/index.html`
    )
  } else {
    settingsWindow.loadFile(
      path.join(process.env.DIST!, 'src/renderer/settings/index.html')
    )
  }

  return settingsWindow
}

function showPopup(): void {
  if (!popupWindow || popupWindow.isDestroyed()) {
    createPopupWindow()
  }

  if (popupWindow && tray) {
    showPopupNearTray(popupWindow, tray)
  }
}

function showSettings(): void {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    createSettingsWindow()
  }

  settingsWindow?.show()
  settingsWindow?.focus()
}

function quitApp(): void {
  isQuitting = true
  destroyTray()
  globalShortcut.unregisterAll()

  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.destroy()
    }
  })

  app.quit()
}

function registerHotkeys(): void {
  const settings = loadSettings()

  if (settings.pushToTalkHotkey) {
    try {
      globalShortcut.register(settings.pushToTalkHotkey, () => {
        if (popupWindow && !popupWindow.isDestroyed()) {
          popupWindow.webContents.send('hotkey:push-to-talk')
        }
      })
    } catch (error) {
      console.error('Failed to register hotkey:', error)
    }
  }
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    try {
      app.dock.hide()
    } catch (error) {
      console.error('Failed to hide dock icon:', error)
    }
  }

  // Request microphone permission on macOS before creating windows
  if (process.platform === 'darwin') {
    const micStatus = systemPreferences.getMediaAccessStatus('microphone')
    console.log(`[voice-client] Microphone permission status: ${micStatus}`)
    if (micStatus !== 'granted') {
      const granted = await systemPreferences.askForMediaAccess('microphone')
      console.log(`[voice-client] Microphone permission ${granted ? 'granted' : 'denied'}`)
    }
  }

  registerIpcHandlers({
    onOpenSettings: showSettings,
    onQuit: quitApp,
  })

  try {
    tray = createTray(showPopup, showSettings, quitApp)
  } catch (error) {
    console.error('Failed to create tray icon:', error)
    app.quit()
    return
  }

  createPopupWindow()
  registerHotkeys()

  if (!app.isPackaged) {
    popupWindow?.webContents.openDevTools({ mode: 'detach' })
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
