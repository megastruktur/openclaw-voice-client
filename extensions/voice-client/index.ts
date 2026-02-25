import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { voiceClientPlugin } from "./src/channel.js";

/**
 * Voice Client Plugin Entry Point
 *
 * This plugin provides a channel for desktop voice client applications
 * to interact with OpenClaw Gateway via HTTP and WebSocket.
 */

const plugin = {
  id: "voice-client",
  name: "Voice Client",
  description: "Desktop voice client channel for OpenClaw",

  register(api: OpenClawPluginApi) {
    // Register the voice-client channel
    // HTTP server is managed by gateway.startAccount in channel.ts
    api.registerChannel({ plugin: voiceClientPlugin });
  },
};

export default plugin;
