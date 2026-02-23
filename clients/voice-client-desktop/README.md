# OpenClaw Voice Client Desktop

Electron-based desktop application for voice interaction with OpenClaw Gateway.

## Features

- **Tray-only Application**: Lives in system tray, no main window
- **Push-to-Talk**: Record audio by holding mouse button or hotkey
- **Real-time Transcription**: Uses Soniox STT via OpenClaw plugin
- **Agent Responses**: Get AI responses from OpenClaw agent
- **Session Management**: Create and manage conversation sessions
- **Secure Settings**: Token storage using OS keychain (Electron safeStorage)

## Architecture

```
┌─────────────────────────┐
│   System Tray Icon      │
│  Click → Popup Window   │
└─────────────────────────┘
            │
            ▼
┌─────────────────────────┐
│    Popup Window         │
│  - Mic Button (PTT)     │
│  - Last Exchange        │
│  - New Session          │
│  - Settings             │
└─────────────────────────┘
            │
            ▼
┌─────────────────────────┐
│  OpenClaw Voice Plugin  │
│  HTTP: /voice-client    │
│  - Audio → STT          │
│  - Agent Turn           │
│  - Response             │
└─────────────────────────┘
```

## Development

### Prerequisites

- Node.js 18+
- npm or pnpm

### Setup

```bash
cd clients/voice-client-desktop
npm install
```

### Run Development

```bash
npm run dev
```

### Build

```bash
# Build for current platform
npm run build

# Build directory (no installer)
npm run build:dir
```

## Configuration

Settings are managed through the Settings window:

1. **Gateway URL**: HTTP endpoint of voice-client plugin (default: `http://127.0.0.1:18790/voice-client`)
2. **Profile Name**: Your name for voice interactions (must be in plugin's allowed list)
3. **Token**: Optional authentication token (stored securely in OS keychain)
4. **Microphone**: Select audio input device
5. **Hotkey**: Global push-to-talk shortcut (e.g., `Ctrl+Space`)

## Usage

### First Time Setup

1. Start OpenClaw with voice-client plugin enabled
2. Launch the desktop app (tray icon appears)
3. Click Settings and configure:
   - Gateway URL
   - Profile name (must match plugin config)
4. Test connection
5. Save settings

### Using Voice Input

1. Click "New Session" to start a conversation
2. **Hold** the microphone button (or hotkey) while speaking
3. **Release** to send audio for processing
4. View transcription and agent response

### Keyboard Shortcuts

- **Global Hotkey** (configurable): Push-to-talk from anywhere
- **Mouse**: Hold mic button while speaking

## Project Structure

```
clients/voice-client-desktop/
├── package.json
├── vite.config.ts
├── src/
│   ├── main/               # Electron main process
│   │   ├── index.ts        # Entry point
│   │   ├── tray.ts         # System tray management
│   │   ├── ipc.ts          # IPC handlers
│   │   ├── store.ts        # Settings persistence
│   │   └── preload.ts      # Preload script
│   ├── renderer/           # React UI
│   │   ├── popup/          # Main popup window
│   │   │   ├── App.tsx
│   │   │   ├── App.css
│   │   │   ├── useAudio.ts # Audio recording hook
│   │   │   └── index.html
│   │   └── settings/       # Settings window
│   │       ├── Settings.tsx
│   │       ├── Settings.css
│   │       └── index.html
│   └── shared/             # Shared code
│       ├── api.ts          # API client
│       └── types.ts        # TypeScript types
└── assets/
    └── tray-icon.png       # Tray icon
```

## API Integration

The app communicates with the OpenClaw voice-client plugin via HTTP:

- **POST** `/voice-client/session/new` - Create session
- **POST** `/voice-client/audio?sessionId=<id>` - Send audio for processing
- **GET** `/voice-client/session?id=<id>` - Get session info
- **GET** `/voice-client/profiles` - List allowed profiles

## Security

- **Token Storage**: Uses Electron's `safeStorage` API (OS keychain)
  - macOS: Keychain
  - Windows: DPAPI
  - Linux: libsecret/kwallet
- **Context Isolation**: Renderer processes run in isolated context
- **No Node Integration**: Renderer has no direct Node.js access
- **IPC Bridge**: Secure communication via preload script

## Troubleshooting

### Connection Failed

- Verify OpenClaw is running
- Check Gateway URL in settings
- Ensure voice-client plugin is enabled
- Test connection from settings window

### Microphone Not Working

- Check browser permissions (Electron uses Chromium)
- Select correct microphone device in settings
- Ensure no other app is using the microphone

### Hotkey Not Working

- Check hotkey format (examples: `Ctrl+Space`, `Alt+T`)
- Ensure hotkey isn't used by another app
- Restart app after changing hotkey

## Platform Support

- **macOS**: Full support
- **Windows**: Full support
- **Linux**: Full support (requires libsecret for token storage)

## License

Part of the OpenClaw Voice Client project.
