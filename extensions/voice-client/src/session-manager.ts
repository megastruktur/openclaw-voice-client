/**
 * Session Manager for Voice Client Plugin
 *
 * Manages voice client sessions, including:
 * - Session creation and lifecycle
 * - Message history (current session only)
 * - Profile association
 * - Idle timeout with pause/resume
 */

import type { VoiceClientSession, SessionMessage } from "./types.js";

/**
 * In-memory session storage (MVP)
 * TODO: Consider persistent storage for production
 */
const sessions = new Map<string, VoiceClientSession>();

/** Sessions that are paused due to inactivity */
const pausedSessions = new Set<string>();

/** Idle timeout in milliseconds (default: 5 minutes) */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/** Check interval for idle sessions (default: 30 seconds) */
const CHECK_INTERVAL_MS = 30 * 1000;

/** Active timers for session idle checks */
const idleTimers = new Map<string, NodeJS.Timeout>();

/** Interval timer for cleanup checks */
let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Callback when a session is paused
 */
let onPauseCallback: ((sessionId: string) => void) | null = null;

/**
 * Callback when a session is resumed
 */
let onResumeCallback: ((sessionId: string) => void) | null = null;

/**
 * Set callback for session pause events
 */
export function setOnPauseCallback(cb: (sessionId: string) => void): void {
  onPauseCallback = cb;
}

/**
 * Set callback for session resume events
 */
export function setOnResumeCallback(cb: (sessionId: string) => void): void {
  onResumeCallback = cb;
}

/**
 * Start the idle check interval
 */
function startCleanupInterval(): void {
  if (cleanupInterval) return;

  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [sessionId, session] of sessions) {
      if (pausedSessions.has(sessionId)) continue;

      const idleMs = now - session.lastActivity.getTime();
      if (idleMs >= IDLE_TIMEOUT_MS) {
        pauseSession(sessionId);
      }
    }
  }, CHECK_INTERVAL_MS);
}

/**
 * Stop the idle check interval
 */
function stopCleanupInterval(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

/**
 * Reset the idle timer for a session
 */
function resetIdleTimer(sessionId: string): void {
  // Clear existing timer
  const existing = idleTimers.get(sessionId);
  if (existing) {
    clearTimeout(existing);
  }

  // Set new timer
  const timer = setTimeout(() => {
    const session = sessions.get(sessionId);
    if (session && !pausedSessions.has(sessionId)) {
      pauseSession(sessionId);
    }
  }, IDLE_TIMEOUT_MS);

  idleTimers.set(sessionId, timer);
}

/**
 * Pause a session due to inactivity
 */
function pauseSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session || pausedSessions.has(sessionId)) return;

  pausedSessions.add(sessionId);
  console.log(`[voice-client] Session paused due to inactivity: ${sessionId}`);

  // Clear the idle timer
  const timer = idleTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    idleTimers.delete(sessionId);
  }

  // Notify callback
  if (onPauseCallback) {
    try {
      onPauseCallback(sessionId);
    } catch (err) {
      console.error(`[voice-client] Pause callback error:`, err);
    }
  }
}

/**
 * Resume a paused session
 */
function resumeSession(sessionId: string): void {
  if (!pausedSessions.has(sessionId)) return;

  pausedSessions.delete(sessionId);
  console.log(`[voice-client] Session resumed: ${sessionId}`);

  // Reset activity time
  const session = sessions.get(sessionId);
  if (session) {
    session.lastActivity = new Date();
    resetIdleTimer(sessionId);
  }

  // Notify callback
  if (onResumeCallback) {
    try {
      onResumeCallback(sessionId);
    } catch (err) {
      console.error(`[voice-client] Resume callback error:`, err);
    }
  }
}

/**
 * Check if a session is paused
 */
export function isSessionPaused(sessionId: string): boolean {
  return pausedSessions.has(sessionId);
}

/**
 * Create a new voice client session
 * TODO: Integrate with OpenClaw session management
 */
export function createSession(profileName: string): VoiceClientSession {
  // Start cleanup interval if not running
  startCleanupInterval();

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

  // Start idle timer
  resetIdleTimer(sessionId);

  return session;
}

/**
 * Get existing session by ID
 */
export function getSession(sessionId: string): VoiceClientSession | undefined {
  return sessions.get(sessionId);
}

/**
 * Get session and resume if paused
 */
export function getOrResumeSession(sessionId: string): VoiceClientSession | undefined {
  const session = sessions.get(sessionId);
  if (!session) return undefined;

  // Resume if paused
  if (pausedSessions.has(sessionId)) {
    resumeSession(sessionId);
  }

  // Update activity
  session.lastActivity = new Date();
  resetIdleTimer(sessionId);

  return session;
}

/**
 * Add message to session history
 */
export function addMessage(sessionId: string, message: SessionMessage): void {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  // Resume if paused (new activity)
  if (pausedSessions.has(sessionId)) {
    resumeSession(sessionId);
  }

  session.messages.push(message);
  session.lastActivity = new Date();
  resetIdleTimer(sessionId);
}

/**
 * Get all messages in a session
 */
export function getSessionMessages(sessionId: string): SessionMessage[] {
  const session = sessions.get(sessionId);
  return session ? session.messages : [];
}

/**
 * Clear session (called when client closes)
 */
export function clearSession(sessionId: string): void {
  // Clear idle timer
  const timer = idleTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    idleTimers.delete(sessionId);
  }

  pausedSessions.delete(sessionId);
  sessions.delete(sessionId);
  console.log("Session cleared:", sessionId);

  // Stop cleanup interval if no sessions left
  if (sessions.size === 0) {
    stopCleanupInterval();
  }
}

/**
 * Get all active (non-paused) sessions
 */
export function getActiveSessions(): VoiceClientSession[] {
  return Array.from(sessions.values()).filter((s) => !pausedSessions.has(s.id));
}

/**
 * Get all paused sessions
 */
export function getPausedSessions(): VoiceClientSession[] {
  return Array.from(sessions.values()).filter((s) => pausedSessions.has(s.id));
}

/**
 * Cleanup all sessions (for shutdown)
 */
export function cleanupAll(): void {
  stopCleanupInterval();

  for (const sessionId of sessions.keys()) {
    const timer = idleTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
    }
  }

  idleTimers.clear();
  pausedSessions.clear();
  sessions.clear();
}
