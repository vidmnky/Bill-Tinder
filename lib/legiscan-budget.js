// =============================================
// LegiScan API Budget Rules — HARDCODED
// =============================================
// API Type: Pull (Free Public Service)
// Monthly limit: 30,000 queries
// License: CC BY 4.0
//
// STRATEGY: Treat the budget like it's 20,000/month (67% of actual).
// That gives us a ~10,000 query safety buffer every month.
// If we somehow blow past the soft cap, hard-stop at 28,000.
//
// Budget allocation per cron cycle (runs every 6 hours = ~120 runs/month):
//   - getMasterList: 1 call per state per cycle
//   - getBill: 1 call per new bill discovered
//   - getBillText: 1 call per bill needing summarization
//   - Target: ~7 states per cycle, rotating through all 50 over ~7 cycles
//   - Max new bills per cycle: 50 (hard cap)
//
// RULES (non-negotiable):
//   1. NEVER call getBillText unless the bill passed the fluff filter
//   2. NEVER re-fetch a bill that's already in the database
//   3. ALWAYS check the monthly counter before making ANY call
//   4. Cache aggressively — if it's in the DB, don't call the API
//   5. Use getMasterList (1 call) instead of getSearch (costs more, less predictable)
//   6. Rotate states slowly — don't fetch all 50 in one cycle
// =============================================

const MONTHLY_HARD_LIMIT = 30000;
const MONTHLY_SOFT_LIMIT = 20000;  // Stop normal operations here
const MONTHLY_EMERGENCY_STOP = 28000; // Absolute hard stop — no calls past this
const STATES_PER_CYCLE = 7;
const MAX_NEW_BILLS_PER_CYCLE = 50;
const MAX_BILL_TEXT_FETCHES_PER_CYCLE = 30;

// Estimated cost per cron cycle:
//   7 getMasterList calls = 7
//   ~50 getBill calls (new bills only) = 50
//   ~30 getBillText calls (filtered bills only) = 30
//   Total: ~87 calls per cycle
//   x 120 cycles/month = ~10,440/month (well within soft limit)

// All 50 states + DC, territories excluded to save budget
const ALL_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
  'DC'
];

/**
 * Get which states to fetch this cycle.
 * Rotates through ALL_STATES in groups of STATES_PER_CYCLE.
 * Uses the current date to determine the rotation offset.
 */
function getStatesForCycle() {
  const now = new Date();
  // Each 6-hour window gets a cycle number
  const hoursSinceEpoch = Math.floor(now.getTime() / (1000 * 60 * 60));
  const cycleNumber = Math.floor(hoursSinceEpoch / 6);
  const offset = (cycleNumber * STATES_PER_CYCLE) % ALL_STATES.length;

  const states = [];
  for (let i = 0; i < STATES_PER_CYCLE; i++) {
    states.push(ALL_STATES[(offset + i) % ALL_STATES.length]);
  }
  return states;
}

/**
 * Check if we're within budget to make API calls.
 * Returns { allowed: boolean, remaining: number, level: string }
 */
function checkBudget(monthlyRequestCount) {
  if (monthlyRequestCount >= MONTHLY_EMERGENCY_STOP) {
    return { allowed: false, remaining: 0, level: 'EMERGENCY_STOP' };
  }
  if (monthlyRequestCount >= MONTHLY_SOFT_LIMIT) {
    return { allowed: false, remaining: MONTHLY_HARD_LIMIT - monthlyRequestCount, level: 'SOFT_LIMIT' };
  }
  return {
    allowed: true,
    remaining: MONTHLY_SOFT_LIMIT - monthlyRequestCount,
    level: 'OK'
  };
}

module.exports = {
  MONTHLY_HARD_LIMIT,
  MONTHLY_SOFT_LIMIT,
  MONTHLY_EMERGENCY_STOP,
  STATES_PER_CYCLE,
  MAX_NEW_BILLS_PER_CYCLE,
  MAX_BILL_TEXT_FETCHES_PER_CYCLE,
  ALL_STATES,
  getStatesForCycle,
  checkBudget,
};
