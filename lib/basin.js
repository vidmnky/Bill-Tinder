// =============================================
// Civic Mirror Basin API Client
// =============================================
// Reads bills from the Civic Mirror universal bill basin.
// This is the PRIMARY data source for LegisSwipe.
// Supabase remains as local cache for voting/session data.
//
// Endpoints:
//   GET /api/basin/swipe/   — bills formatted for swipe cards
//   GET /api/basin/bills/   — paginated bill list
//   GET /api/basin/bills/<pk>/ — full bill detail
//   GET /api/basin/hot/     — hot bills (no auth)
// =============================================

const BASIN_BASE = process.env.BASIN_API_URL || 'https://determined-presence-production-cd4f.up.railway.app';
const BASIN_KEY = process.env.BASIN_API_KEY || '';

/**
 * Make an authenticated request to the CM Basin API.
 *
 * @param {string} path — e.g. '/api/basin/swipe/'
 * @param {object} params — query string params
 * @param {object} options — { noAuth: true } to skip API key
 * @returns {object} parsed JSON response
 */
async function basinFetch(path, params = {}, options = {}) {
  const url = new URL(`${BASIN_BASE}${path}`);

  if (!options.noAuth && BASIN_KEY) {
    url.searchParams.set('api_key', BASIN_KEY);
  }

  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { 'Accept': 'application/json' },
    // Next.js fetch cache: revalidate every 60 seconds
    next: { revalidate: 60 },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[Basin] HTTP ${res.status} on ${path}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

/**
 * Fetch bills formatted for swipe cards.
 *
 * @param {object} opts
 * @param {number} opts.limit — max bills to return (default 20)
 * @param {string} opts.state — 2-letter state code (optional)
 * @param {string} opts.level — 'federal' or 'state' (optional)
 * @returns {Array} array of bill objects ready for BillCard
 */
export async function fetchSwipeBills({ limit = 20, state, level } = {}) {
  const data = await basinFetch('/api/basin/swipe/', { limit, state, level });
  return (data.bills || []).map(mapBasinBillToLocal);
}

/**
 * Fetch paginated bill list from basin.
 *
 * @param {object} opts
 * @param {number} opts.limit
 * @param {string} opts.state
 * @param {string} opts.level
 * @param {boolean} opts.summarized — only summarized bills
 * @param {boolean} opts.hot — only hot bills
 * @param {string} opts.q — search query
 * @returns {Array} array of bill objects
 */
export async function fetchBasinBills({ limit = 100, state, level, summarized, hot, q } = {}) {
  const data = await basinFetch('/api/basin/bills/', {
    limit,
    state,
    level,
    summarized: summarized ? 'true' : undefined,
    hot: hot ? 'true' : undefined,
    q,
  });
  // The response may be { results: [...] } or { bills: [...] } depending on DRF config
  const bills = data.results || data.bills || [];
  return bills.map(mapBasinBillToLocal);
}

/**
 * Fetch a single bill by its CM primary key.
 *
 * @param {number} pk — CM core_mediaitem primary key
 * @returns {object} bill object
 */
export async function fetchBasinBillDetail(pk) {
  const data = await basinFetch(`/api/basin/bills/${pk}/`);
  return mapBasinBillToLocal(data);
}

/**
 * Fetch hot bills (no auth required).
 *
 * @param {object} opts
 * @param {number} opts.limit
 * @param {string} opts.state
 * @returns {Array} array of bill objects
 */
export async function fetchHotBills({ limit = 50, state } = {}) {
  const data = await basinFetch('/api/basin/hot/', { limit, state }, { noAuth: true });
  const bills = data.results || data.bills || data || [];
  return Array.isArray(bills) ? bills.map(mapBasinBillToLocal) : [];
}

/**
 * Map a basin API bill object to the field names Bill-Tinder's
 * BillCard component expects.
 *
 * Basin API returns:
 *   id, external_id, title, summary, summary_liberal, summary_conservative,
 *   impact_line, impact_line_liberal, impact_line_conservative,
 *   sponsor_name, sponsor_party, sponsor_state, level, state, source,
 *   bill_number, stage, is_hot, hot_score, url, cm_pk
 *
 * BillCard expects:
 *   id, external_id, bill_number, title, summary, summary_liberal,
 *   summary_conservative, impact_line, impact_line_liberal,
 *   impact_line_conservative, sponsor_name, sponsor_party, sponsor_state,
 *   level, state, status, introduced_date
 *
 * @param {object} b — basin bill object
 * @returns {object} bill object compatible with BillCard
 */
function mapBasinBillToLocal(b) {
  if (!b) return null;
  return {
    // Use the CM UUID as the bill's ID for display purposes.
    // For voting, we use cm_pk as the stable identifier.
    id: b.id || b.cm_pk,
    cm_pk: b.cm_pk,
    external_id: b.external_id || b.bill_id,
    bill_number: b.bill_number || '',
    title: b.title || 'Untitled',
    summary: b.summary || '',
    summary_liberal: b.summary_liberal || '',
    summary_conservative: b.summary_conservative || '',
    impact_line: b.impact_line || '',
    impact_line_liberal: b.impact_line_liberal || '',
    impact_line_conservative: b.impact_line_conservative || '',
    sponsor_name: b.sponsor_name || '',
    sponsor_party: b.sponsor_party || '',
    sponsor_state: b.sponsor_state || '',
    level: b.level || 'federal',
    state: b.state || '',
    status: b.stage || '',
    source: b.source || '',
    is_hot: b.is_hot || false,
    hot_score: b.hot_score || 0,
    url: b.url || '',
    introduced_date: b.introduced_date || null,
  };
}
