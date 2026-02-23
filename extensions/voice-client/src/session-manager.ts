/**
 * Session Manager for Voice Client Plugin
 *
 * Manages voice client sessions, including:
 * - Session creation and lifecycle
 * - Message history (current session only)
 * - Profile association
 */

import type { VoiceClientSession, SessionMessage } from "./types.js";

/**
 * In-memory session storage (MVP)
 * TODO: Consider persistent storage for production
 */
const sessions = new Map<string, VoiceClientSession>();

/**
 * Create a new voice client session
 * TODO: Integrate with OpenClaw session management
 */
export function createSession(profileName: string): VoiceClientSession {
  const sessionId = `voice-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const session: VoiceClientSession = {
    id: sessionId,
    createdAt: new Date(),
    lastActivity: new Date(),
    profileName,
    messages: [],
  };

  sessions.set(sessionId, session);
  console.log("Session created:", sessionId, "for profile:", profileName);

  return session;
}

/**
 * Get existing session by ID
 */
export function getSession(sessionId: string): VoiceClientSession | undefined {
  return sessions.get(sessionId);
}

/**
 * Add message to session history
 */
export function addMessage(sessionId: string, message: SessionMessage): void {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  session.messages.push(message);
  session.lastActivity = new Date();
}

/**
 * Get all messages in a session
 */
export function getSessionMessages(sessionId: string): SessionMessage[] {
  const session = sessions.get(sessionId);
  return session ? session.messages : [];
}

/**
 * Clear session history (called when client closes)
 */
export function clearSession(sessionId: string): void {
  sessions.delete(sessionId);
  console.log("Session cleared:", sessionId);
}
