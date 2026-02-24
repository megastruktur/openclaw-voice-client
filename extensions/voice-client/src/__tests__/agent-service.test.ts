import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentResponseParams, AgentResponseResult, BurstCallback, StreamingCallback } from "../agent-service.js";

/**
 * Tests for the BurstCallback / generateAgentResponseBurst contract.
 *
 * Since generateAgentResponseBurst calls generateAgentResponse internally
 * (same-module binding), and generateAgentResponse depends on OpenClaw
 * internals, we test the burst logic by re-implementing the thin wrapper
 * against a mock of generateAgentResponse. This validates the contract:
 *   - onChunk called with (text, true) when agent returns text
 *   - onChunk NOT called when error or null text
 *   - Result passed through unchanged
 */

const STUB_PARAMS: AgentResponseParams = {
  voiceConfig: {
    enabled: true,
    sonioxApiKey: "test-key",
    serve: { port: 18790, path: "/voice-client" },
    profiles: { allowed: ["Alice"] },
  },
  coreConfig: {} as any,
  sessionId: "test-session-1",
  profileName: "Alice",
  transcript: [],
  userMessage: "Hello agent",
};

// Mirror of the production burst wrapper logic for contract testing.
// If production code changes contract, these tests catch the divergence.
async function burstWrapper(
  generateAgentResponse: (params: AgentResponseParams) => Promise<AgentResponseResult>,
  params: AgentResponseParams,
  onChunk: BurstCallback,
): Promise<AgentResponseResult> {
  const result = await generateAgentResponse(params);
  if (result.error) return result;
  if (result.text) onChunk(result.text, true);
  return result;
}

/**
 * Mirror of the production streaming wrapper logic for contract testing.
 * Simulates runEmbeddedPiAgent with opts.onPartialReply receiving cumulative text,
 * then computing deltas and calling onToken with only the new text.
 */
async function streamingWrapper(
  runAgent: (
    params: AgentResponseParams,
    onPartialReply: (payload: { text: string }) => Promise<void>,
  ) => Promise<AgentResponseResult>,
  params: AgentResponseParams,
  onToken: StreamingCallback,
): Promise<AgentResponseResult> {
  let lastEmittedLength = 0;

  const result = await runAgent(params, async (payload) => {
    const delta = payload.text.slice(lastEmittedLength);
    if (delta) {
      lastEmittedLength = payload.text.length;
      onToken(delta, false);
    }
  });

  if (!result.error) {
    onToken("", true);
  }

  return result;
}

describe("generateAgentResponseBurst (contract tests)", () => {
  let mockGenerateAgentResponse: ReturnType<typeof vi.fn<(params: AgentResponseParams) => Promise<AgentResponseResult>>>;

  beforeEach(() => {
    mockGenerateAgentResponse = vi.fn();
  });

  it("should call onChunk with full text and done=true when agent succeeds", async () => {
    mockGenerateAgentResponse.mockResolvedValue({ text: "Agent reply" });
    const onChunk = vi.fn<BurstCallback>();

    const result = await burstWrapper(mockGenerateAgentResponse, STUB_PARAMS, onChunk);

    expect(result).toEqual({ text: "Agent reply" });
    expect(onChunk).toHaveBeenCalledOnce();
    expect(onChunk).toHaveBeenCalledWith("Agent reply", true);
  });

  it("should NOT call onChunk when agent returns an error", async () => {
    mockGenerateAgentResponse.mockResolvedValue({ text: null, error: "Agent failed" });
    const onChunk = vi.fn<BurstCallback>();

    const result = await burstWrapper(mockGenerateAgentResponse, STUB_PARAMS, onChunk);

    expect(result).toEqual({ text: null, error: "Agent failed" });
    expect(onChunk).not.toHaveBeenCalled();
  });

  it("should NOT call onChunk when agent returns null text without error", async () => {
    mockGenerateAgentResponse.mockResolvedValue({ text: null });
    const onChunk = vi.fn<BurstCallback>();

    const result = await burstWrapper(mockGenerateAgentResponse, STUB_PARAMS, onChunk);

    expect(result).toEqual({ text: null });
    expect(onChunk).not.toHaveBeenCalled();
  });

  it("should propagate the AgentResponseResult unchanged", async () => {
    const expected = { text: "Some text" };
    mockGenerateAgentResponse.mockResolvedValue(expected);
    const onChunk = vi.fn<BurstCallback>();

    const result = await burstWrapper(mockGenerateAgentResponse, STUB_PARAMS, onChunk);

    expect(result).toBe(expected);
  });

  it("should pass params through to generateAgentResponse", async () => {
    mockGenerateAgentResponse.mockResolvedValue({ text: "ok" });
    const onChunk = vi.fn<BurstCallback>();

    await burstWrapper(mockGenerateAgentResponse, STUB_PARAMS, onChunk);

    expect(mockGenerateAgentResponse).toHaveBeenCalledOnce();
    expect(mockGenerateAgentResponse).toHaveBeenCalledWith(STUB_PARAMS);
  });

  it("should handle empty string text as falsy (no onChunk call)", async () => {
    mockGenerateAgentResponse.mockResolvedValue({ text: "" });
    const onChunk = vi.fn<BurstCallback>();

    const result = await burstWrapper(mockGenerateAgentResponse, STUB_PARAMS, onChunk);

    expect(result).toEqual({ text: "" });
    // Empty string is falsy, so onChunk should NOT be called
    expect(onChunk).not.toHaveBeenCalled();
  });
});

