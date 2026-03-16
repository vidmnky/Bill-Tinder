'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import BillCard from './BillCard';

const SWIPE_THRESHOLD = 80; // px horizontal movement to trigger choice
const NEXT_DELAY = 600;     // ms before loading next bill after choice

export default function SingleSwipe({ userState, scope, sessionId, mode = 'balanced', onVote }) {
  const [bill, setBill] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [choice, setChoice] = useState(null);    // 'approve' | 'reject' | null
  const [transitioning, setTransitioning] = useState(false);
  const [dragX, setDragX] = useState(0);          // current drag offset for tilt

  const touchStart = useRef(null);
  const isDragging = useRef(false);

  const fetchBill = useCallback(async () => {
    if (!sessionId) return;

    setLoading(true);
    setError(null);
    setChoice(null);
    setDragX(0);

    try {
      const params = new URLSearchParams({ scope, session_id: sessionId });
      if (userState) params.set('state', userState);
      const res = await fetch(`/api/bills/single?${params}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || data.error || `Server error ${res.status}`);
      }

      setBill(data.bill);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [userState, scope, sessionId]);

  useEffect(() => {
    fetchBill();
  }, [fetchBill]);

  const handleRate = useCallback((rating) => {
    if (transitioning || choice || !bill) return;
    setChoice(rating);
    setTransitioning(true);
    setDragX(0);

    // Record vote (non-blocking)
    fetch('/api/vote/single', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bill_id: bill.id,
        rating,
        session_id: sessionId,
        user_state: userState,
      }),
    }).then(() => {
      if (onVote) onVote();
    }).catch(err => console.error('[SingleSwipe] Vote failed:', err.message));

    setTimeout(() => {
      setTransitioning(false);
      fetchBill();
    }, NEXT_DELAY);
  }, [transitioning, choice, bill, sessionId, userState, fetchBill, onVote]);

  // Keyboard: left = reject, right = approve
  useEffect(() => {
    const handleKey = (e) => {
      if (transitioning || !bill || choice) return;
      if (e.key === 'ArrowLeft') handleRate('reject');
      if (e.key === 'ArrowRight') handleRate('approve');
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [bill, choice, transitioning, handleRate]);

  // Touch handlers for swipe
  const onTouchStart = useCallback((e) => {
    const touch = e.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
    isDragging.current = true;
  }, []);

  const onTouchMove = useCallback((e) => {
    if (!touchStart.current || !isDragging.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchStart.current.x;
    setDragX(dx);
    e.preventDefault();
  }, []);

  const onTouchEnd = useCallback((e) => {
    if (!touchStart.current || !isDragging.current) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStart.current.x;

    if (dx > SWIPE_THRESHOLD) {
      handleRate('approve');
    } else if (dx < -SWIPE_THRESHOLD) {
      handleRate('reject');
    }

    touchStart.current = null;
    isDragging.current = false;
    setDragX(0);
  }, [handleRate]);

  // Loading state
  if (loading) {
    return (
      <div style={styles.centerFrame}>
        <div style={styles.spinner} />
        <p style={styles.statusText}>Loading bill...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={styles.centerFrame}>
        <p style={styles.errorTitle}>Could not load bill</p>
        <p style={styles.errorDetail}>{error}</p>
        <button style={styles.retryBtn} onClick={fetchBill}>
          Try again
        </button>
      </div>
    );
  }

  if (!bill) return null;

  // Card tilt based on drag
  const rotation = Math.max(-15, Math.min(15, dragX * 0.08));
  const cardTransform = `translateX(${dragX}px) rotate(${rotation}deg)`;

  // Choice flash colors
  const choiceBackground = choice === 'approve'
    ? 'rgba(100, 200, 100, 0.12)'
    : choice === 'reject'
      ? 'rgba(200, 100, 100, 0.12)'
      : 'transparent';

  return (
    <div style={styles.arena}>
      {/* Swipe hint labels */}
      <div style={{
        ...styles.hintLabel,
        ...styles.hintLeft,
        opacity: dragX < -20 ? Math.min(1, Math.abs(dragX) / SWIPE_THRESHOLD) : 0,
      }}>
        NOPE
      </div>
      <div style={{
        ...styles.hintLabel,
        ...styles.hintRight,
        opacity: dragX > 20 ? Math.min(1, dragX / SWIPE_THRESHOLD) : 0,
      }}>
        YEP
      </div>

      {/* Card container */}
      <div
        style={{
          ...styles.cardWrapper,
          transform: cardTransform,
          background: choiceBackground,
          transition: isDragging.current ? 'none' : 'transform 0.3s ease, background 0.3s ease',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <BillCard
          bill={bill}
          side="left"
          mode={mode}
          isWinner={false}
          isLoser={false}
          touchHandlers={{}}
        />

        {/* Choice overlay */}
        {choice === 'approve' && <div style={styles.approveOverlay}>APPROVED</div>}
        {choice === 'reject' && <div style={styles.rejectOverlay}>REJECTED</div>}
      </div>

      {/* Button row */}
      <div style={styles.buttonRow}>
        <button
          style={styles.rejectBtn}
          onClick={() => handleRate('reject')}
          disabled={transitioning || !!choice}
        >
          ✕ Reject
        </button>
        <button
          style={styles.approveBtn}
          onClick={() => handleRate('approve')}
          disabled={transitioning || !!choice}
        >
          ✓ Approve
        </button>
      </div>
    </div>
  );
}

const styles = {
  arena: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    position: 'relative',
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
  cardWrapper: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    position: 'relative',
    maxWidth: 560,
    width: '100%',
    margin: '0 auto',
    border: '1px solid var(--border)',
    borderRadius: 8,
    marginTop: 16,
    marginBottom: 8,
  },
  hintLabel: {
    position: 'absolute',
    top: '40%',
    fontFamily: 'var(--mono)',
    fontSize: 18,
    fontWeight: 900,
    letterSpacing: '0.15em',
    padding: '8px 16px',
    borderRadius: 4,
    border: '2px solid',
    zIndex: 20,
    pointerEvents: 'none',
    transition: 'opacity 0.15s ease',
  },
  hintLeft: {
    left: 16,
    color: '#ff6b6b',
    borderColor: '#ff6b6b',
    background: 'rgba(255, 107, 107, 0.1)',
    transform: 'rotate(-12deg)',
  },
  hintRight: {
    right: 16,
    color: '#6bff6b',
    borderColor: '#6bff6b',
    background: 'rgba(107, 255, 107, 0.1)',
    transform: 'rotate(12deg)',
  },
  approveOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontFamily: 'var(--mono)',
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: '0.2em',
    color: '#6bff6b',
    background: 'rgba(107, 255, 107, 0.1)',
    padding: '8px 20px',
    borderRadius: 4,
    border: '1px solid #6bff6b',
    pointerEvents: 'none',
  },
  rejectOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontFamily: 'var(--mono)',
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: '0.2em',
    color: '#ff6b6b',
    background: 'rgba(255, 107, 107, 0.1)',
    padding: '8px 20px',
    borderRadius: 4,
    border: '1px solid #ff6b6b',
    pointerEvents: 'none',
  },
  buttonRow: {
    display: 'flex',
    justifyContent: 'center',
    gap: 24,
    padding: '12px 16px 20px',
    flexShrink: 0,
  },
  rejectBtn: {
    fontFamily: 'var(--mono)',
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: '0.05em',
    padding: '12px 28px',
    background: 'rgba(255, 107, 107, 0.1)',
    color: '#ff6b6b',
    border: '1px solid #ff6b6b',
    borderRadius: 4,
    cursor: 'pointer',
    transition: 'opacity 0.15s ease',
  },
  approveBtn: {
    fontFamily: 'var(--mono)',
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: '0.05em',
    padding: '12px 28px',
    background: 'rgba(107, 255, 107, 0.1)',
    color: '#6bff6b',
    border: '1px solid #6bff6b',
    borderRadius: 4,
    cursor: 'pointer',
    transition: 'opacity 0.15s ease',
  },
};
