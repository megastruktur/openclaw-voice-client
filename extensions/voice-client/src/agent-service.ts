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

export type BurstCallback = (text: string, done: boolean) => void;

export type StreamingCallback = (delta: string, done: boolean) => void;

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
    onPartialReply?: (payload: { text: string; mediaUrls?: string[] }) => Promise<void>;
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

type SessionEntry = {
  sessionId: string;
  updatedAt: number;
};

/**
 * Prepare common agent call parameters (shared by all response generation modes)
 */
async function prepareAgentCallParams(params: AgentResponseParams) {
  const { coreConfig, sessionId, profileName, transcript, userMessage } = params;
  const deps = await loadCoreAgentDeps();

  const sessionKey = params.sessionKey || `voice-client:${profileName}`;
  const agentId = "main";

  const storePath = deps.resolveStorePath(
    (coreConfig as { session?: { store?: string } }).session?.store,
    { agentId }
  );
  const agentDir = deps.resolveAgentDir(coreConfig, agentId);
  const workspaceDir = deps.resolveAgentWorkspaceDir(coreConfig, agentId);

  await deps.ensureAgentWorkspace({ dir: workspaceDir });

  const sessionStore = deps.loadSessionStore(storePath);
  const now = Date.now();

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

  const agentsCfg = (coreConfig as Record<string, unknown>).agents as
    | { defaults?: { model?: { primary?: string } } }
    | undefined;
  const configModel = agentsCfg?.defaults?.model?.primary;
  const modelRef = configModel || `${deps.DEFAULT_PROVIDER}/${deps.DEFAULT_MODEL}`;
  const slashIndex = modelRef.indexOf("/");
  const provider = slashIndex === -1 ? deps.DEFAULT_PROVIDER : modelRef.slice(0, slashIndex);
  const model = slashIndex === -1 ? modelRef : modelRef.slice(slashIndex + 1);

  const thinkLevel = deps.resolveThinkingDefault({ cfg: coreConfig, provider, model });

  const identity = deps.resolveAgentIdentity(coreConfig, agentId);
  const agentName = identity?.name?.trim() || "assistant";

  const basePrompt = `You are ${agentName}, a helpful voice assistant. Keep responses brief and conversational (1-2 sentences max). Be natural and friendly. The user is ${profileName}.`;

  let extraSystemPrompt = basePrompt;
  if (transcript.length > 0) {
    const history = transcript
      .map((entry) => `${entry.role === "assistant" ? "You" : "User"}: ${entry.content}`)
      .join("\n");
    extraSystemPrompt = `${basePrompt}\n\nConversation so far:\n${history}`;
  }

  const timeoutMs = deps.resolveAgentTimeoutMs({ cfg: coreConfig });
  const runId = `voice-client:${sessionId}:${Date.now()}`;

  return {
    deps,
    agentCallParams: {
      sessionId,
      sessionKey,
      messageProvider: "voice-client" as const,
      sessionFile,
      workspaceDir,
      config: coreConfig,
      prompt: userMessage,
      provider,
      model,
      thinkLevel,
      verboseLevel: "off" as const,
      timeoutMs,
      runId,
      lane: "voice-client" as const,
      extraSystemPrompt,
      agentDir,
    },
  };
}

/**
 * Extract final text from agent result payloads
 */
function extractResultText(result: {
  payloads?: Array<{ text?: string; isError?: boolean }>;
  meta?: { aborted?: boolean };
}): AgentResponseResult {
  const texts = (result.payloads ?? [])
    .filter((p) => p.text && !p.isError)
    .map((p) => p.text?.trim())
    .filter(Boolean);

  const text = texts.join(" ") || null;

  if (!text && result.meta?.aborted) {
    return { text: null, error: "Response generation was aborted" };
  }

  return { text };
}

/**
 * Generate agent response for voice client (non-streaming)
 */
export async function generateAgentResponse(
  params: AgentResponseParams
): Promise<AgentResponseResult> {
  try {
    const { deps, agentCallParams } = await prepareAgentCallParams(params);
    const result = await deps.runEmbeddedPiAgent(agentCallParams);
    return extractResultText(result);
  } catch (error) {
    console.error("[voice-client] Agent response generation failed:", error);
    return {
      text: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function generateAgentResponseBurst(
  params: AgentResponseParams,
  onChunk: BurstCallback
): Promise<AgentResponseResult> {
  const result = await generateAgentResponse(params);
  if (result.error) {
    return result;
  }
  if (result.text) {
    onChunk(result.text, true);
  }
  return result;
}

/**
 * Generate agent response with true token-by-token streaming.
 * Uses top-level onPartialReply param on runEmbeddedPiAgent to receive cumulative text,
 * computes deltas, and calls onToken with only the new text.
 */
export async function generateAgentResponseStreaming(
  params: AgentResponseParams,
  onToken: StreamingCallback
): Promise<AgentResponseResult> {
  try {
    const { deps, agentCallParams } = await prepareAgentCallParams(params);

    // Delta tracking: onPartialReply receives cumulative text
    let lastEmittedLength = 0;

    const result = await deps.runEmbeddedPiAgent({
      ...agentCallParams,
      onPartialReply: async (payload: { text: string }) => {
        const delta = payload.text.slice(lastEmittedLength);
        if (delta) {
          lastEmittedLength = payload.text.length;
          onToken(delta, false);
        }
      },
    });

    const agentResult = extractResultText(result);

    // Send final done signal
    onToken("", true);

    return agentResult;
  } catch (error) {
    console.error("[voice-client] Agent streaming response failed:", error);
    return {
      text: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
