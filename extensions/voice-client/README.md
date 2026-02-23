# Voice Client Plugin for OpenClaw

A channel plugin that enables voice-based interaction with OpenClaw Gateway through desktop applications.

## Overview

This plugin provides:
- **Speech-to-Text**: Transcribe audio using Soniox API
- **Text-to-Speech**: Generate audio responses using OpenClaw core TTS
- **Session Management**: Manage voice conversation sessions
- **HTTP Endpoints**: RESTful API for desktop clients

## Structure

```
extensions/voice-client/
├── openclaw.plugin.json      # Plugin manifest with config schema
├── index.ts                   # Plugin entry point
├── src/
│   ├── channel.ts             # Channel plugin implementation
│   ├── http-handler.ts        # HTTP endpoints (IMPLEMENTED)
│   ├── stt-service.ts         # Soniox STT integration (IMPLEMENTED)
│   ├── session-manager.ts     # Session state management (IMPLEMENTED)
│   └── types.ts               # TypeScript interfaces
├── package.json
└── tsconfig.json
```

## Configuration

Add to your `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "voice-client": {
        "config": {
          "enabled": true,
          "sonioxApiKey": "your-soniox-api-key",
          "serve": {
            "port": 18790,
            "path": "/voice-client"
          },
          "profiles": {
            "allowed": ["Peter", "Olga"]
          }
        }
      }
    }
  }
}
```

## Development Status

### ✅ Phase 1: Plugin Foundation (COMPLETE)

- [x] Plugin structure created
- [x] openclaw.plugin.json manifest
- [x] TypeScript types defined
- [x] Channel plugin skeleton
- [x] HTTP server with endpoints:
  - `POST /voice-client/audio` - Audio transcription + agent response
  - `GET /voice-client/session` - Get session info
  - `POST /voice-client/session/new` - Create new session
  - `GET /voice-client/profiles` - List allowed profiles
- [x] Soniox STT integration (`@soniox/node`)
- [x] Session manager implementation
- [x] Plugin lifecycle (start/stop) via `registerService`

### ✅ Phase 1.5: Agent Integration (COMPLETE)

- [x] Agent service module (`agent-service.ts`)
- [x] Integrated with OpenClaw embedded Pi agent
- [x] Conversation history tracking
- [x] Audio endpoint returns both transcription AND agent response
- [x] Session-based conversation context

### 🔲 Phase 2: Testing & TTS (Next)

- [ ] Test HTTP endpoints with curl
- [ ] Implement TTS response generation
- [ ] Add audio playback support
- [ ] Test end-to-end flow with real audio files

### 🔲 Phase 2: Electron Desktop Client

- [ ] Create Electron app structure
- [ ] Implement tray icon and UI
- [ ] Audio recording/playback
- [ ] Connect to plugin endpoints

### 🔲 Phase 3: Integration

- [ ] Full end-to-end testing
- [ ] Session persistence
- [ ] Error handling
- [ ] Security hardening

## API Endpoints

| Endpoint | Method | Description | Status |
|----------|--------|-------------|--------|
| `/voice-client/audio` | POST | Stream audio for transcription | ✅ Implemented |
| `/voice-client/session` | GET | Get current session info | ✅ Implemented |
| `/voice-client/session/new` | POST | Create new session | ✅ Implemented |
| `/voice-client/profiles` | GET | List allowed profiles | ✅ Implemented |

### POST /voice-client/audio?sessionId=<id>

Accepts audio data, transcribes it, generates agent response, and returns both.

**Headers:**
- `X-Profile: <profile-name>` (required)

**Query Parameters:**
- `sessionId` - Session ID (required)

**Request Body:** Raw audio data (WAV, MP3, etc.)

**Response:**
```json
{
  "transcription": {
    "text": "What's the weather today?",
    "confidence": 0.95
  },
  "response": {
    "text": "I'll check the weather for you..."
  }
}
```

### GET /voice-client/session

Get information about an existing session.

**Query Parameters:**
- `id` - Session ID (required)

**Response:**
```json
{
  "sessionId": "voice-1234567890-abc",
  "profileName": "Peter",
  "createdAt": "2026-02-23T16:00:00.000Z",
  "lastActivity": "2026-02-23T16:05:00.000Z",
  "messageCount": 3
}
```

### POST /voice-client/session/new

Create a new voice session.

**Request Body:**
```json
{
  "profileName": "Peter"
}
```

**Response:**
```json
{
  "sessionId": "voice-1234567890-abc",
  "createdAt": "2026-02-23T16:00:00.000Z",
  "profileName": "Peter"
}
```

### GET /voice-client/profiles

List all allowed profiles.

**Response:**
```json
{
  "profiles": [
    { "name": "Peter", "allowed": true },
    { "name": "Olga", "allowed": true }
  ]
}
```

## Dependencies

- `@soniox/node`: Official Soniox SDK for Node (STT)
- `openclaw`: OpenClaw plugin SDK

## Testing

```bash
# Build the plugin
npm run build

# Development mode (watch)
npm run dev
```

## License

Part of the OpenClaw project.
