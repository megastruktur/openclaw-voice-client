import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { voiceClientPlugin } from "./src/channel.js";
import { VoiceClientHttpServer } from "./src/http-handler.js";
import type { VoiceClientConfig } from "./src/types.js";

/**
 * Voice Client Plugin Entry Point
 *
 * This plugin provides a channel for desktop voice client applications
 * to interact with OpenClaw Gateway via HTTP and WebSocket.
 */

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

  return {
    enabled: typeof config.enabled === "boolean" ? config.enabled : true,
    sonioxApiKey: config.sonioxApiKey,
    serve: { port, path, bind },
    profiles: { allowed },
  };
}

const plugin = {
  id: "voice-client",
  name: "Voice Client",
  description: "Desktop voice client channel for OpenClaw",

  register(api: OpenClawPluginApi) {
    // Parse configuration
    const config = parseConfig(api.pluginConfig);

    if (!config.enabled) {
      api.logger.info("[voice-client] Plugin is disabled in config");
      return;
    }

    // Register the voice-client channel
    api.registerChannel({ plugin: voiceClientPlugin });

    // Initialize HTTP server
    let httpServer: VoiceClientHttpServer | null = null;

    // Register service lifecycle
    api.registerService({
      id: "voice-client-http",
      start: async () => {
        try {
          httpServer = new VoiceClientHttpServer(config, api.config);
          const url = await httpServer.start();
          api.logger.info(`[voice-client] HTTP server started at ${url}`);

          // Log configuration
          api.logger.info(
            `[voice-client] Allowed profiles: ${config.profiles.allowed.join(", ") || "none"}`
          );
        } catch (error) {
          api.logger.error(
            `[voice-client] Failed to start HTTP server: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          throw error;
        }
      },
      stop: async () => {
        if (httpServer) {
          await httpServer.stop();
          httpServer = null;
          api.logger.info("[voice-client] HTTP server stopped");
        }
      },
    });
  },
};

export default plugin;
