import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "node:http";
import type { VoiceClientConfig } from "../types.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk";

// --- Mock dependencies BEFORE importing the module under test ---

vi.mock("../stt-service.js", () => ({
  transcribeAudio: vi.fn(),
}));

vi.mock("../agent-service.js", () => ({
  generateAgentResponseStreaming: vi.fn(),
}));

vi.mock("../session-manager.js", () => ({
  createSession: vi.fn(),
  getSession: vi.fn(),
  addMessage: vi.fn(),
  getSessionMessages: vi.fn(),
}));

// We do NOT mock sse.ts — we want the real SSE formatting to verify wire output.

import { VoiceClientHttpServer } from "../http-handler.js";
import { transcribeAudio } from "../stt-service.js";
import { generateAgentResponseStreaming } from "../agent-service.js";
import { createSession, getSession, addMessage, getSessionMessages } from "../session-manager.js";

const mockedTranscribe = vi.mocked(transcribeAudio);
const mockedStreaming = vi.mocked(generateAgentResponseStreaming);
const mockedGetSession = vi.mocked(getSession);
const mockedAddMessage = vi.mocked(addMessage);
const mockedGetSessionMessages = vi.mocked(getSessionMessages);
const mockedCreateSession = vi.mocked(createSession);

// --- Helpers ---

const TEST_CONFIG: VoiceClientConfig = {
  enabled: true,
  sonioxApiKey: "test-soniox-key",
  serve: { port: 0, path: "/voice-client", bind: "127.0.0.1" },
  profiles: { allowed: ["Alice", "Bob"] },
};

const TEST_CORE_CONFIG = {} as OpenClawConfig;

function makeServer(): { server: VoiceClientHttpServer; baseUrl: string } {
  const server = new VoiceClientHttpServer(TEST_CONFIG, TEST_CORE_CONFIG);
  return { server, baseUrl: "" }; // baseUrl set after start
}

async function startServer(server: VoiceClientHttpServer): Promise<string> {
  const url = await server.start();
  return url; // e.g. "http://127.0.0.1:PORT/voice-client"
}

function request(
  url: string,
  options: http.RequestOptions,
  body?: Buffer | string
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf-8"),
        });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// --- Tests ---

