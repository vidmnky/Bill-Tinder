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
    id = crypto.randomUUID?.() ||
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}
