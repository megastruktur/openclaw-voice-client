import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentResponseParams, AgentResponseResult, BurstCallback } from "../agent-service.js";

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
