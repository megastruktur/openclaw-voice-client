/**
 * Speech-to-Text Service (Soniox Integration)
 *
 * This module handles audio transcription using the Soniox API.
 * Supports both batch and streaming transcription.
 */

import { SonioxSpeechClient } from "@soniox/node";
import type { TranscriptionRequest, TranscriptionResponse } from "./types.js";

/**
 * Transcribe audio buffer to text using Soniox API
 * Uses the async (non-streaming) transcription endpoint
 */
export async function transcribeAudio(
  request: TranscriptionRequest,
  apiKey: string
): Promise<TranscriptionResponse> {
  if (!apiKey) {
    throw new Error("Soniox API key is required");
  }

  try {
    // Initialize Soniox client
    const client = new SonioxSpeechClient({ apiKey });

    // Transcribe audio using async API
    // The SDK expects audio as Buffer or Uint8Array
    const result = await client.transcribeAsync({
      audio: request.audioBuffer,
      model: "en_v2", // English model (can be configured)
      enableProfanityFilter: false,
      enableSpeakerDiarization: false,
    });

    // Extract text from result
    const text = result.words?.map((w) => w.text).join(" ") || "";
    const confidence = result.words?.[0]?.confidence || 0.0;

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
