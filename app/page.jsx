'use client';

import { useState, useEffect, useCallback } from 'react';
import { getSessionId } from './components/session';
import StateSelect from './components/StateSelect';
import SwipeArena from './components/SwipeArena';
import SingleSwipe from './components/SingleSwipe';
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

  // Home screen — two separate entry points
  if (!prefs) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
        <StateSelect onSelect={handleSelect} />
        <div style={{ display: 'flex', justifyContent: 'center', padding: '0 32px 0' }}>
          <div style={styles.swipeEntry}>
            <div style={styles.swipeDivider}>
              <span style={styles.swipeDividerText}>or</span>
            </div>
            <button
              style={styles.swipeEntryBtn}
              onClick={() => handleSelect({ scope: 'all', state: null, mode: 'balanced', singleBill: true })}
            >
              Swipe Bills
            </button>
            <p style={styles.swipeEntryDesc}>One bill at a time. Swipe right if it makes sense, left if it doesn't.</p>
          </div>
        </div>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button style={styles.backBtn} onClick={handleBack}>
            ← Back
          </button>
          <a href="https://determined-presence-production-cd4f.up.railway.app" style={styles.cmLink}>
            Civic Mirror
          </a>
        </div>
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
      ) : prefs.singleBill ? (
        <SingleSwipe
          userState={prefs.state}
          scope={prefs.scope}
          sessionId={sessionId}
          mode={activeMode || prefs.mode || 'balanced'}
          onVote={handleVote}
        />
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
  swipeEntry: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: '100%',
    maxWidth: 480,
    gap: 12,
  },
  swipeDivider: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  swipeDividerText: {
    fontFamily: 'var(--mono)',
    fontSize: 11,
    color: 'var(--text-muted)',
    letterSpacing: '0.05em',
    flex: 'none',
  },
  swipeEntryBtn: {
    fontFamily: 'var(--mono)',
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: '0.05em',
    padding: '14px 32px',
    background: 'none',
    color: 'var(--accent)',
    border: '1px solid var(--accent)',
    borderRadius: 4,
    cursor: 'pointer',
    transition: 'opacity 0.15s ease',
  },
  swipeEntryDesc: {
    fontFamily: 'var(--mono)',
    fontSize: 11,
    color: 'var(--text-muted)',
    letterSpacing: '0.03em',
    textAlign: 'center',
    maxWidth: 300,
  },
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
  cmLink: {
    fontFamily: 'var(--mono)',
    fontSize: 11,
    color: 'var(--text-dim)',
    textDecoration: 'none',
    letterSpacing: '0.03em',
    padding: '4px 8px',
  },
};
