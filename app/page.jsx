'use client';

import { useState, useEffect, useCallback } from 'react';
import { getSessionId } from './components/session';
import StateSelect from './components/StateSelect';
import SwipeArena from './components/SwipeArena';
import Leaderboard from './components/Leaderboard';

const PREFS_KEY = 'legisswipe_prefs';

const MODE_LABELS = {
  balanced: 'Just the Facts',
  liberal: 'Progressive Lens',
  conservative: 'Conservative Lens',
};

const MODE_ORDER = ['balanced', 'liberal', 'conservative'];

export default function Home() {
  const [sessionId, setSessionId] = useState(null);
  const [prefs, setPrefs] = useState(null); // { scope, state }
  const [refreshKey, setRefreshKey] = useState(0);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [activeMode, setActiveMode] = useState(null);

  const cycleMode = () => {
    setActiveMode(prev => {
      const current = prev || (prefs && prefs.mode) || 'balanced';
      const idx = MODE_ORDER.indexOf(current);
      return MODE_ORDER[(idx + 1) % MODE_ORDER.length];
    });
  };

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
    setShowLeaderboard(false);
    localStorage.removeItem(PREFS_KEY);
  };

  const handleVote = useCallback(() => {
    setRefreshKey(k => k + 1);
  }, []);

  // Wait for client-side init
  if (!sessionId) return null;

  // State selection screen — show leaderboard below
  if (!prefs) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
        <StateSelect onSelect={handleSelect} />
        <div style={{ display: 'flex', justifyContent: 'center', padding: '0 32px 32px' }}>
          <Leaderboard refreshKey={refreshKey} />
        </div>
      </div>
    );
  }

  // Main game
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header bar */}
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={handleBack}>
          ← Back
        </button>
        <span style={styles.headerTitle} onClick={cycleMode} title="Click to change lens">
          {MODE_LABELS[activeMode || prefs.mode] || 'Just the Facts'}
        </span>
        <button
          style={styles.lbBtn}
          onClick={() => setShowLeaderboard(!showLeaderboard)}
        >
          {showLeaderboard ? 'Swipe' : 'Rankings'}
        </button>
      </div>

      {showLeaderboard ? (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: 24 }}>
          <Leaderboard refreshKey={refreshKey} />
        </div>
      ) : (
        <SwipeArena
          userState={prefs.state}
          scope={prefs.scope}
          sessionId={sessionId}
          mode={activeMode || prefs.mode || 'balanced'}
          onVote={handleVote}
        />
      )}
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
    color: 'var(--accent)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: 3,
    border: '1px solid var(--border)',
    transition: 'all 0.15s ease',
  },
  lbBtn: {
    fontFamily: 'var(--mono)',
    fontSize: 11,
    color: 'var(--accent)',
    background: 'none',
    border: '1px solid var(--accent)',
    borderRadius: 3,
    cursor: 'pointer',
    padding: '4px 10px',
    letterSpacing: '0.03em',
  },
};
