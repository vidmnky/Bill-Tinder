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

const MODES = [
  { id: 'balanced', label: 'Just the Facts', desc: 'Pros and cons, no spin' },
  { id: 'liberal', label: 'Progressive Lens', desc: 'Workers, equity, environment' },
  { id: 'conservative', label: 'Conservative Lens', desc: 'Taxes, freedom, limited govt' },
];

export default function StateSelect({ onSelect, onChange }) {
  const [scope, setScope] = useState('federal');
  const [selectedState, setSelectedState] = useState('');
  const [mode, setMode] = useState('balanced');

  // Report selection changes to parent
  const updateScope = (s) => { setScope(s); onChange?.({ scope: s, state: selectedState, mode }); };
  const updateState = (s) => { setSelectedState(s); onChange?.({ scope, state: s, mode }); };
  const updateMode = (m) => { setMode(m); onChange?.({ scope, state: selectedState, mode: m }); };

  const handleGo = () => {
    if (scope === 'federal') {
      onSelect({ scope: 'federal', state: null, mode });
    } else if (selectedState === 'all') {
      onSelect({ scope: 'state', state: null, mode });
    } else if (selectedState) {
      onSelect({ scope: 'state', state: selectedState, mode });
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
          onClick={() => updateScope('federal')}
        >
          Federal
        </button>
        <button
          style={{ ...styles.toggleBtn, ...(scope === 'state' ? styles.toggleActive : {}) }}
          onClick={() => updateScope('state')}
        >
          State
        </button>
      </div>

      {/* State picker (only if state scope) */}
      {scope === 'state' && (
        <div style={styles.stateGrid}>
          <button
            style={{
              ...styles.stateBtn,
              ...styles.allBtn,
              ...(selectedState === 'all' ? styles.stateActive : {}),
            }}
            onClick={() => updateState('all')}
          >
            ALL
          </button>
          {STATES.map(s => (
            <button
              key={s.code}
              style={{
                ...styles.stateBtn,
                ...(selectedState === s.code ? styles.stateActive : {}),
              }}
              onClick={() => updateState(s.code)}
            >
              {s.code}
            </button>
          ))}
        </div>
      )}

      {/* Mode selector */}
      <div style={styles.modeSection}>
        <p style={styles.modeLabel}>How should bills be described?</p>
        <div style={styles.modeRow}>
          {MODES.map(m => (
            <button
              key={m.id}
              style={{
                ...styles.modeBtn,
                ...(mode === m.id ? styles.modeActive : {}),
              }}
              onClick={() => updateMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Go button */}
      <button
        style={{
          ...styles.goBtn,
          ...(scope === 'state' && !selectedState ? styles.goBtnDisabled : {}),
        }}
        disabled={scope === 'state' && !selectedState}
        onClick={handleGo}
      >
        {scope === 'federal' ? 'Compare Federal Bills' : selectedState === 'all' ? 'Compare All State Bills' : `Compare ${selectedState || '...'} Bills`}
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
  allBtn: {
    fontWeight: 700,
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
  modeSection: {
    width: '100%',
    maxWidth: 480,
    marginTop: 4,
  },
  modeLabel: {
    fontFamily: 'var(--mono)',
    fontSize: 11,
    color: 'var(--text-muted)',
    letterSpacing: '0.05em',
    marginBottom: 8,
    textAlign: 'center',
  },
  modeRow: {
    display: 'flex',
    gap: 8,
  },
  modeBtn: {
    flex: 1,
    padding: '10px 8px',
    background: 'var(--near-black)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    fontFamily: 'var(--mono)',
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--text)',
    letterSpacing: '0.03em',
    textAlign: 'center',
  },
  modeActive: {
    background: 'var(--accent-dim)',
    borderColor: 'var(--accent)',
    color: 'var(--accent)',
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
