'use client';

import { useState, useEffect, useCallback } from 'react';

const REFRESH_INTERVAL = 30000; // 30 seconds

export default function Leaderboard({ refreshKey = 0 }) {
  const [data, setData] = useState({ bills: [], sponsors: [], states: [] });
  const [stateFilter, setStateFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('bills'); // 'bills' | 'sponsors'

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch(`/api/leaderboard?state=${stateFilter}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error('[Leaderboard] Fetch error:', err.message);
    } finally {
      setLoading(false);
    }
  }, [stateFilter]);

  // Fetch on mount, filter change, refreshKey change, and periodic refresh
  useEffect(() => {
    setLoading(true);
    fetchLeaderboard();
  }, [fetchLeaderboard, refreshKey]);

  useEffect(() => {
    const interval = setInterval(fetchLeaderboard, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchLeaderboard]);

  const { bills, sponsors, states } = data;
  const empty = bills.length === 0 && sponsors.length === 0;

  return (
    <div style={styles.container}>
      <div style={styles.headerRow}>
        <h2 style={styles.title}>Leaderboard</h2>
        <select
          style={styles.stateSelect}
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
        >
          <option value="all">All</option>
          <option value="federal">Federal</option>
          {states.filter(s => s !== 'federal').map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Tab toggle */}
      <div style={styles.tabRow}>
        <button
          style={{ ...styles.tabBtn, ...(tab === 'bills' ? styles.tabActive : {}) }}
          onClick={() => setTab('bills')}
        >
          Top Bills
        </button>
        <button
          style={{ ...styles.tabBtn, ...(tab === 'sponsors' ? styles.tabActive : {}) }}
          onClick={() => setTab('sponsors')}
        >
          Top Sponsors
        </button>
      </div>

      {loading && empty ? (
        <p style={styles.emptyText}>Loading...</p>
      ) : empty ? (
        <p style={styles.emptyText}>No votes yet — start swiping!</p>
      ) : tab === 'bills' ? (
        <div style={styles.list}>
          {bills.map((bill, i) => (
            <div key={i} style={styles.row}>
              <span style={styles.rank}>#{i + 1}</span>
              <div style={styles.rowContent}>
                <span style={styles.rowTitle}>
                  {bill.title.length > 60 ? bill.title.slice(0, 60) + '...' : bill.title}
                </span>
                <span style={styles.rowMeta}>
                  {bill.sponsor_name || 'Unknown'} · {bill.state}
                </span>
              </div>
              <div style={styles.statsCol}>
                {bill.picks > 0 && <span style={styles.pickCount}>{bill.picks} picks</span>}
                {(bill.approvals > 0 || bill.rejections > 0) && (
                  <span style={styles.ratingCount}>
                    <span style={{ color: '#6bff6b' }}>+{bill.approvals || 0}</span>
                    {' / '}
                    <span style={{ color: '#ff6b6b' }}>-{bill.rejections || 0}</span>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={styles.list}>
          {sponsors.map((sp, i) => (
            <div key={i} style={styles.row}>
              <span style={styles.rank}>#{i + 1}</span>
              <div style={styles.rowContent}>
                <span style={styles.rowTitle}>{sp.sponsor_name}</span>
                <span style={styles.rowMeta}>
                  {sp.bill_count} bill{sp.bill_count !== 1 ? 's' : ''} · {sp.state}
                </span>
              </div>
              <span style={styles.pickCount}>{sp.total_picks}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    width: '100%',
    maxWidth: 480,
    background: 'var(--near-black)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: 16,
    marginTop: 20,
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    fontFamily: 'var(--display)',
    fontSize: 16,
    fontWeight: 700,
    color: 'var(--text)',
    letterSpacing: '0.02em',
  },
  stateSelect: {
    fontFamily: 'var(--mono)',
    fontSize: 11,
    background: 'var(--bg)',
    color: 'var(--text-dim)',
    border: '1px solid var(--border-bright)',
    borderRadius: 3,
    padding: '4px 8px',
    cursor: 'pointer',
  },
  tabRow: {
    display: 'flex',
    gap: 0,
    borderRadius: 3,
    overflow: 'hidden',
    border: '1px solid var(--border-bright)',
    marginBottom: 12,
  },
  tabBtn: {
    flex: 1,
    fontFamily: 'var(--mono)',
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: '0.04em',
    padding: '8px 12px',
    background: 'var(--bg)',
    color: 'var(--text-dim)',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  tabActive: {
    background: 'var(--accent-dim)',
    color: 'var(--accent)',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    maxHeight: 300,
    overflowY: 'auto',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 6px',
    borderRadius: 3,
    transition: 'background 0.1s ease',
  },
  rank: {
    fontFamily: 'var(--mono)',
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--accent)',
    minWidth: 28,
    textAlign: 'right',
  },
  rowContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  rowTitle: {
    fontFamily: 'var(--display)',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text)',
    letterSpacing: '0.01em',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  rowMeta: {
    fontFamily: 'var(--mono)',
    fontSize: 10,
    color: 'var(--text-muted)',
    letterSpacing: '0.03em',
  },
  statsCol: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 2,
    minWidth: 60,
  },
  pickCount: {
    fontFamily: 'var(--mono)',
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--text)',
    textAlign: 'right',
  },
  ratingCount: {
    fontFamily: 'var(--mono)',
    fontSize: 10,
    textAlign: 'right',
  },
  emptyText: {
    fontFamily: 'var(--mono)',
    fontSize: 11,
    color: 'var(--text-muted)',
    textAlign: 'center',
    padding: '20px 0',
    letterSpacing: '0.04em',
  },
};
