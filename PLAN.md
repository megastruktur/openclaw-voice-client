# OpenClaw Voice Client — Architecture & Implementation Plan

## Overview

A thin-client desktop application (Electron) that connects to OpenClaw Gateway and enables voice-based interaction with AI agents. The client will be distributed as an **OpenClaw plugin** with a custom channel, making it extensible and commitable to the main OpenClaw repository.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Electron Desktop App                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ Tray Icon   │  │ Main Window  │  │ Settings Window       │  │
│  │ + Popup     │  │ (Chat UI)    │  │ (Connection config)   │  │
│  └──────┬──────┘  └──────┬───────┘  └───────────┬───────────┘  │
│         │                │                      │               │
│         └────────────────┴──────────────────────┘               │
│                          │                                      │
│                   WebSocket │ HTTP                              │
│                          │                                      │
└──────────────────────────┼──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OpenClaw Gateway                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              voice-client Plugin                         │   │
│  │  ┌───────────────┐  ┌───────────────┐  ┌─────────────┐  │   │
│  │  │ HTTP Endpoint │  │ STT Service   │  │ TTS Service │  │   │
│  │  │ /voice-client │  │ (Soniox API)  │  │ (core TTS)  │  │   │
│  │  └───────┬───────┘  └───────┬───────┘  └──────┬──────┘  │   │
│  │          │                  │                 │          │   │
│  │          └──────────────────┴─────────────────┘          │   │
│  │                             │                            │   │
│  │                             ▼                            │   │
│  │                    Agent Turn Execution                  │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Key Principle: Thin Client

**All requests go FROM OpenClaw, all responses come TO OpenClaw.**

- Electron app is a UI shell only
- No direct external API calls from the client
- STT (Soniox), TTS, and AI all handled by OpenClaw plugin
- Client only speaks to Gateway (WebSocket + HTTP)

## Components

### 1. OpenClaw Plugin: `voice-client`

Location: `extensions/voice-client/`

```
extensions/voice-client/
├── openclaw.plugin.json      # Plugin manifest
├── index.ts                   # Plugin entry point
├── src/
│   ├── channel.ts             # Channel plugin implementation
│   ├── http-handler.ts        # HTTP endpoints for client
│   ├── stt-service.ts         # Soniox integration
│   ├── session-manager.ts     # Session state management
│   └── types.ts               # TypeScript types
├── package.json
└── tsconfig.json
```

### 2. Electron Desktop App

Location: `clients/voice-client-desktop/`

```
clients/voice-client-desktop/
├── package.json
├── electron-builder.yml
├── src/
│   ├── main/
│   │   ├── index.ts           # Main process
│   │   ├── tray.ts            # System tray
│   │   ├── ipc.ts             # IPC handlers
│   │   └── window.ts          # Window management
│   ├── renderer/
│   │   ├── index.html
│   │   ├── App.tsx            # React app
│   │   ├── Chat.tsx           # Chat UI
│   │   ├── Settings.tsx       # Settings page
│   │   └── hooks/
│   │       ├── useConnection.ts
│   │       └── useAudio.ts
│   └── shared/
│       ├── api.ts             # Gateway API client
│       └── types.ts
└── assets/
    └── icon.png
```

## Data Flow

### User Speaks → Response

```
1. User presses Push-to-Talk (or clicks button)
2. Electron app starts recording audio
3. Audio streamed to Gateway via HTTP POST /voice-client/audio
4. Plugin sends audio to Soniox API → text
5. Plugin creates agent turn with transcribed text
6. Agent processes → generates response
7. Plugin uses core TTS → audio
8. Audio streamed back to client via WebSocket
9. Electron app plays audio
```

### New Session Flow

```
1. User clicks "New Session" button
2. Electron sends POST /voice-client/session/new
3. Plugin requests new session from OpenClaw
4. Plugin returns session ID immediately (pre-provisioned)
5. User can start speaking immediately
6. Session is "activated" on first message
```

## Plugin Implementation Details

### Plugin Manifest (`openclaw.plugin.json`)

```json
{
  "id": "voice-client",
  "name": "Voice Client",
  "description": "Desktop voice client channel for OpenClaw",
  "channels": ["voice-client"],
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "enabled": { "type": "boolean" },
      "sonioxApiKey": { "type": "string" },
      "serve": {
        "type": "object",
        "properties": {
          "port": { "type": "integer", "default": 18790 },
          "path": { "type": "string", "default": "/voice-client" }
        }
      },
      "inboundPolicy": {
        "type": "string",
        "enum": ["disabled", "token"],
        "default": "token"
      }
    }
  },
  "uiHints": {
    "sonioxApiKey": {
      "label": "Soniox API Key",
      "sensitive": true
    },
    "serve.port": {
      "label": "HTTP Port"
    }
  }
}
```

### Channel Plugin Structure

