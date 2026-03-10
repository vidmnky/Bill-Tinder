// =============================================
// LegiScan API Client
// =============================================
// BULK DATASET APPROACH ONLY.
// This client uses getDatasetList + getDataset to download
// entire state sessions as ZIPs. Individual bill lookups
// (getBill, getBillText, etc.) are NOT exposed for batch use.
//
// Every single API call is:
//   1. Budget-checked BEFORE execution
//   2. Rate-limited (200ms minimum between calls)
//   3. Logged to api_usage table AFTER execution
//   4. Wrapped in error handling that fails safe (no retry loops)
// =============================================

import { MIN_MS_BETWEEN_CALLS, checkBudget, getCurrentMonth } from './legiscan-budget.js';

const BASE_URL = 'https://api.legiscan.com/';

let lastCallTimestamp = 0;

/**
 * Enforce minimum delay between API calls.
 */
async function rateLimit() {
  const now = Date.now();
  const elapsed = now - lastCallTimestamp;
  if (elapsed < MIN_MS_BETWEEN_CALLS) {
    await new Promise(resolve => setTimeout(resolve, MIN_MS_BETWEEN_CALLS - elapsed));
  }
  lastCallTimestamp = Date.now();
}

/**
 * Core API call wrapper. Every LegiScan request goes through here.
 *
 * @param {string} operation - API operation name (e.g. 'getDatasetList')
 * @param {object} params - additional query parameters
 * @param {object} supabaseAdmin - Supabase service role client for logging
 * @param {number} monthlyCount - current month's API call count
 * @returns {object} parsed JSON response
 * @throws {Error} if budget exceeded, API error, or network failure
 */
async function apiCall(operation, params, supabaseAdmin, monthlyCount) {
  // 1. Budget check — BEFORE the call
  const budget = checkBudget(monthlyCount);
  if (!budget.allowed) {
    throw new Error(`[LegiScan] BUDGET BLOCKED: ${budget.message}`);
  }

  // 2. Rate limit
  await rateLimit();

  // 3. Build URL
  const url = new URL(BASE_URL);
  url.searchParams.set('key', process.env.LEGISCAN_API_KEY);
  url.searchParams.set('op', operation);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  // 4. Make the call
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`[LegiScan] HTTP ${response.status} on ${operation}`);
  }

  const data = await response.json();

  // 5. Check for API-level errors
  if (data.status === 'ERROR') {
    throw new Error(`[LegiScan] API error on ${operation}: ${data.alert?.message || JSON.stringify(data)}`);
  }

  // 6. Log to api_usage — AFTER successful call
  const month = getCurrentMonth();
  await supabaseAdmin.from('api_usage').insert({
    source: 'legiscan',
    operation,
    month,
  });

  return data;
}

/**
 * Get the current monthly API call count from the database.
 *
 * @param {object} supabaseAdmin - Supabase service role client
 * @returns {number} total calls this month
 */
export async function getMonthlyCallCount(supabaseAdmin) {
  const month = getCurrentMonth();
  const { count, error } = await supabaseAdmin
    .from('api_usage')
    .select('*', { count: 'exact', head: true })
    .eq('source', 'legiscan')
    .eq('month', month);

  if (error) {
    // If we can't read usage, assume the worst — block calls
    console.error('[LegiScan] Failed to read api_usage, blocking calls:', error.message);
    return Infinity;
  }

  return count || 0;
}

/**
 * Fetch the list of all available session datasets.
 * Returns array of { session_id, state, dataset_hash, dataset_date, ... }
 *
 * Cost: 1 API call.
 *
 * @param {object} supabaseAdmin - Supabase service role client
 * @returns {Array} dataset list
 */
export async function fetchDatasetList(supabaseAdmin) {
  const monthlyCount = await getMonthlyCallCount(supabaseAdmin);
  const data = await apiCall('getDatasetList', {}, supabaseAdmin, monthlyCount);
  // Response shape: { status: 'OK', datasetlist: [ { ... }, ... ] }
  return data.datasetlist || [];
}

/**
 * Download a single session dataset (ZIP archive, base64 encoded).
 * Contains every bill, vote, and person for that session.
 *
 * Cost: 1 API call.
 *
 * @param {number} sessionId - the session ID from getDatasetList
 * @param {string} accessKey - the access_key from getDatasetList
 * @param {object} supabaseAdmin - Supabase service role client
 * @returns {object} { zip: Buffer, dataset_hash: string, ... }
 */
export async function fetchDataset(sessionId, accessKey, supabaseAdmin) {
  const monthlyCount = await getMonthlyCallCount(supabaseAdmin);
  const data = await apiCall('getDataset', {
    id: sessionId,
    access_key: accessKey,
  }, supabaseAdmin, monthlyCount);

  // Response shape: { status: 'OK', dataset: { zip: 'base64...', ... } }
  const dataset = data.dataset;
  if (!dataset || !dataset.zip) {
    throw new Error(`[LegiScan] No ZIP data in dataset response for session ${sessionId}`);
  }

  // Decode base64 ZIP to Buffer
  dataset.zipBuffer = Buffer.from(dataset.zip, 'base64');
  delete dataset.zip; // Free the base64 string from memory

  return dataset;
}
