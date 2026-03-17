'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import BillCard from './BillCard';

const SWIPE_THRESHOLD = 60; // px upward movement to trigger a choice
const NEXT_DELAY = 900;      // ms before loading next pair after a choice

export default function SwipeArena({ userState, scope, sessionId, mode = 'balanced', onVote }) {
  const [pair, setPair] = useState(null);           // { billA, billB }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [winnerId, setWinnerId] = useState(null);   // bill ID that was chosen
  const [transitioning, setTransitioning] = useState(false);

  // Touch state
  const touchStart = useRef(null);   // { x, y, side: 'left' | 'right' }
  const scrolledDuringTouch = useRef(false);

  const fetchPair = useCallback(async () => {
    if (!sessionId) return;
    if (scope === 'state' && !userState) return;

    setLoading(true);
    setError(null);
    setWinnerId(null);

    try {
      const params = new URLSearchParams({ scope, session_id: sessionId });
      if (userState) params.set('state', userState);
      const res = await fetch(`/api/bills/pair?${params}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || data.error || `Server error ${res.status}`);
      }

      setPair(data);
    } catch (err) {
      setError(err.message);
      console.error('[SwipeArena] fetchPair error:', err.message);
    } finally {
      setLoading(false);
    }
  }, [userState, scope, sessionId]);

  // Initial load + reload on scope change
  useEffect(() => {
    fetchPair();
  }, [fetchPair]);

  // Keyboard support: left arrow = choose left bill, right arrow = choose right bill
  useEffect(() => {
    const handleKey = (e) => {
      if (transitioning || !pair || winnerId) return;
      if (e.key === 'ArrowLeft') handleChoice(pair.billA.id);
      if (e.key === 'ArrowRight') handleChoice(pair.billB.id);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [pair, winnerId, transitioning]);

  const handleChoice = useCallback(async (chosenId) => {
    if (transitioning || winnerId || !pair) return;
    setWinnerId(chosenId);
    setTransitioning(true);

    // Record vote (non-blocking — we don't wait for this to show next pair)
    fetch('/api/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bill_a_id: pair.billA.id,
        bill_b_id: pair.billB.id,
        winner_id: chosenId,
        user_state: userState,
        session_id: sessionId,
      }),
    }).then(() => {
      if (onVote) onVote();
    }).catch(err => console.error('[SwipeArena] Vote record failed:', err.message));

    // Wait for animation, then load next pair
    setTimeout(() => {
      setTransitioning(false);
      fetchPair();
    }, NEXT_DELAY);
  }, [transitioning, winnerId, pair, userState, sessionId, fetchPair]);

  // Touch handlers — we attach per-card so we know which side was touched
  const makeTouchHandlers = useCallback((billId) => ({
    onTouchStart: (e) => {
      const touch = e.touches[0];
      touchStart.current = { x: touch.clientX, y: touch.clientY, billId, scrollTop: e.currentTarget.scrollTop };
      scrolledDuringTouch.current = false;
    },
    onTouchEnd: (e) => {
      if (!touchStart.current || touchStart.current.billId !== billId) return;
      // If the card scrolled during this touch, it's a scroll not a swipe
      const didScroll = e.currentTarget.scrollTop !== touchStart.current.scrollTop;
      if (!didScroll && !scrolledDuringTouch.current) {
        const touch = e.changedTouches[0];
        const deltaY = touchStart.current.y - touch.clientY;
        const deltaX = Math.abs(touchStart.current.x - touch.clientX);

        // Upward swipe, not too horizontal
        if (deltaY > SWIPE_THRESHOLD && deltaX < deltaY) {
          handleChoice(billId);
        }
      }
      touchStart.current = null;
    },
    onTouchMove: (e) => {
      // Track if content scrolled during this gesture
      if (touchStart.current && e.currentTarget.scrollTop !== touchStart.current.scrollTop) {
        scrolledDuringTouch.current = true;
      }
    },
  }), [handleChoice]);

  // ---- RENDER STATES ----

  if (loading) {
    return (
      <div style={styles.centerFrame}>
        <div style={styles.spinner} />
        <p style={styles.statusText}>Loading bills...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.centerFrame}>
        <p style={styles.errorTitle}>Could not load bills</p>
        <p style={styles.errorDetail}>{error}</p>
        <button style={styles.retryBtn} onClick={fetchPair}>
          Try again
        </button>
      </div>
    );
  }

  if (!pair) return null;

  const { billA, billB } = pair;
  const winnerIsA = winnerId === billA.id;
  const winnerIsB = winnerId === billB.id;

  return (
    <div style={styles.arena}>
      <BillCard
        bill={billA}
        side="left"
        mode={mode}
        isWinner={winnerIsA}
        isLoser={winnerIsB}
        onSwipeUp={() => handleChoice(billA.id)}
        touchHandlers={makeTouchHandlers(billA.id)}
      />

      <div style={styles.divider}>
        <span style={styles.vsText}>VS</span>
      </div>

      <BillCard
        bill={billB}
        side="right"
        mode={mode}
        isWinner={winnerIsB}
        isLoser={winnerIsA}
        onSwipeUp={() => handleChoice(billB.id)}
        touchHandlers={makeTouchHandlers(billB.id)}
      />
    </div>
  );
}

const styles = {
  arena: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
    position: 'relative',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: 28,
    background: 'var(--near-black)',
    borderLeft: '1px solid var(--border)',
    borderRight: '1px solid var(--border)',
    zIndex: 10,
  },
  vsText: {
    fontFamily: 'var(--display)',
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: '0.1em',
    color: 'var(--text-dim)',
    writingMode: 'vertical-rl',
    textTransform: 'uppercase',
  },
  centerFrame: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 32,
  },
  spinner: {
    width: 32,
    height: 32,
    border: '2px solid var(--border-bright)',
    borderTopColor: 'var(--accent)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  statusText: {
    fontFamily: 'var(--mono)',
    fontSize: 12,
    color: 'var(--text-muted)',
    letterSpacing: '0.05em',
  },
  errorTitle: {
    fontFamily: 'var(--display)',
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--text)',
    letterSpacing: '0.04em',
  },
  errorDetail: {
    fontFamily: 'var(--mono)',
    fontSize: 11,
    color: 'var(--text-muted)',
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 1.6,
    letterSpacing: '0.02em',
  },
  retryBtn: {
    fontFamily: 'var(--mono)',
    fontSize: 12,
    color: 'var(--accent)',
    background: 'var(--accent-dim)',
    border: '1px solid var(--accent)',
    borderRadius: 3,
    padding: '8px 20px',
    cursor: 'pointer',
    letterSpacing: '0.05em',
    marginTop: 8,
  },
};
