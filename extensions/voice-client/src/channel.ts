import type { ChannelPlugin, GatewayStartAccountParams } from "openclaw/plugin-sdk";
import type { VoiceClientConfig } from "./types.js";
import { VoiceClientHttpServer } from "./http-handler.js";

/**
 * Voice Client Channel Plugin
 *
 * This channel enables voice-based interaction through desktop clients.
 * It provides HTTP endpoints for audio streaming and session management.
 */

// Store active HTTP servers per account
const activeServers = new Map<string, VoiceClientHttpServer>();

/**
 * Parse and validate plugin configuration
 */
function parseConfig(rawConfig: unknown): VoiceClientConfig {
  const config = rawConfig as Record<string, unknown>;

  // Validate required fields
  if (!config.sonioxApiKey || typeof config.sonioxApiKey !== "string") {
    throw new Error("voice-client: sonioxApiKey is required in plugin config");
  }

  // Parse serve config with defaults
  const serveConfig = (config.serve as Record<string, unknown>) || {};
  const port = typeof serveConfig.port === "number" ? serveConfig.port : 18790;
  const path = typeof serveConfig.path === "string" ? serveConfig.path : "/voice-client";
  const bind = typeof serveConfig.bind === "string" ? serveConfig.bind : "127.0.0.1";

  // Parse profiles config with defaults
  const profilesConfig = (config.profiles as Record<string, unknown>) || {};
  const allowed = Array.isArray(profilesConfig.allowed) ? profilesConfig.allowed : [];
  const sessionKeys =
    profilesConfig.sessionKeys && typeof profilesConfig.sessionKeys === "object"
      ? (profilesConfig.sessionKeys as Record<string, string>)
      : undefined;
  return {
    enabled: typeof config.enabled === "boolean" ? config.enabled : true,
    sonioxApiKey: config.sonioxApiKey,
    serve: { port, path, bind },
    profiles: { allowed, sessionKeys },
  };
}

export const voiceClientPlugin: ChannelPlugin = {
  id: "voice-client",

  meta: {
    id: "voice-client",
    label: "Voice Client",
    selectionLabel: "Voice Client (Desktop)",
    docsPath: "/channels/voice-client",
    blurb: "Desktop voice assistant client with speech-to-text and text-to-speech",
  },

  capabilities: {
    chatTypes: ["direct"],
    reactions: false,
    threads: false,
    media: true, // Audio support
    polls: false,
    nativeCommands: false,
    blockStreaming: false,
  },

  config: {
    /**
     * List all configured voice client accounts
     * For MVP, we'll use a single default account
     */
    listAccountIds: (cfg) => {
      // TODO: Implement proper account listing
      return ["default"];
    },

    /**
     * Resolve account configuration
     */
    resolveAccount: (cfg, accountId) => {
      // TODO: Implement account resolution
      return {
        accountId: accountId || "default",
        enabled: true,
      };
    },

    /**
     * Resolve messaging target (profile name)
     */
    resolveTarget: (cfg, targetId) => {
      // TODO: Implement target resolution
      return {
        id: targetId,
        label: targetId,
      };
    },
  },

  /**
   * Gateway lifecycle - start/stop HTTP server per account
   */
  gateway: {
    /**
     * Start the voice client HTTP server for an account
     */
    startAccount: async (params: GatewayStartAccountParams) => {
      const { cfg, accountId, getStatus, setStatus, abortSignal, log } = params;
      const pluginConfig = (cfg.plugins?.entries?.["voice-client"] as { config?: unknown })?.config;
      const config = parseConfig(pluginConfig);

      if (!config.enabled) {
        log.info?.(`[${accountId}] Voice client is disabled`);
        return;
      }

      // Check if already running
      if (activeServers.has(accountId)) {
        log.info?.(`[${accountId}] Voice client HTTP server already running`);
        return;
      }

      // Create and start HTTP server
      const server = new VoiceClientHttpServer(config, cfg);
      activeServers.set(accountId, server);

      try {
        const url = await server.start();
        log.info?.(`[${accountId}] Voice client HTTP server started at ${url}`);
        log.info?.(`[${accountId}] Allowed profiles: ${config.profiles.allowed.join(", ") || "none"}`);

        // Mark as connected
        setStatus({ connected: true });

        // Wait for abort signal
        await new Promise<void>((resolve) => {
          abortSignal.addEventListener("abort", () => {
            resolve();
          });
        });
      } finally {
        // Cleanup
        await server.stop();
        activeServers.delete(accountId);
        setStatus({ connected: false, running: false });
        log.info?.(`[${accountId}] Voice client HTTP server stopped`);
      }
    },
  },

  outbound: {
    deliveryMode: "direct",

    /**
     * Send text message to voice client
     * This will be called when the agent responds
     */
    sendText: async (params) => {
      // TODO: Implement text sending
      // This should trigger TTS and send audio back to client
      console.log("Voice Client: sendText called", {
        targetId: params.targetId,
        text: params.text,
      });

      return {
        success: true,
        messageId: `voice-${Date.now()}`,
      };
    },

    /**
     * Send media (audio) to voice client
     */
    sendMedia: async (params) => {
      // TODO: Implement media sending
      console.log("Voice Client: sendMedia called", {
        targetId: params.targetId,
        mediaType: params.mediaType,
      });

      return {
        success: true,
        messageId: `voice-media-${Date.now()}`,
      };
    },
  },

  /**
   * Handle inbound messages from voice client
   * This will be triggered by HTTP endpoints
   */
  inbound: {
    /**
     * Process transcribed audio as a user message
     */
    processMessage: async (params) => {
      // TODO: Implement message processing
      console.log("Voice Client: processMessage called", params);

      return {
        success: true,
      };
    },
  },
};