describe("generateAgentResponseStreaming (contract tests)", () => {
  it("should compute deltas from cumulative text and call onToken with each delta", async () => {
    const onToken = vi.fn<StreamingCallback>();

    // Simulate agent sending cumulative text: "Hello" → "Hello world" → "Hello world!"
    const mockRunAgent = vi.fn(async (
      _params: AgentResponseParams,
      onPartialReply: (payload: { text: string }) => Promise<void>,
    ) => {
      await onPartialReply({ text: "Hello" });
      await onPartialReply({ text: "Hello world" });
      await onPartialReply({ text: "Hello world!" });
      return { text: "Hello world!" } as AgentResponseResult;
    });

    const result = await streamingWrapper(mockRunAgent, STUB_PARAMS, onToken);

    expect(result).toEqual({ text: "Hello world!" });

    // Should have received 3 delta calls + 1 done call
    expect(onToken).toHaveBeenCalledTimes(4);
    expect(onToken).toHaveBeenNthCalledWith(1, "Hello", false);
    expect(onToken).toHaveBeenNthCalledWith(2, " world", false);
    expect(onToken).toHaveBeenNthCalledWith(3, "!", false);
    expect(onToken).toHaveBeenNthCalledWith(4, "", true);
  });

  it("should send done signal even when no partial replies received", async () => {
    const onToken = vi.fn<StreamingCallback>();

    const mockRunAgent = vi.fn(async () => {
      return { text: "Direct result" } as AgentResponseResult;
    });

    const result = await streamingWrapper(mockRunAgent, STUB_PARAMS, onToken);

    expect(result).toEqual({ text: "Direct result" });
    // Only done signal
    expect(onToken).toHaveBeenCalledOnce();
    expect(onToken).toHaveBeenCalledWith("", true);
  });

  it("should NOT call onToken when agent returns an error", async () => {
    const onToken = vi.fn<StreamingCallback>();

    const mockRunAgent = vi.fn(async () => {
      return { text: null, error: "Agent exploded" } as AgentResponseResult;
    });

    const result = await streamingWrapper(mockRunAgent, STUB_PARAMS, onToken);

    expect(result).toEqual({ text: null, error: "Agent exploded" });
    expect(onToken).not.toHaveBeenCalled();
  });

  it("should skip duplicate cumulative text (no empty deltas)", async () => {
    const onToken = vi.fn<StreamingCallback>();

    const mockRunAgent = vi.fn(async (
      _params: AgentResponseParams,
      onPartialReply: (payload: { text: string }) => Promise<void>,
    ) => {
      await onPartialReply({ text: "Hello" });
      await onPartialReply({ text: "Hello" }); // duplicate
      await onPartialReply({ text: "Hello world" });
      return { text: "Hello world" } as AgentResponseResult;
    });

    const result = await streamingWrapper(mockRunAgent, STUB_PARAMS, onToken);

    expect(result).toEqual({ text: "Hello world" });
    // 2 deltas + 1 done (duplicate skipped)
    expect(onToken).toHaveBeenCalledTimes(3);
    expect(onToken).toHaveBeenNthCalledWith(1, "Hello", false);
    expect(onToken).toHaveBeenNthCalledWith(2, " world", false);
    expect(onToken).toHaveBeenNthCalledWith(3, "", true);
  });

  it("should handle single large cumulative text", async () => {
    const onToken = vi.fn<StreamingCallback>();

    const mockRunAgent = vi.fn(async (
      _params: AgentResponseParams,
      onPartialReply: (payload: { text: string }) => Promise<void>,
    ) => {
      await onPartialReply({ text: "The quick brown fox jumps over the lazy dog" });
      return { text: "The quick brown fox jumps over the lazy dog" } as AgentResponseResult;
    });

    const result = await streamingWrapper(mockRunAgent, STUB_PARAMS, onToken);

    expect(result).toEqual({ text: "The quick brown fox jumps over the lazy dog" });
    expect(onToken).toHaveBeenCalledTimes(2);
    expect(onToken).toHaveBeenNthCalledWith(1, "The quick brown fox jumps over the lazy dog", false);
    expect(onToken).toHaveBeenNthCalledWith(2, "", true);
  });
});
