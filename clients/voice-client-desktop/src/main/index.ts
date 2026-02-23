/**
 * Main process entry point
 */

import { app, BrowserWindow, globalShortcut } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createTray, showPopupNearTray, destroyTray } from './tray'
import { registerIpcHandlers } from './ipc'
import { loadSettings } from './store'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Disable hardware acceleration for better compatibility
app.disableHardwareAcceleration()

// The built directory structure:
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.js
process.env.DIST = path.join(__dirname, '../..')
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(process.env.DIST, '../public')

let popupWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let tray: ReturnType<typeof createTray> | null = null

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

/**
 * Get preload script path (handles both .js and .mjs extensions)
 */
function getPreloadPath(): string {
  const preloadMjs = path.join(__dirname, 'preload.mjs')
  const preloadJs = path.join(__dirname, 'preload.js')

  // Check which file exists (vite-plugin-electron can output .mjs)
  if (fs.existsSync(preloadMjs)) {
    return preloadMjs
  }
  return preloadJs
}

/**
 * Create popup window
 */
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

  // Hide instead of close on blur
  popupWindow.on('blur', () => {
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.hide()
    }
  })

  // Load popup HTML
  if (VITE_DEV_SERVER_URL) {
    popupWindow.loadURL(`${VITE_DEV_SERVER_URL}/src/renderer/popup/index.html`)
  } else {
    popupWindow.loadFile(path.join(process.env.DIST!, 'popup/index.html'))
  }

  return popupWindow
}

/**
 * Create settings window
 */
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
    event.preventDefault()
    if (settingsWindow) {
      settingsWindow.hide()
    }
  })

  // Load settings HTML
  if (VITE_DEV_SERVER_URL) {
    settingsWindow.loadURL(
      `${VITE_DEV_SERVER_URL}/src/renderer/settings/index.html`
    )
  } else {
    settingsWindow.loadFile(path.join(process.env.DIST!, 'settings/index.html'))
  }

  return settingsWindow
}

/**
 * Show popup window
 */
function showPopup(): void {
  if (!popupWindow || popupWindow.isDestroyed()) {
    createPopupWindow()
  }

  if (popupWindow && tray) {
    showPopupNearTray(popupWindow, tray)
  }
}

/**
 * Show settings window
 */
function showSettings(): void {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    createSettingsWindow()
  }

  settingsWindow?.show()
  settingsWindow?.focus()
}

/**
 * Quit application
 */
function quitApp(): void {
  destroyTray()
  globalShortcut.unregisterAll()
  app.quit()
}

/**
 * Register global hotkeys
 */
function registerHotkeys(): void {
  const settings = loadSettings()

  if (settings.pushToTalkHotkey) {
    try {
      globalShortcut.register(settings.pushToTalkHotkey, () => {
        // Send event to popup window
        if (popupWindow && !popupWindow.isDestroyed()) {
          popupWindow.webContents.send('hotkey:push-to-talk')
        }
      })
    } catch (error) {
      console.error('Failed to register hotkey:', error)
    }
  }
}

// App lifecycle
app.whenReady().then(() => {
  // Hide dock icon on macOS (tray-only app)
  if (process.platform === 'darwin') {
    try {
      app.dock.hide()
    } catch (error) {
      console.error('Failed to hide dock icon:', error)
    }
  }

  // Register IPC handlers
  registerIpcHandlers({
    onOpenSettings: showSettings,
  })

  // Create tray icon with error handling
  try {
    tray = createTray(showPopup, showSettings, quitApp)
  } catch (error) {
    console.error('Failed to create tray icon:', error)
    app.quit()
    return
  }

  // Create popup window (hidden initially)
  createPopupWindow()

  // Register hotkeys
  registerHotkeys()

  // Open DevTools in development
  if (!app.isPackaged) {
    popupWindow?.webContents.openDevTools({ mode: 'detach' })
  }
})

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked
  // (though dock should be hidden for tray-only app)
  if (BrowserWindow.getAllWindows().length === 0) {
    createPopupWindow()
  }
})

// Cleanup on quit
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
