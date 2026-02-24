import http from 'node:http';
import type { VoiceEvent } from './types.js';

/**
 * Format a VoiceEvent as SSE text: "event: <type>\ndata: <json>\n\n"
 */
export function formatSSE(event: VoiceEvent): string {
  const eventType = event.type;
  const jsonData = JSON.stringify(event);
  return `event: ${eventType}\ndata: ${jsonData}\n\n`;
}

/**
 * Write SSE headers to a ServerResponse
 */
export function writeSSEHeaders(res: http.ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
}

/**
 * Write a single SSE event to a ServerResponse
 */
export function sendSSE(res: http.ServerResponse, event: VoiceEvent): void {
  const formatted = formatSSE(event);
  res.write(formatted);
}

/**
 * Close SSE stream
 */
export function endSSE(res: http.ServerResponse): void {
  res.end();
}
