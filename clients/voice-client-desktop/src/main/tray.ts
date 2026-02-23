/**
 * System tray management
 */

import { app, Tray, Menu, nativeImage, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let tray: Tray | null = null

/**
 * Create system tray icon
 */
export function createTray(
  onShowPopup: () => void,
  onShowSettings: () => void,
  onQuit: () => void
): Tray {
  // Resolve icon path: packaged app uses resourcesPath, dev uses relative path
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'assets', 'tray-icon.png')
    : path.join(__dirname, '../../assets/tray-icon.png')

  let icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) {
    // Fallback: 16x16 transparent placeholder so app doesn't crash
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon.resize({ width: 16, height: 16 }))

  // macOS: ignore double click, single click opens popup
  if (process.platform === 'darwin') {
    tray.setIgnoreDoubleClickEvents(true)
  }

  tray.setToolTip('OpenClaw Voice Client')

  // Build context menu
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Voice Client',
      click: onShowPopup,
    },
    {
      type: 'separator',
    },
    {
      label: 'Settings',
      click: onShowSettings,
    },
    {
      type: 'separator',
    },
    {
      label: 'Quit',
      click: onQuit,
    },
  ])

  tray.setContextMenu(contextMenu)

  // Click on tray icon shows popup
  tray.on('click', () => {
    onShowPopup()
  })

  return tray
}

/**
 * Show popup window near tray icon
 */
export function showPopupNearTray(window: BrowserWindow, tray: Tray): void {
  const bounds = tray.getBounds()
  const windowBounds = window.getBounds()

  // Position window near tray icon
  let x = Math.round(bounds.x + bounds.width / 2 - windowBounds.width / 2)
  let y = Math.round(bounds.y + bounds.height + 4)

  // On macOS the menu bar is at the top, so position below the tray icon
  if (process.platform === 'darwin') {
    y = Math.round(bounds.y + bounds.height + 4)
  }

  window.setPosition(x, y, false)
  window.show()
  window.focus()
}

/**
 * Destroy tray icon
 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