```typescript
import type { ChannelPlugin, OpenClawPluginApi } from "openclaw/plugin-sdk";

const voiceClientPlugin: ChannelPlugin = {
  id: "voice-client",
  meta: {
    id: "voice-client",
    label: "Voice Client",
    selectionLabel: "Voice Client (Desktop)",
    docsPath: "/channels/voice-client",
    blurb: "Desktop voice assistant client",
  },
  capabilities: {
    chatTypes: ["direct"],
    reactions: false,
    threads: false,
    media: true,  // audio
    polls: false,
    nativeCommands: false,
    blockStreaming: false,
  },
  config: {
    listAccountIds: (cfg) => [...],
    resolveAccount: (cfg, accountId) => {...},
    // ...
  },
  outbound: {
    deliveryMode: "direct",
    sendText: async (params) => {...},
    sendMedia: async (params) => {...},
  },
};
```

### HTTP Endpoints (Plugin registers)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/voice-client/audio` | POST | Stream audio for transcription |
| `/voice-client/session` | GET | Get current session info |
| `/voice-client/session/new` | POST | Create new session |
| `/voice-client/settings` | GET/PUT | Client settings (profile name) |

### STT Integration (Soniox)

```typescript
// stt-service.ts
export async function transcribeAudio(
  audioBuffer: Buffer,
  config: { apiKey: string; languageHints?: string[] }
): Promise<string> {
  // Soniox real-time API
  // https://soniox.com/docs/stt/api-reference/websocket-api
  
  const client = new SonioxClient({ apiKey: config.apiKey });
  
  // For pre-recorded audio, use async API
  // For streaming, use WebSocket API
  
  return transcribedText;
}
```

## Electron App Implementation

### Tray + Popup UI

```
┌─────────────────────────────────────────┐
│  [🎤] OpenClaw Voice                    │  <- Tray menu
├─────────────────────────────────────────┤
│  ┌─────────────────────────────────┐   │
│  │                                 │   │
│  │    [🎤 Hold to speak]           │   │  <- Main popup
│  │                                 │   │
│  │    Status: Connected            │   │
│  │    Session: abc123...           │   │
│  │                                 │   │
│  └─────────────────────────────────┘   │
│                                         │
│  [New Session]  [Settings]  [History]  │
└─────────────────────────────────────────┘
```

### Settings Window

```
┌─────────────────────────────────────────┐
│  Settings                          [×]  │
├─────────────────────────────────────────┤
│                                         │
│  Connection                             │
│  ┌─────────────────────────────────┐   │
│  │ Gateway URL: [ws://192.168.1.100:18789] │
│  │ Token: [******************************] │
│  │                                  │   │
│  │ Status: ● Connected              │   │
│  └─────────────────────────────────┘   │
│                                         │
│  Profile                                │
│  ┌─────────────────────────────────┐   │
│  │ Name: [Peter              ]     │   │
│  │ (TBD: validation/security)      │   │
│  └─────────────────────────────────┘   │
│                                         │
│  Audio                                  │
│  ┌─────────────────────────────────┐   │
│  │ Input: [Default Microphone  ▼]  │   │
│  │ Output: [Default Speakers   ▼]  │   │
│  └─────────────────────────────────┘   │
│                                         │
│  Hotkey                                 │
│  ┌─────────────────────────────────┐   │
│  │ Push-to-talk: [Ctrl + Space]    │   │
│  └─────────────────────────────────┘   │
│                                         │
│           [Save]  [Cancel]              │
└─────────────────────────────────────────┘
```

### History Window (Current Session Only)

```
┌─────────────────────────────────────────┐
│  Session History                   [×]  │
├─────────────────────────────────────────┤
│                                         │
│  You: What's the weather?               │
│  ─────────────────────────────────      │
│  MARC: Currently -5°C in Minsk...       │
│        [🔊 Play]                        │
│                                         │
│  You: Remind me to call mom tomorrow    │
│  ─────────────────────────────────      │
│  MARC: Done. Reminder set for...        │
│                                         │
│  [Clear History]                        │
└─────────────────────────────────────────┘
```

## Security & API Keys (Reviewed by Claude Code Opus 4.6)

### 1. API Key Storage

**Gateway Token in Electron: Use `safeStorage` + `electron-store`**

`electron-store` with encryption alone is insufficient — it uses a key derivable from source code.

**Solution**: Use Electron's built-in `safeStorage` (OS keychain integration):
- Linux: libsecret/kwallet
- macOS: Keychain
- Windows: DPAPI

```typescript
import { safeStorage } from 'electron';
import Store from 'electron-store';

const store = new Store();

function saveToken(token: string) {
  const encrypted = safeStorage.encryptString(token);
  store.set('gatewayToken', encrypted.toString('base64'));
}

function loadToken(): string {
  const raw = store.get('gatewayToken') as string;
  return safeStorage.decryptString(Buffer.from(raw, 'base64'));
}
```

**Soniox API key**: Stored in OpenClaw config (server-side) — already secure.

### 2. Client Authentication

**Bearer token on all `/voice-client/*` routes.**

