'use client';

import { useState } from 'react';

const STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' }, { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' }, { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' }, { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' }, { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' }, { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' }, { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' }, { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' }, { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' }, { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' }, { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' }, { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' }, { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' }, { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' }, { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' }, { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' },
  { code: 'DC', name: 'Washington DC' },
];

export default function StateSelect({ onSelect }) {
  const [scope, setScope] = useState('federal');
  const [selectedState, setSelectedState] = useState('');

  const handleGo = () => {
    if (scope === 'federal') {
      onSelect({ scope: 'federal', state: null });
    } else if (selectedState) {
      onSelect({ scope: 'state', state: selectedState });
    }
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.logo}>LegisSwipe</h1>
      <p style={styles.tagline}>Which bill matters more? You decide.</p>

      {/* Scope toggle */}
      <div style={styles.toggleRow}>
        <button
          style={{ ...styles.toggleBtn, ...(scope === 'federal' ? styles.toggleActive : {}) }}
          onClick={() => setScope('federal')}
        >
          Federal
        </button>
        <button
          style={{ ...styles.toggleBtn, ...(scope === 'state' ? styles.toggleActive : {}) }}
          onClick={() => setScope('state')}
        >
          State
        </button>
      </div>

      {/* State picker (only if state scope) */}
      {scope === 'state' && (
        <div style={styles.stateGrid}>
          {STATES.map(s => (
            <button
              key={s.code}
              style={{
                ...styles.stateBtn,
                ...(selectedState === s.code ? styles.stateActive : {}),
              }}
              onClick={() => setSelectedState(s.code)}
            >
              {s.code}
            </button>
          ))}
        </div>
      )}

      {/* Go button */}
      <button
        style={{
          ...styles.goBtn,
          ...(scope === 'state' && !selectedState ? styles.goBtnDisabled : {}),
        }}
        disabled={scope === 'state' && !selectedState}
        onClick={handleGo}
      >
        {scope === 'federal' ? 'Compare Federal Bills' : `Compare ${selectedState || '...'} Bills`}
      </button>
    </div>
  );
}

const styles = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 20,
  },
  logo: {
    fontFamily: 'var(--display)',
    fontSize: 36,
    fontWeight: 900,
    letterSpacing: '-0.02em',
    color: 'var(--text)',
  },
  tagline: {
    fontFamily: 'var(--mono)',
    fontSize: 12,
    color: 'var(--text-muted)',
    letterSpacing: '0.05em',
    marginBottom: 12,
  },
  toggleRow: {
    display: 'flex',
    gap: 0,
    borderRadius: 4,
    overflow: 'hidden',
    border: '1px solid var(--border-bright)',
  },
  toggleBtn: {
    fontFamily: 'var(--mono)',
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: '0.05em',
    padding: '10px 24px',
    background: 'var(--near-black)',
    color: 'var(--text-dim)',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  toggleActive: {
    background: 'var(--accent-dim)',
    color: 'var(--accent)',
  },
  stateGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))',
    gap: 6,
    maxWidth: 480,
    width: '100%',
    maxHeight: 260,
    overflow: 'auto',
    padding: '8px 0',
  },
  stateBtn: {
    fontFamily: 'var(--mono)',
    fontSize: 11,
    fontWeight: 500,
    padding: '8px 4px',
    background: 'var(--near-black)',
    color: 'var(--text-dim)',
    border: '1px solid var(--border)',
    borderRadius: 3,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    textAlign: 'center',
  },
  stateActive: {
    background: 'var(--accent-dim)',
    color: 'var(--accent)',
    borderColor: 'var(--accent)',
  },
  goBtn: {
    fontFamily: 'var(--mono)',
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: '0.05em',
    padding: '14px 32px',
    background: 'var(--accent)',
    color: '#0a0a0f',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    marginTop: 8,
    transition: 'opacity 0.15s ease',
  },
  goBtnDisabled: {
    opacity: 0.3,
    cursor: 'not-allowed',
  },
};
