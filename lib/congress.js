// =============================================
// Congress.gov API Client
// =============================================
// Fetches recent federal bills with detail and text.
// API docs: https://api.congress.gov/
// Rate limit: 5,000 requests/hour (generous)
// =============================================

const BASE_URL = 'https://api.congress.gov/v3';

/**
 * Make an authenticated request to Congress.gov API.
 */
async function congressFetch(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set('api_key', process.env.CONGRESS_API_KEY);
  url.searchParams.set('format', 'json');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`[Congress] HTTP ${res.status} on ${path}`);
  }
  return res.json();
}

/**
 * Fetch recent bills from Congress.gov.
 * Returns up to `limit` bills from the current congress, newest first.
 *
 * @param {number} limit - max bills to fetch (default 250)
 * @returns {Array} array of bill summary objects
 */
export async function fetchRecentBills(limit = 250) {
  const bills = [];
  let offset = 0;
  const pageSize = 250; // Congress.gov max per page

  while (bills.length < limit) {
    // Only fetch from current congress (119th = 2025-2027)
    const data = await congressFetch('/bill/119', {
      limit: Math.min(pageSize, limit - bills.length),
      offset,
      sort: 'updateDate+desc',
    });

    const batch = data.bills || [];
    if (batch.length === 0) break;

    bills.push(...batch);
    offset += batch.length;

    // Respect rate limits
    await new Promise(r => setTimeout(r, 200));
  }

  return bills;
}

/**
 * Fetch detail for a single bill.
 *
 * @param {string} congress - congress number (e.g. '118')
 * @param {string} type - bill type (e.g. 'hr', 's', 'hjres')
 * @param {string} number - bill number
 * @returns {object} bill detail
 */
export async function fetchBillDetail(congress, type, number) {
  const data = await congressFetch(`/bill/${congress}/${type}/${number}`);
  return data.bill || null;
}

/**
 * Fetch the text of a bill (first available text version).
 * Returns plain text content or null if not available.
 *
 * @param {string} congress
 * @param {string} type
 * @param {string} number
 * @returns {string|null} bill text (truncated to ~3000 chars for summarization)
 */
export async function fetchBillText(congress, type, number) {
  const data = await congressFetch(`/bill/${congress}/${type}/${number}/text`);
  const versions = data.textVersions || [];

  if (versions.length === 0) return null;

  // Try to find a text format URL
  const latest = versions[0];
  const textFormat = latest.formats?.find(f =>
    f.type === 'Formatted Text' || f.type === 'PDF'
  );

  if (!textFormat?.url) return null;

  // Fetch the actual text content
  try {
    const textRes = await fetch(textFormat.url + `?api_key=${process.env.CONGRESS_API_KEY}`);
    if (!textRes.ok) return null;
    const fullText = await textRes.text();
    // Truncate to ~3000 chars for summarization
    return fullText.slice(0, 3000);
  } catch {
    return null;
  }
}