- Gateway generates random token (32+ bytes) on first client registration
- Client sends `Authorization: Bearer <token>` on every request
- Middleware validates before handler runs
- **Token rotation**: Regenerate on explicit user action ("Reset Token" button), not timer
- **Rate limiting**: Optional for LAN; recommended if WAN-exposed

### 3. Profile Validation

**Per-profile tokens + allowlist (proportionate security for family setup).**

```json
// openclaw.json
{
  "plugins": {
    "entries": {
      "voice-client": {
        "config": {
          "profiles": {
            "allowed": ["Peter", "Olga"],
            "tokens": {
              "Peter": "<generated-token-1>",
              "Olga": "<generated-token-2>"
            }
          }
        }
      }
    }
  }
}
```

- Client sends `X-Profile: <name>` header
- Gateway validates profile is in allowlist
- Each profile has its own token → binds identity to token
- Profile name becomes a dropdown (from `GET /voice-client/profiles`), not free text

### 4. Transport Security

**LAN (default)**: TLS is nice-to-have, not critical.

**WAN (Tailscale, reverse proxy)**: TLS mandatory.

**Implementation**:
- Design WebSocket/HTTP clients to accept `wss://`/`https://` URLs
- Default to unencrypted for LAN MVP
- Support TLS via config change, not code change

### Summary

| Area | Solution | Effort |
|------|----------|--------|
| Token storage | `safeStorage` + `electron-store` | Low |
| Endpoint auth | Bearer token middleware | Low |
| Profile validation | Per-profile tokens + allowlist | Medium |
| TLS | Skip for LAN MVP; support via URL scheme | Low |

## Session Management

### Session State (stored in plugin)

```typescript
interface VoiceClientSession {
  id: string;           // OpenClaw session key
  createdAt: Date;
  lastActivity: Date;
  profileName: string;  // User-provided name
  messages: Message[];  // Current session only
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  audioUrl?: string;    // For TTS playback
  timestamp: Date;
}
```

### Session Lifecycle

1. **App starts** → Request current session from Gateway
2. **User clicks "New Session"** → Request new session (pre-provisioned)
3. **User speaks** → Message sent to current session
4. **App closes** → Session persists on server, history cleared on client

## Dependencies

### Plugin (OpenClaw side)

```json
{
  "dependencies": {
    "@soniox/speech-to-text": "^1.0.0"
  }
}
```

### Electron App

```json
{
  "dependencies": {
    "electron": "^33.0.0",
    "react": "^19.0.0",
    "electron-store": "^10.0.0"
  },
  "devDependencies": {
    "electron-builder": "^25.0.0",
    "typescript": "^5.0.0",
    "vite": "^6.0.0"
  }
}
```

## Implementation Order

### Phase 1: Plugin Foundation (1-2 days)
1. Create plugin structure in `extensions/voice-client/`
2. Implement basic channel plugin (stub methods)
3. Add HTTP endpoints for audio/session
4. Integrate Soniox STT
5. Test with curl/Postman

### Phase 2: Electron MVP (2-3 days)
1. Create Electron project structure
2. Implement tray icon + popup
3. Add settings window
4. Connect to Gateway HTTP API
5. Basic audio recording/playback

### Phase 3: Integration (1-2 days)
1. Connect Electron to plugin endpoints
2. Session management
3. History display
4. Error handling

### Phase 4: Polish (1 day)
1. Hotkey support
2. Audio device selection
3. UI refinements
4. Testing on Windows/macOS

## Profile Management

### Profile Configuration (Server-side)

```json
// openclaw.json
{
  "plugins": {
    "entries": {
      "voice-client": {
        "config": {
          "profiles": {
            "allowed": ["Peter", "Olga"]
          }
        }
      }
    }
  }
}
```

### Client Flow

1. Client connects → `GET /voice-client/profiles` → receives list of allowed profiles
2. User selects profile from dropdown
3. Client receives token bound to that profile
4. All subsequent requests include `Authorization: Bearer <token>` and `X-Profile: <name>`

## Open Questions (Resolved)

1. **Real-time streaming vs batch?**
   - **Decision**: Start with batch, add streaming later
   - Soniox supports both; batch is simpler for MVP

2. **TTS playback method?**
   - **Decision**: Wait for complete audio (simpler), stream later
   - Streaming requires more complex buffering

3. **Error handling?**
   - Network disconnection → Show reconnect UI, auto-retry
   - STT failure → Display error, allow retry
   - Agent timeout → Show timeout message, allow retry

1. **Plugin**: `extensions/voice-client/` — ready for merge into OpenClaw repo
2. **Electron App**: `clients/voice-client-desktop/` — installable desktop app
3. **Documentation**: Plugin docs + user guide
4. **Config**: Example configuration in `openclaw.json`

## Next Steps

1. ✅ Research complete
2. ⬜ Create plugin skeleton
3. ⬜ Implement STT service
4. ⬜ Create Electron app
5. ⬜ Integration testing
6. ⬜ Security review with Claude Code Opus 4.6

---

*Created: 2026-02-23*
*Author: MARC-7 + Peter*
