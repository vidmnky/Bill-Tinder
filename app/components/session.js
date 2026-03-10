'use client';

const SESSION_KEY = 'legisswipe_session_id';

/**
 * Get or create an anonymous session ID.
 * Persisted in localStorage so it survives page refreshes.
 */
export function getSessionId() {
  if (typeof window === 'undefined') return null;

  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}
