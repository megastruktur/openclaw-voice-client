/**
 * System tray management
 */

import { Tray, Menu, nativeImage, BrowserWindow } from 'electron'
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
  // Create tray icon (use a placeholder for now)
  const icon = nativeImage.createFromPath(
    path.join(__dirname, '../../assets/tray-icon.png')
  )
  tray = new Tray(icon.resize({ width: 16, height: 16 }))

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

  // Adjust if goes off screen
  if (process.platform === 'darwin') {
    y = Math.round(bounds.y - windowBounds.height - 4)
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