describe("VoiceClientHttpServer", () => {
  let server: VoiceClientHttpServer;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Use port 0 for random available port
    server = new VoiceClientHttpServer(
      { ...TEST_CONFIG, serve: { ...TEST_CONFIG.serve, port: 0 } },
      TEST_CORE_CONFIG
    );
    baseUrl = await startServer(server);
  });

  afterEach(async () => {
    await server.stop();
  });

  describe("POST /audio - validation errors (JSON, before SSE)", () => {
    it("should return 400 JSON when X-Profile header is missing", async () => {
      const res = await request(`${baseUrl}/audio?sessionId=s1`, {
        method: "POST",
      });

      expect(res.status).toBe(400);
      expect(JSON.parse(res.body)).toEqual({ error: "X-Profile header required" });
    });

    it("should return 403 JSON when profile is not allowed", async () => {
      const res = await request(`${baseUrl}/audio?sessionId=s1`, {
        method: "POST",
        headers: { "X-Profile": "UnknownUser" },
      });

      expect(res.status).toBe(403);
      expect(JSON.parse(res.body)).toEqual({ error: "Profile not allowed" });
    });

    it("should return 400 JSON when sessionId query param is missing", async () => {
      const res = await request(`${baseUrl}/audio`, {
        method: "POST",
        headers: { "X-Profile": "Alice" },
      });

      expect(res.status).toBe(400);
      expect(JSON.parse(res.body)).toEqual({ error: "sessionId query parameter required" });
    });

    it("should return 404 JSON when session does not exist", async () => {
      mockedGetSession.mockReturnValue(undefined);

      const res = await request(`${baseUrl}/audio?sessionId=nonexistent`, {
        method: "POST",
        headers: { "X-Profile": "Alice" },
      });

      expect(res.status).toBe(404);
      expect(JSON.parse(res.body)).toEqual({ error: "Session not found" });
    });
  });

  describe("POST /audio - SSE happy path", () => {
    it("should stream system:transcribing → user → system:typing → openclaw → system:done", async () => {
      // Setup mocks
      mockedGetSession.mockReturnValue({
        id: "s1",
        profileName: "Alice",
        createdAt: new Date(),
        lastActivity: new Date(),
        messages: [],
      });
      mockedGetSessionMessages.mockReturnValue([]);
      mockedTranscribe.mockResolvedValue({
        text: "Hello world",
        confidence: 0.95,
      });
      mockedStreaming.mockImplementation(async (_params, onToken) => {
        onToken("Agent ", false);
        onToken("says ", false);
        onToken("hi", false);
        onToken("", true);
        return { text: "Agent says hi" };
      });

      const wavHeader = Buffer.alloc(44); // minimal WAV-like buffer
      const res = await request(`${baseUrl}/audio?sessionId=s1`, {
        method: "POST",
        headers: { "X-Profile": "Alice", "Content-Type": "audio/wav" },
      }, wavHeader);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("text/event-stream");
      expect(res.headers["cache-control"]).toBe("no-cache");

      // Parse SSE events from body
      const events = parseSSEEvents(res.body);

      // With streaming: transcribing, user, typing, 3x openclaw deltas, 1x openclaw done, system:done = 8 events
      expect(events.length).toBeGreaterThanOrEqual(8);

      // Event 1: system:transcribing
      expect(events[0].event).toBe("system");
      expect(events[0].data.type).toBe("system");
      expect(events[0].data.status).toBe("transcribing");

      // Event 2: user
      expect(events[1].event).toBe("user");
      expect(events[1].data.type).toBe("user");
      expect(events[1].data.text).toBe("Hello world");
      expect(events[1].data.confidence).toBe(0.95);

      // Event 3: system:typing
      expect(events[2].event).toBe("system");
      expect(events[2].data.status).toBe("typing");

      // Events 4-6: openclaw deltas (done=false)
      const openclawEvents = events.filter((e) => e.event === "openclaw");
      expect(openclawEvents.length).toBe(4); // 3 deltas + 1 done

      expect(openclawEvents[0].data.text).toBe("Agent ");
      expect(openclawEvents[0].data.done).toBe(false);
      expect(openclawEvents[1].data.text).toBe("says ");
      expect(openclawEvents[1].data.done).toBe(false);
      expect(openclawEvents[2].data.text).toBe("hi");
      expect(openclawEvents[2].data.done).toBe(false);

      // Event 7: openclaw done signal
      expect(openclawEvents[3].data.text).toBe("");
      expect(openclawEvents[3].data.done).toBe(true);

      // Last event: system:done
      const lastEvent = events[events.length - 1];
      expect(lastEvent.event).toBe("system");
      expect(lastEvent.data.status).toBe("done");
    });

    it("should emit system:empty_transcription and close when text is empty", async () => {
      mockedGetSession.mockReturnValue({
        id: "s1",
        profileName: "Alice",
        createdAt: new Date(),
        lastActivity: new Date(),
        messages: [],
      });
      mockedTranscribe.mockResolvedValue({ text: "", confidence: 0 });

      const res = await request(`${baseUrl}/audio?sessionId=s1`, {
        method: "POST",
        headers: { "X-Profile": "Alice" },
      }, Buffer.alloc(10));

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("text/event-stream");

      const events = parseSSEEvents(res.body);

      // system:transcribing → user (empty text) → system:empty_transcription
      expect(events.some((e) => e.data.status === "transcribing")).toBe(true);
      expect(events.some((e) => e.data.type === "user" && e.data.text === "")).toBe(true);
      expect(events.some((e) => e.data.status === "empty_transcription")).toBe(true);
      // Should NOT have typing or done
      expect(events.some((e) => e.data.status === "typing")).toBe(false);
      expect(events.some((e) => e.data.status === "done")).toBe(false);
    });
  });

  describe("POST /audio - SSE error paths", () => {
    it("should emit system:error when agent returns an error", async () => {
      mockedGetSession.mockReturnValue({
        id: "s1",
        profileName: "Alice",
        createdAt: new Date(),
        lastActivity: new Date(),
        messages: [],
      });
      mockedGetSessionMessages.mockReturnValue([]);
      mockedTranscribe.mockResolvedValue({ text: "test", confidence: 0.9 });
      mockedStreaming.mockResolvedValue({ text: null, error: "Agent exploded" });

      const res = await request(`${baseUrl}/audio?sessionId=s1`, {
        method: "POST",
        headers: { "X-Profile": "Alice" },
      }, Buffer.alloc(10));

      expect(res.status).toBe(200);
      const events = parseSSEEvents(res.body);

      const errorEvent = events.find((e) => e.data.status === "error");
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.data.message).toBe("Agent exploded");

      // Should NOT have system:done
      expect(events.some((e) => e.data.status === "done")).toBe(false);
    });

    it("should emit system:error when transcription throws", async () => {
      mockedGetSession.mockReturnValue({
        id: "s1",
        profileName: "Alice",
        createdAt: new Date(),
        lastActivity: new Date(),
        messages: [],
      });
      mockedTranscribe.mockRejectedValue(new Error("Soniox down"));

      const res = await request(`${baseUrl}/audio?sessionId=s1`, {
        method: "POST",
        headers: { "X-Profile": "Alice" },
      }, Buffer.alloc(10));

      // SSE headers already sent, so status is 200
      expect(res.status).toBe(200);
      const events = parseSSEEvents(res.body);

      const errorEvent = events.find((e) => e.data.status === "error");
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.data.message).toContain("Soniox down");
    });
  });

  describe("POST /audio - session message tracking", () => {
    it("should call addMessage for user and assistant messages", async () => {
      mockedGetSession.mockReturnValue({
        id: "s1",
        profileName: "Alice",
        createdAt: new Date(),
        lastActivity: new Date(),
        messages: [],
      });
      mockedGetSessionMessages.mockReturnValue([]);
      mockedTranscribe.mockResolvedValue({ text: "Hi", confidence: 0.9 });
      mockedStreaming.mockImplementation(async (_params, onToken) => {
        onToken("Hello back", false);
        onToken("", true);
        return { text: "Hello back" };
      });

      await request(`${baseUrl}/audio?sessionId=s1`, {
        method: "POST",
        headers: { "X-Profile": "Alice" },
      }, Buffer.alloc(10));

      // User message
      expect(mockedAddMessage).toHaveBeenCalledTimes(2);

      const userCall = mockedAddMessage.mock.calls[0];
      expect(userCall[0]).toBe("s1");
      expect(userCall[1].role).toBe("user");
      expect(userCall[1].content).toBe("Hi");

      // Assistant message
      const assistantCall = mockedAddMessage.mock.calls[1];
      expect(assistantCall[0]).toBe("s1");
      expect(assistantCall[1].role).toBe("assistant");
      expect(assistantCall[1].content).toBe("Hello back");
    });
  });

  describe("GET /session", () => {
    it("should return 400 when id param is missing", async () => {
      const res = await request(`${baseUrl}/session`, { method: "GET" });
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body)).toEqual({ error: "Session ID required" });
    });

    it("should return 404 when session not found", async () => {
      mockedGetSession.mockReturnValue(undefined);
      const res = await request(`${baseUrl}/session?id=nope`, { method: "GET" });
      expect(res.status).toBe(404);
    });

    it("should return session info when session exists", async () => {
      const now = new Date("2026-02-24T12:00:00Z");
      mockedGetSession.mockReturnValue({
        id: "s1",
        profileName: "Alice",
        createdAt: now,
        lastActivity: now,
        messages: [{ id: "m1", role: "user", content: "hi", timestamp: now }],
      });

      const res = await request(`${baseUrl}/session?id=s1`, { method: "GET" });
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.sessionId).toBe("s1");
      expect(data.profileName).toBe("Alice");
      expect(data.messageCount).toBe(1);
    });
  });

  describe("POST /session/new", () => {
    it("should return 400 when profileName is missing", async () => {
      const res = await request(`${baseUrl}/session/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }, JSON.stringify({}));

      expect(res.status).toBe(400);
    });

    it("should return 403 when profile is not allowed", async () => {
      const res = await request(`${baseUrl}/session/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }, JSON.stringify({ profileName: "UnknownUser" }));

      expect(res.status).toBe(403);
    });

    it("should create session for allowed profile", async () => {
      const now = new Date("2026-02-24T12:00:00Z");
      mockedCreateSession.mockReturnValue({
        id: "voice-123",
        profileName: "Alice",
        createdAt: now,
        lastActivity: now,
        messages: [],
      });

      const res = await request(`${baseUrl}/session/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }, JSON.stringify({ profileName: "Alice" }));

      expect(res.status).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.sessionId).toBe("voice-123");
      expect(data.profileName).toBe("Alice");
    });
  });

  describe("GET /profiles", () => {
    it("should list allowed profiles", async () => {
      const res = await request(`${baseUrl}/profiles`, { method: "GET" });
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.profiles).toEqual([
        { name: "Alice", allowed: true },
        { name: "Bob", allowed: true },
      ]);
    });
  });

  describe("404 for unknown routes", () => {
    it("should return 404 for unknown paths", async () => {
      const res = await request(`${baseUrl}/unknown`, { method: "GET" });
      expect(res.status).toBe(404);
    });
  });

  describe("OPTIONS preflight", () => {
    it("should return 204 with CORS headers", async () => {
      const res = await request(`${baseUrl}/audio`, { method: "OPTIONS" });
      expect(res.status).toBe(204);
    });
  });
});

// --- SSE parser helper ---

function parseSSEEvents(body: string): Array<{ event: string; data: any }> {
  const events: Array<{ event: string; data: any }> = [];
  const blocks = body.split("\n\n").filter((b) => b.trim());

  for (const block of blocks) {
    let eventType = "";
    let dataLine = "";

    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7);
      } else if (line.startsWith("data: ")) {
        dataLine = line.slice(6);
      }
    }

    if (eventType && dataLine) {
      try {
        events.push({ event: eventType, data: JSON.parse(dataLine) });
      } catch {
        // skip malformed
      }
    }
  }

  return events;
}
