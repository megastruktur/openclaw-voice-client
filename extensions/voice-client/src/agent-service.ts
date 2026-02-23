/**
 * Agent Service for Voice Client Plugin
 *
 * Handles interaction with OpenClaw's embedded Pi agent.
 * Similar to voice-call's response-generator but adapted for voice-client.
 */

import crypto from "node:crypto";
import type { VoiceClientConfig, SessionMessage } from "./types.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk";

export type AgentResponseParams = {
  voiceConfig: VoiceClientConfig;
  coreConfig: OpenClawConfig;
  sessionId: string;
  profileName: string;
  transcript: SessionMessage[];
  userMessage: string;
  sessionKey?: string;
};

export type AgentResponseResult = {
  text: string | null;
  error?: string;
};

/**
 * Core agent dependencies (dynamically loaded from openclaw internals)
 */
type CoreAgentDeps = {
  resolveAgentDir: (cfg: OpenClawConfig, agentId: string) => string;
  resolveAgentWorkspaceDir: (cfg: OpenClawConfig, agentId: string) => string;
  resolveAgentIdentity: (
    cfg: OpenClawConfig,
    agentId: string
  ) => { name?: string | null } | null | undefined;
  resolveThinkingDefault: (params: {
    cfg: OpenClawConfig;
    provider?: string;
    model?: string;
  }) => string;
  runEmbeddedPiAgent: (params: {
    sessionId: string;
    sessionKey?: string;
    messageProvider?: string;
    sessionFile: string;
    workspaceDir: string;
    config?: OpenClawConfig;
    prompt: string;
    provider?: string;
    model?: string;
    thinkLevel?: string;
    verboseLevel?: string;
    timeoutMs: number;
    runId: string;
    lane?: string;
    extraSystemPrompt?: string;
    agentDir?: string;
  }) => Promise<{
    payloads?: Array<{ text?: string; isError?: boolean }>;
    meta?: { aborted?: boolean };
  }>;
  resolveAgentTimeoutMs: (opts: { cfg: OpenClawConfig }) => number;
  ensureAgentWorkspace: (params?: { dir: string }) => Promise<void>;
  resolveStorePath: (store?: string, opts?: { agentId?: string }) => string;
  loadSessionStore: (storePath: string) => Record<string, unknown>;
  saveSessionStore: (storePath: string, store: Record<string, unknown>) => Promise<void>;
  resolveSessionFilePath: (
    sessionId: string,
    entry: unknown,
    opts?: { agentId?: string }
  ) => string;
  DEFAULT_MODEL: string;
  DEFAULT_PROVIDER: string;
};

let coreDepsCache: CoreAgentDeps | null = null;

/**
 * Load core agent dependencies from OpenClaw internals
 */
async function loadCoreAgentDeps(): Promise<CoreAgentDeps> {
  if (coreDepsCache) {
    return coreDepsCache;
  }

  // Import from openclaw internals (same pattern as voice-call)
  const [
    agentPaths,
    agentIdentity,
    sessionUtils,
    thinking,
    piRunner,
    agentTimeouts,
    workspace,
  ] = await Promise.all([
    import("openclaw/dist/agents/paths.js"),
    import("openclaw/dist/agents/identity.js"),
    import("openclaw/dist/config/sessions.js"),
    import("openclaw/dist/config/thinking.js"),
    import("openclaw/dist/agents/pi-runner.js"),
    import("openclaw/dist/config/agent-timeouts.js"),
    import("openclaw/dist/agents/workspace.js"),
  ]);

  coreDepsCache = {
    resolveAgentDir: agentPaths.resolveAgentDir,
    resolveAgentWorkspaceDir: agentPaths.resolveAgentWorkspaceDir,
    resolveAgentIdentity: agentIdentity.resolveAgentIdentity,
    resolveThinkingDefault: thinking.resolveThinkingDefault,
    runEmbeddedPiAgent: piRunner.runEmbeddedPiAgent,
    resolveAgentTimeoutMs: agentTimeouts.resolveAgentTimeoutMs,
    ensureAgentWorkspace: workspace.ensureAgentWorkspace,
    resolveStorePath: sessionUtils.resolveStorePath,
    loadSessionStore: sessionUtils.loadSessionStore,
    saveSessionStore: sessionUtils.saveSessionStore,
    resolveSessionFilePath: sessionUtils.resolveSessionFilePath,
    DEFAULT_MODEL: thinking.DEFAULT_MODEL,
    DEFAULT_PROVIDER: thinking.DEFAULT_PROVIDER,
  };

  return coreDepsCache;
}

