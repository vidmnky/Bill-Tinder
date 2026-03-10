// =============================================
// LegiScan API Budget Rules — HARDCODED
// =============================================
// API Type: Pull (Free Public Service)
// Monthly limit: 30,000 queries
// License: CC BY 4.0
//
// STRATEGY: BULK DATASETS, NOT PER-BILL CALLS
//
// Instead of calling getMasterList + getBill + getBillText for each
// bill individually (which would burn 3,000+ calls per state), we use
// getDatasetList + getDataset to download entire state sessions as
// ZIP archives. Each ZIP contains every bill, vote, and person as
// individual JSON files that we process locally at zero API cost.
//
// ESTIMATED MONTHLY USAGE:
//   Initial load (one-time):
//     getDatasetList        = 1 call
//     getDataset x ~100     = ~100 calls (one per active session)
//     Total first month     = ~101 calls
//
//   Weekly refresh:
//     getDatasetList        = 1 call
//     getDataset (changed)  = ~10-20 calls (only sessions with new activity)
//     Total per week        = ~21 calls
//     Total per month       = ~84 calls
//
//   Steady-state monthly    = ~85 calls (<0.3% of 30k limit)
//
// RULES (non-negotiable):
//   1. ALWAYS use getDatasetList + getDataset for bill data. NEVER
//      use getMasterList/getBill/getBillText for bulk fetching.
//   2. ALWAYS check the monthly counter before making ANY call.
//   3. ALWAYS store dataset_hash after download. NEVER re-download
//      a dataset whose hash hasn't changed.
//   4. ALWAYS check budget BEFORE the call, log AFTER the call.
//   5. If budget check fails, abort the entire cycle — no partial runs.
//   6. All filtering (fluff detection, deduplication) happens LOCALLY
//      on the unzipped data, not via API calls.
//   7. The only time individual bill calls (getBill) are acceptable
//      is for a single user-initiated lookup, never in batch.
//   8. Rate limit: minimum 200ms between consecutive API calls.
//
// SAFETY MARGINS:
//   Soft limit:  1,000 calls/month — stop routine operations
//   Hard limit:  2,000 calls/month — absolute emergency stop
//   (Yes, these are absurdly conservative. That's the point.
//    We should never come anywhere near even the soft limit
//    with the dataset approach. If we do, something is broken.)
// =============================================

const MONTHLY_HARD_LIMIT = 30000;    // LegiScan's actual limit
const MONTHLY_SOFT_LIMIT = 1000;     // Our self-imposed routine cutoff
const MONTHLY_EMERGENCY_STOP = 2000; // Something is very wrong if we hit this
const MIN_MS_BETWEEN_CALLS = 200;    // Rate limit: 5 calls/second max

// All 50 states + DC
const ALL_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
  'DC'
];

/**
 * Get the current month string for budget tracking.
 * @returns {string} e.g. '2026-03'
 */
function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Check if we're within budget to make API calls.
 * Call this BEFORE every single API request.
 *
 * @param {number} monthlyRequestCount - current month's total calls from api_usage table
 * @returns {{ allowed: boolean, remaining: number, level: string, message: string }}
 */
function checkBudget(monthlyRequestCount) {
  if (monthlyRequestCount >= MONTHLY_EMERGENCY_STOP) {
    return {
      allowed: false,
      remaining: 0,
      level: 'EMERGENCY_STOP',
      message: `EMERGENCY STOP: ${monthlyRequestCount} calls this month (limit: ${MONTHLY_EMERGENCY_STOP}). Something is broken. No API calls allowed.`
    };
  }
  if (monthlyRequestCount >= MONTHLY_SOFT_LIMIT) {
    return {
      allowed: false,
      remaining: MONTHLY_HARD_LIMIT - monthlyRequestCount,
      level: 'SOFT_LIMIT',
      message: `Soft limit reached: ${monthlyRequestCount} calls this month. Routine operations paused. ${MONTHLY_HARD_LIMIT - monthlyRequestCount} calls remain on LegiScan's actual limit.`
    };
  }
  return {
    allowed: true,
    remaining: MONTHLY_SOFT_LIMIT - monthlyRequestCount,
    level: 'OK',
    message: `OK: ${monthlyRequestCount} calls this month. ${MONTHLY_SOFT_LIMIT - monthlyRequestCount} calls remaining before soft limit.`
  };
}

/**
 * Determine which datasets need re-downloading by comparing hashes.
 * Only datasets whose hash differs from our stored hash get fetched.
 *
 * @param {Array} remoteDatasets - from getDatasetList API response
 * @param {Map} storedHashes - Map of dataset_id -> dataset_hash from our DB
 * @returns {Array} datasets that need downloading (hash changed or new)
 */
function getChangedDatasets(remoteDatasets, storedHashes) {
  return remoteDatasets.filter(ds => {
    const storedHash = storedHashes.get(ds.dataset_id);
    // Download if: we've never seen it, OR the hash changed
    return !storedHash || storedHash !== ds.dataset_hash;
  });
}

/**
 * Pre-flight check before a fetch cycle.
 * Returns how many datasets we can safely download this cycle.
 *
 * @param {number} monthlyRequestCount - current month's calls
 * @param {number} datasetsNeeded - how many datasets have changed
 * @returns {{ proceed: boolean, maxDatasets: number, callsNeeded: number, message: string }}
 */
function preFlightCheck(monthlyRequestCount, datasetsNeeded) {
  const budget = checkBudget(monthlyRequestCount);
  if (!budget.allowed) {
    return { proceed: false, maxDatasets: 0, callsNeeded: 0, message: budget.message };
  }

  // Each cycle costs: 1 (getDatasetList) + N (getDataset per changed dataset)
  const callsNeeded = 1 + datasetsNeeded;
  const callsAvailable = MONTHLY_SOFT_LIMIT - monthlyRequestCount;

  if (callsNeeded > callsAvailable) {
    // Partial run: download only as many as budget allows
    const maxDatasets = Math.max(0, callsAvailable - 1); // -1 for getDatasetList
    return {
      proceed: maxDatasets > 0,
      maxDatasets,
      callsNeeded: 1 + maxDatasets,
      message: `Budget constrained: need ${callsNeeded} calls but only ${callsAvailable} available. Will download ${maxDatasets} of ${datasetsNeeded} datasets.`
    };
  }

  return {
    proceed: true,
    maxDatasets: datasetsNeeded,
    callsNeeded,
    message: `Clear to proceed: ${callsNeeded} calls needed, ${callsAvailable} available.`
  };
}

module.exports = {
  MONTHLY_HARD_LIMIT,
  MONTHLY_SOFT_LIMIT,
  MONTHLY_EMERGENCY_STOP,
  MIN_MS_BETWEEN_CALLS,
  ALL_STATES,
  getCurrentMonth,
  checkBudget,
  getChangedDatasets,
  preFlightCheck,
};
