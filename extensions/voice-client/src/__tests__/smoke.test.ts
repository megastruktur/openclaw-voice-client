import { describe, it, expect } from 'vitest';
import { createSession } from '../session-manager.js';

describe('Session Manager', () => {
  it('should create a session with id and profileName', () => {
    const profileName = 'TestUser';
    const session = createSession(profileName);

    expect(session).toBeDefined();
    expect(session.id).toBeDefined();
    expect(typeof session.id).toBe('string');
    expect(session.profileName).toBe(profileName);
  });
});
