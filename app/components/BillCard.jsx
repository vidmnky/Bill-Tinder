'use client';

export default function BillCard({ bill, side, isWinner, isLoser, onSwipeUp, touchHandlers }) {
  const levelColor = bill.level === 'federal' ? '#6c8cff' : '#ff8c6c';
  const levelLabel = bill.level === 'federal' ? 'FEDERAL' : bill.state || 'STATE';

  return (
    <div
      style={{
        ...styles.card,
        ...(isWinner ? styles.winner : {}),
        ...(isLoser ? styles.loser : {}),
      }}
      onClick={onSwipeUp}
      {...touchHandlers}
    >
      {/* Level badge */}
      <div style={{ ...styles.badge, borderColor: levelColor, color: levelColor }}>
        {levelLabel}
      </div>

      {/* Title */}
      <h2 style={styles.title}>{bill.title}</h2>

      {/* Summary */}
      {bill.summary && (
        <p style={styles.summary}>{bill.summary}</p>
      )}

      {/* Sponsor */}
      {bill.sponsor_name && (
        <p style={styles.sponsor}>
          {bill.sponsor_name}
          {bill.sponsor_state ? ` (${bill.sponsor_state})` : ''}
        </p>
      )}

      {/* Win/lose indicator */}
      {isWinner && <div style={styles.winOverlay}>CHOSEN</div>}
      {isLoser && <div style={styles.loseOverlay}>—</div>}
    </div>
  );
}

const styles = {
  card: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: '24px 20px',
    overflow: 'auto',
    cursor: 'pointer',
    position: 'relative',
    transition: 'background 0.3s ease, opacity 0.3s ease',
    background: 'var(--near-black)',
  },
  winner: {
    background: 'rgba(108, 140, 255, 0.08)',
  },
  loser: {
    opacity: 0.3,
  },
  badge: {
    fontFamily: 'var(--mono)',
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    border: '1px solid',
    borderRadius: 3,
    padding: '3px 8px',
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  title: {
    fontFamily: 'var(--display)',
    fontSize: 16,
    fontWeight: 700,
    lineHeight: 1.4,
    color: 'var(--text)',
    marginBottom: 12,
    letterSpacing: '0.01em',
  },
  summary: {
    fontFamily: 'var(--display)',
    fontSize: 13,
    lineHeight: 1.65,
    color: 'var(--text-dim)',
    marginBottom: 16,
    flex: 1,
  },
  sponsor: {
    fontFamily: 'var(--mono)',
    fontSize: 11,
    color: 'var(--text-muted)',
    letterSpacing: '0.03em',
    marginTop: 'auto',
  },
  winOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontFamily: 'var(--mono)',
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: '0.2em',
    color: 'var(--accent)',
    background: 'var(--accent-dim)',
    padding: '8px 20px',
    borderRadius: 4,
    border: '1px solid var(--accent)',
    pointerEvents: 'none',
  },
  loseOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontFamily: 'var(--mono)',
    fontSize: 24,
    color: 'var(--text-muted)',
    pointerEvents: 'none',
  },
};
