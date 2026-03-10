'use client';

import { useState, useEffect } from 'react';
import { getSessionId } from './components/session';
import StateSelect from './components/StateSelect';
import SwipeArena from './components/SwipeArena';

const PREFS_KEY = 'legisswipe_prefs';

export default function Home() {
  const [sessionId, setSessionId] = useState(null);
  const [prefs, setPrefs] = useState(null); // { scope, state }

  useEffect(() => {
    // Init session
    setSessionId(getSessionId());

    // Restore saved preferences
    const saved = localStorage.getItem(PREFS_KEY);
    if (saved) {
      try {
        setPrefs(JSON.parse(saved));
      } catch {
        // Corrupted — ignore
      }
    }
  }, []);

  const handleSelect = (choice) => {
    setPrefs(choice);
    localStorage.setItem(PREFS_KEY, JSON.stringify(choice));
  };

  const handleBack = () => {
    setPrefs(null);
    localStorage.removeItem(PREFS_KEY);
  };

  // Wait for client-side init
  if (!sessionId) return null;

  // State selection screen
  if (!prefs) {
    return <StateSelect onSelect={handleSelect} />;
  }

  // Main game
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header bar */}
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={handleBack}>
          ← Back
        </button>
        <span style={styles.headerTitle}>
          Which bill do you prefer?
        </span>
        <div style={{ width: 60 }} /> {/* spacer for centering */}
      </div>

      <SwipeArena
        userState={prefs.state}
        scope={prefs.scope}
        sessionId={sessionId}
      />
    </div>
  );
}

const styles = {
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    background: 'var(--near-black)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  backBtn: {
    fontFamily: 'var(--mono)',
    fontSize: 11,
    color: 'var(--text-dim)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px 8px',
    letterSpacing: '0.03em',
  },
  headerTitle: {
    fontFamily: 'var(--mono)',
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--text)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
};
