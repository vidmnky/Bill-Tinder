'use client';

export default function BillCard({ bill, side, mode = 'balanced', isWinner, isLoser, onSwipeUp, onClick, touchHandlers }) {
  const levelColor = bill.level === 'federal' ? '#6c8cff' : '#ff8c6c';
  const levelLabel = bill.level === 'federal' ? 'FEDERAL' : bill.state || 'STATE';

  const summaryMap = {
    balanced: bill.summary,
    liberal: bill.summary_liberal || bill.summary,
    conservative: bill.summary_conservative || bill.summary,
  };
  const displaySummary = summaryMap[mode] || bill.summary;

  return (
    <div
      style={{
        ...styles.card,
        ...(isWinner ? styles.winner : {}),
        ...(isLoser ? styles.loser : {}),
      }}
      onClick={onClick}
      {...touchHandlers}
    >
      {/* Level badge + bill number */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <div style={{ ...styles.badge, marginBottom: 0, borderColor: levelColor, color: levelColor }}>
          {levelLabel}
        </div>
        {bill.bill_number && (
          <span style={styles.billNumber}>{bill.bill_number}</span>
        )}
      </div>

      {/* Title */}
      <h2 style={styles.title}>{bill.title}</h2>

      {/* Summary */}
      {bill.summary && (
        <p style={styles.summary}>{displaySummary.replace(/\\n/g, ' ').replace(/\n/g, ' ')}</p>
      )}

      {/* Impact line */}
      {(() => {
        const impactMap = {
          balanced: bill.impact_line,
          liberal: bill.impact_line_liberal || bill.impact_line,
          conservative: bill.impact_line_conservative || bill.impact_line,
        };
        const displayImpact = impactMap[mode] || bill.impact_line;
        return displayImpact ? <p style={styles.summary}>{displayImpact}</p> : null;
      })()}

      {/* Sponsor + State + Status */}
      <div style={styles.meta}>
        {bill.sponsor_name && (
          <p style={styles.sponsor}>
            {bill.sponsor_name}
            {bill.sponsor_party ? ` (${bill.sponsor_party})` : ''}
            {bill.sponsor_state ? ` · ${bill.sponsor_state}` : ''}
          </p>
        )}
        {bill.status && (
          <p style={styles.status}>{bill.status}</p>
        )}
      </div>

      {/* Win/lose indicator */}
      {isWinner && <div style={styles.winOverlay}>CHOSEN</div>}
      {isLoser && <div style={styles.loseOverlay}>—</div>}
    </div>
  );
}

const styles = {
  card: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    padding: '20px 16px',
    overflowY: 'auto',
    overflowX: 'hidden',
    cursor: 'pointer',
    position: 'relative',
    transition: 'background 0.3s ease, opacity 0.3s ease',
    background: 'var(--near-black)',
    wordBreak: 'break-word',
  },
  winner: {
    background: 'rgba(108, 140, 255, 0.08)',
  },
  loser: {
    opacity: 0.3,
  },
  badge: {
    fontFamily: 'var(--mono)',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    border: '1px solid',
    borderRadius: 3,
    padding: '4px 10px',
    alignSelf: 'flex-start',
    marginBottom: 20,
  },
  title: {
    fontFamily: 'var(--display)',
    fontSize: 24,
    fontWeight: 700,
    lineHeight: 1.35,
    color: 'var(--text)',
    marginBottom: 16,
    letterSpacing: '0.01em',
  },
  summary: {
    fontFamily: 'var(--display)',
    fontSize: 17,
    lineHeight: 1.6,
    color: 'var(--text-dim)',
    marginBottom: 20,
    flex: 1,
  },
  meta: {
    marginTop: 'auto',
    paddingTop: 12,
    borderTop: '1px solid var(--border)',
  },
  sponsor: {
    fontFamily: 'var(--mono)',
    fontSize: 14,
    color: 'var(--text-muted)',
    letterSpacing: '0.03em',
    margin: 0,
  },
  billNumber: {
    fontFamily: 'var(--mono)',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-muted)',
    letterSpacing: '0.05em',
  },
  status: {
    fontFamily: 'var(--mono)',
    fontSize: 13,
    color: 'var(--text-muted)',
    letterSpacing: '0.03em',
    marginTop: 4,
    opacity: 0.7,
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
