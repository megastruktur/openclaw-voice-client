/**
 * HTTP Handler for Voice Client Plugin
 *
 * This module handles HTTP endpoints for:
 * - POST /voice-client/audio - Audio streaming and transcription
 * - GET /voice-client/session - Get current session info
 * - POST /voice-client/session/new - Create new session
 * - GET /voice-client/profiles - List allowed profiles
 */

import http from "node:http";
import { URL } from "node:url";
import type { VoiceClientConfig, SessionResponse } from "./types.js";
import { transcribeAudio } from "./stt-service.js";
import { createSession, getSession, addMessage, getSessionMessages } from "./session-manager.js";
import { generateAgentResponse } from "./agent-service.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk";

const MAX_AUDIO_SIZE = 10 * 1024 * 1024; // 10MB max audio file

/**
 * Voice Client HTTP Server
 */
export class VoiceClientHttpServer {
  private server: http.Server | null = null;
  private config: VoiceClientConfig;
  private coreConfig: OpenClawConfig;
  private basePath: string;

  constructor(config: VoiceClientConfig, coreConfig: OpenClawConfig) {
    this.config = config;
    this.coreConfig = coreConfig;
    this.basePath = config.serve.path;
  }

  /**
   * Start the HTTP server
   */
  async start(): Promise<string> {
    const { port, bind } = this.config.serve;
    const hostname = bind || "127.0.0.1";

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          console.error("[voice-client] HTTP error:", err);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Internal server error" }));
        });
      });

      this.server.listen(port, hostname, () => {
        const url = `http://${hostname}:${port}${this.basePath}`;
        console.log(`[voice-client] HTTP server listening on ${url}`);
        resolve(url);
      });

      this.server.on("error", reject);
    });
  }

  /**
   * Stop the HTTP server
   */
  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          console.log("[voice-client] HTTP server stopped");
          resolve();
        });
      });
    }
  }

  /**
   * Handle incoming HTTP requests
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const path = url.pathname;

    // Set CORS headers for development
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Profile, X-Session-Key");

    // Handle OPTIONS preflight
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    // Route to appropriate handler
    if (path === `${this.basePath}/audio` && req.method === "POST") {
      await this.handleAudioUpload(req, res);
    } else if (path === `${this.basePath}/session` && req.method === "GET") {
      await this.handleGetSession(req, res);
    } else if (path === `${this.basePath}/session/new` && req.method === "POST") {
      await this.handleNewSession(req, res);
    } else if (path === `${this.basePath}/profiles` && req.method === "GET") {
      await this.handleGetProfiles(req, res);
    } else {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Not found" }));
    }
  }

  /**
   * Handle audio upload and transcription + agent response
   * POST /voice-client/audio?sessionId=<id>
   */
  private async handleAudioUpload(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      // Get profile from header
      const profileName = req.headers["x-profile"] as string;
      if (!profileName) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "X-Profile header required" }));
        return;
      }

      // Validate profile is allowed
      if (!this.config.profiles.allowed.includes(profileName)) {
        res.statusCode = 403;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Profile not allowed" }));
        return;
      }

      // Get session ID from query parameter
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "sessionId query parameter required" }));
        return;
      }

      // Verify session exists
      const session = getSession(sessionId);
      if (!session) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Session not found" }));
        return;
      }

      // Read audio data
      const chunks: Buffer[] = [];
      let totalSize = 0;

      for await (const chunk of req) {
        totalSize += chunk.length;
        if (totalSize > MAX_AUDIO_SIZE) {
          res.statusCode = 413;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Audio file too large" }));
          return;
        }
        chunks.push(chunk);
      }

      const audioBuffer = Buffer.concat(chunks);
      console.log(`[voice-client] Audio received: ${audioBuffer.length} bytes from ${profileName}`);

      // Step 1: Transcribe audio
      const transcription = await transcribeAudio(
        {
          audioBuffer,
          profileName,
        },
        this.config.sonioxApiKey
      );

      console.log(`[voice-client] Transcription: "${transcription.text}"`);

      // Guard: empty transcription → return early without calling agent
      if (!transcription.text) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            transcription: {
              text: "",
              confidence: transcription.confidence,
            },
            response: {
              text: "I didn't catch that. Could you try again?",
            },
          })
        );
        return;
      }

      // Step 2: Add user message to session history
      addMessage(sessionId, {
        id: `msg-${Date.now()}-user`,
        role: "user",
        content: transcription.text,
        timestamp: new Date(),
      });

      // Step 3: Resolve sessionKey (priority: header > config > default)
      let sessionKey: string | undefined;

      // Check for X-Session-Key header first
      const headerSessionKey = req.headers["x-session-key"] as string | undefined;
      if (headerSessionKey) {
        sessionKey = headerSessionKey;
      } else if (this.config.profiles.sessionKeys?.[profileName]) {
        // Fall back to config
        sessionKey = this.config.profiles.sessionKeys[profileName];
      }
      // Otherwise, agent-service will use default: voice-client:{profileName}

      // Step 4: Generate agent response
      const agentResult = await generateAgentResponse({
        voiceConfig: this.config,
        coreConfig: this.coreConfig,
        sessionId,
        profileName,
        transcript: getSessionMessages(sessionId),
        userMessage: transcription.text,
        sessionKey,
      });

      if (agentResult.error) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            transcription: {
              text: transcription.text,
              confidence: transcription.confidence,
            },
            error: agentResult.error,
          })
        );
        return;
      }

      const responseText = agentResult.text || "I'm sorry, I couldn't generate a response.";

      console.log(`[voice-client] Agent response: "${responseText}"`);

      // Step 5: Add assistant response to session history
      addMessage(sessionId, {
        id: `msg-${Date.now()}-assistant`,
        role: "assistant",
        content: responseText,
        timestamp: new Date(),
      });

      // Step 6: Return both transcription and agent response
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          transcription: {
            text: transcription.text,
            confidence: transcription.confidence,
          },
          response: {
            text: responseText,
          },
        })
      );
    } catch (error) {
      console.error("[voice-client] Audio processing failed:", error);
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Audio processing failed",
        })
      );
    }
  }

  /**
   * Handle get session info
   * GET /voice-client/session?id=sessionId
   */
  private async handleGetSession(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const sessionId = url.searchParams.get("id");

    if (!sessionId) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Session ID required" }));
      return;
    }

    const session = getSession(sessionId);
    if (!session) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        sessionId: session.id,
        profileName: session.profileName,
        createdAt: session.createdAt.toISOString(),
        lastActivity: session.lastActivity.toISOString(),
        messageCount: session.messages.length,
      })
    );
  }

  /**
   * Handle create new session
   * POST /voice-client/session/new
   * Body: { profileName: string }
   */
  private async handleNewSession(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      // Read request body
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString("utf-8");
      const data = JSON.parse(body);

      const profileName = data.profileName;
      if (!profileName || typeof profileName !== "string") {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "profileName required" }));
        return;
      }

      // Validate profile is allowed
      if (!this.config.profiles.allowed.includes(profileName)) {
        res.statusCode = 403;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Profile not allowed" }));
        return;
      }

      // Create session
      const session = createSession(profileName);

      const response: SessionResponse = {
        sessionId: session.id,
        createdAt: session.createdAt.toISOString(),
        profileName: session.profileName,
      };

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(response));
    } catch (error) {
      console.error("[voice-client] Session creation failed:", error);
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Session creation failed",
        })
      );
    }
  }

  /**
   * Handle get allowed profiles
   * GET /voice-client/profiles
   */
  private async handleGetProfiles(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        profiles: this.config.profiles.allowed.map((name) => ({
          name,
          allowed: true,
        })),
      })
    );
  }
}