/**
 * Generate agent response for voice client
 */
export async function generateAgentResponse(
  params: AgentResponseParams
): Promise<AgentResponseResult> {
  const { voiceConfig, coreConfig, sessionId, profileName, transcript, userMessage } = params;

  try {
    const deps = await loadCoreAgentDeps();

    // Use provided sessionKey (e.g., "agent:main:main") or fall back to voice-client-specific key
    const sessionKey = params.sessionKey || `voice-client:${profileName}`;
    const agentId = "main";

    // Resolve paths
    const storePath = deps.resolveStorePath(
      (coreConfig as { session?: { store?: string } }).session?.store,
      { agentId }
    );
    const agentDir = deps.resolveAgentDir(coreConfig, agentId);
    const workspaceDir = deps.resolveAgentWorkspaceDir(coreConfig, agentId);

    // Ensure workspace exists
    await deps.ensureAgentWorkspace({ dir: workspaceDir });

    // Load or create session entry
    const sessionStore = deps.loadSessionStore(storePath);
    const now = Date.now();

    type SessionEntry = {
      sessionId: string;
      updatedAt: number;
    };

    let sessionEntry = sessionStore[sessionKey] as SessionEntry | undefined;

    if (!sessionEntry || sessionEntry.sessionId !== sessionId) {
      sessionEntry = {
        sessionId,
        updatedAt: now,
      };
      sessionStore[sessionKey] = sessionEntry;
      await deps.saveSessionStore(storePath, sessionStore);
    }

    const sessionFile = deps.resolveSessionFilePath(sessionId, sessionEntry, {
      agentId,
    });

    // Resolve model from config (use defaults if not specified)
    const modelRef = `${deps.DEFAULT_PROVIDER}/${deps.DEFAULT_MODEL}`;
    const slashIndex = modelRef.indexOf("/");
    const provider = slashIndex === -1 ? deps.DEFAULT_PROVIDER : modelRef.slice(0, slashIndex);
    const model = slashIndex === -1 ? modelRef : modelRef.slice(slashIndex + 1);

    // Resolve thinking level
    const thinkLevel = deps.resolveThinkingDefault({ cfg: coreConfig, provider, model });

    // Resolve agent identity
    const identity = deps.resolveAgentIdentity(coreConfig, agentId);
    const agentName = identity?.name?.trim() || "assistant";

    // Build system prompt with conversation history
    const basePrompt = `You are ${agentName}, a helpful voice assistant. Keep responses brief and conversational (1-2 sentences max). Be natural and friendly. The user is ${profileName}.`;

    let extraSystemPrompt = basePrompt;
    if (transcript.length > 0) {
      const history = transcript
        .map((entry) => `${entry.role === "assistant" ? "You" : "User"}: ${entry.content}`)
        .join("\n");
      extraSystemPrompt = `${basePrompt}\n\nConversation so far:\n${history}`;
    }

    // Resolve timeout
    const timeoutMs = deps.resolveAgentTimeoutMs({ cfg: coreConfig });
    const runId = `voice-client:${sessionId}:${Date.now()}`;

    // Run the embedded Pi agent
    const result = await deps.runEmbeddedPiAgent({
      sessionId,
      sessionKey,
      messageProvider: "voice-client",
      sessionFile,
      workspaceDir,
      config: coreConfig,
      prompt: userMessage,
      provider,
      model,
      thinkLevel,
      verboseLevel: "off",
      timeoutMs,
      runId,
      lane: "voice-client",
      extraSystemPrompt,
      agentDir,
    });

    // Extract text from payloads
    const texts = (result.payloads ?? [])
      .filter((p) => p.text && !p.isError)
      .map((p) => p.text?.trim())
      .filter(Boolean);

    const text = texts.join(" ") || null;

    if (!text && result.meta?.aborted) {
      return { text: null, error: "Response generation was aborted" };
    }

    return { text };
  } catch (error) {
    console.error("[voice-client] Agent response generation failed:", error);
    return {
      text: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
