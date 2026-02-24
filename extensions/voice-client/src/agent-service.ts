/**
 * Agent Service for Voice Client Plugin
 *
 * Handles interaction with OpenClaw's embedded Pi agent.
 * Similar to voice-call's response-generator but adapted for voice-client.
 */

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
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
 * Walk up from `start` looking for a directory whose package.json has `name === pkgName`.
 */
function findPackageRoot(start: string, pkgName: string): string | null {
  let dir = path.resolve(start);
  const { root } = path.parse(dir);
  while (dir !== root) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        if (pkg.name === pkgName) return dir;
      } catch { /* skip malformed package.json */ }
    }
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * Resolve the openclaw package root directory.
 * Checks OPENCLAW_ROOT env, then walks up from process.argv[1], cwd, and import.meta.url.
 */
function resolveOpenClawRoot(): string {
  const override = process.env.OPENCLAW_ROOT?.trim();
  if (override) return override;

  const candidates = new Set<string>();
  if (process.argv[1]) candidates.add(path.dirname(process.argv[1]));
  candidates.add(process.cwd());
  try {
    candidates.add(path.dirname(fileURLToPath(import.meta.url)));
  } catch { /* not available */ }

  for (const start of candidates) {
    const found = findPackageRoot(start, "openclaw");
    if (found) return found;
  }

  // Last resort: try require.resolve
  try {
    const sdkEntry = require.resolve("openclaw/plugin-sdk");
    const idx = sdkEntry.indexOf("/node_modules/openclaw/");
    if (idx !== -1) return sdkEntry.slice(0, idx + "/node_modules/openclaw".length);
  } catch { /* not resolvable */ }

  throw new Error(
    "Unable to resolve openclaw package root. Set OPENCLAW_ROOT env var."
  );
}

/**
 * Load core agent dependencies from OpenClaw internals
 */
async function loadCoreAgentDeps(): Promise<CoreAgentDeps> {
  if (coreDepsCache) {
    return coreDepsCache;
  }

  // Resolve the openclaw package root and import the consolidated extensionAPI
  const openclawRoot = resolveOpenClawRoot();
  const apiPath = path.join(openclawRoot, "dist", "extensionAPI.js");
  if (!fs.existsSync(apiPath)) {
    throw new Error(`Missing openclaw extensionAPI at ${apiPath}`);
  }
  const api = await import(pathToFileURL(apiPath).href);
  coreDepsCache = {
    resolveAgentDir: api.resolveAgentDir,
    resolveAgentWorkspaceDir: api.resolveAgentWorkspaceDir,
    resolveAgentIdentity: api.resolveAgentIdentity,
    resolveThinkingDefault: api.resolveThinkingDefault,
    runEmbeddedPiAgent: api.runEmbeddedPiAgent,
    resolveAgentTimeoutMs: api.resolveAgentTimeoutMs,
    ensureAgentWorkspace: api.ensureAgentWorkspace,
    resolveStorePath: api.resolveStorePath,
    loadSessionStore: api.loadSessionStore,
    saveSessionStore: api.saveSessionStore,
    resolveSessionFilePath: api.resolveSessionFilePath,
    DEFAULT_MODEL: api.DEFAULT_MODEL,
    DEFAULT_PROVIDER: api.DEFAULT_PROVIDER,
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

    // Resolve model from user's openclaw config, falling back to extensionAPI defaults
    const agentsCfg = (coreConfig as Record<string, unknown>).agents as
      | { defaults?: { model?: { primary?: string } } }
      | undefined;
    const configModel = agentsCfg?.defaults?.model?.primary;
    const modelRef = configModel || `${deps.DEFAULT_PROVIDER}/${deps.DEFAULT_MODEL}`;
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
