/**
 * Speech-to-Text Service (Soniox Integration)
 *
 * This module handles audio transcription using the Soniox API.
 * Uses the current @soniox/node SDK (SonioxNodeClient).
 */

import { SonioxNodeClient } from "@soniox/node";
import type { TranscriptionRequest, TranscriptionResponse } from "./types.js";


let cachedClient: SonioxNodeClient | null = null;
let cachedApiKey: string | null = null;

function getClient(apiKey: string): SonioxNodeClient {
  if (cachedClient && cachedApiKey === apiKey) {
    return cachedClient;
  }
  cachedClient = new SonioxNodeClient({ api_key: apiKey });
  cachedApiKey = apiKey;
  return cachedClient;
}

/**
 * Transcribe audio buffer to text using Soniox API
 * Uses the async transcription endpoint with automatic upload, wait, and cleanup.
 */
export async function transcribeAudio(
  request: TranscriptionRequest,
  apiKey: string
): Promise<TranscriptionResponse> {
  if (!apiKey) {
    throw new Error("Soniox API key is required");
  }

  try {
    const client = getClient(apiKey);


    const transcription = await client.stt.transcribe({
      model: "stt-async-v4",
      file: request.audioBuffer,
      filename: "recording.webm",
      language_hints: ["en"],
      wait: true,
      cleanup: ["file", "transcription"],
    });


    const transcript = await transcription.getTranscript();
    const text = transcript?.text ?? "";


    const tokens = transcript?.tokens ?? [];
    const confidence =
      tokens.length > 0
        ? tokens.reduce((sum: number, t: { confidence?: number }) => sum + (t.confidence ?? 0), 0) / tokens.length
        : 0.0;

    console.log("STT service: transcription complete", {
      profile: request.profileName,
      textLength: text.length,
      confidence,
    });

    return {
      text: text.trim(),
      confidence,
    };
  } catch (error) {
    console.error("STT service: transcription failed", error);
    throw new Error(
      `Soniox transcription failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Initialize streaming transcription connection
 * TODO: Implement in Phase 3 (streaming support)
 */
export async function createStreamingTranscription(apiKey: string) {
  console.log("STT service: streaming transcription (not implemented yet)");
  throw new Error("Streaming transcription not implemented");
}
