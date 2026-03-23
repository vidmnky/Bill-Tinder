import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';
import { fetchSwipeBills } from '../../../../lib/basin';

/**
 * GET /api/bills/single
 * Returns a single unseen bill for Rate mode.
 *
 * PRIMARY: Fetches from CM Basin API directly.
 * FALLBACK: Falls back to local Supabase cache if Basin API is down.
 *
 * Query params: session_id, scope (federal|state|all), state, source (basin|supabase)
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const state = searchParams.get('state');
  const scope = searchParams.get('scope') || 'federal';
  const sessionId = searchParams.get('session_id');
  const source = searchParams.get('source') || 'basin';

  if (!sessionId) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  }

  // Get seen bills for this session
  const { data: seenRows } = await supabase
    .from('seen_bills')
    .select('bill_id')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1000);

  const seenSet = new Set((seenRows || []).map(r => r.bill_id));

  // Try Basin API first
  if (source !== 'supabase') {
    try {
      const result = await fetchSingleFromBasin(scope, state, seenSet, sessionId);
      if (result) return NextResponse.json(result);
    } catch (err) {
      console.warn('[Single] Basin API failed, falling back to Supabase:', err.message);
    }
  }

  // Fallback: Supabase local cache
  return fetchSingleFromSupabase(scope, state, seenSet, sessionId);
}

/**
 * Fetch a single unseen bill from the CM Basin API.
 * Returns { bill } or null.
 */
async function fetchSingleFromBasin(scope, state, seenSet, sessionId) {
  const level = scope === 'federal' ? 'federal' : scope === 'state' ? 'state' : undefined;
  const basinState = (scope === 'state' && state && state !== 'all') ? state : undefined;

  const pool = await fetchSwipeBills({
    limit: 40,
    state: basinState,
    level,
  });

  if (!pool || pool.length < 1) return null;

  // Shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  // Find first unseen bill
  for (const bill of pool) {
    if (!seenSet.has(bill.id)) {
      // Record as seen (non-blocking, best-effort)
      try {
        supabase.from('seen_bills').insert({
          session_id: sessionId,
          bill_id: bill.id,
        }).then(() => {}).catch(() => {});
      } catch {
        // Non-critical
      }

      return { bill, source: 'basin' };
    }
  }

  // All seen — return first one anyway
  if (pool.length > 0) {
    return { bill: pool[0], source: 'basin' };
  }

  return null;
}

/**
 * FALLBACK: Fetch single bill from local Supabase cache.
 * Original logic preserved.
 */
async function fetchSingleFromSupabase(scope, state, seenSet, sessionId) {
  let countQuery = supabase
    .from('bills')
    .select('id', { count: 'exact', head: true })
    .eq('is_fluff', false)
    .eq('is_summarized', true);

  if (scope !== 'all') {
    countQuery = countQuery.eq('level', scope);
  }

  if (scope === 'state' && state && state !== 'all') {
    countQuery = countQuery.eq('state', state);
  }

  const { count, error: countError } = await countQuery;

  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }

  if (!count || count < 1) {
    return NextResponse.json(
      { error: 'No bills available', detail: `No eligible bills found for ${scope}${state ? ` / ${state}` : ''}` },
      { status: 404 }
    );
  }

  const selectFields = 'id, external_id, bill_number, title, summary, summary_liberal, summary_conservative, impact_line, impact_line_liberal, impact_line_conservative, sponsor_name, sponsor_party, sponsor_state, level, state, status, introduced_date';

  const poolSize = Math.min(40, count);
  const maxOffset = Math.max(0, count - poolSize);
  const offset = Math.floor(Math.random() * (maxOffset + 1));

  let poolQuery = supabase
    .from('bills')
    .select(selectFields)
    .eq('is_fluff', false)
    .eq('is_summarized', true);

  if (scope !== 'all') {
    poolQuery = poolQuery.eq('level', scope);
  }

  poolQuery = poolQuery
    .order('id')
    .range(offset, offset + poolSize - 1);

  if (scope === 'state' && state && state !== 'all') {
    poolQuery = poolQuery.eq('state', state);
  }

  const { data: pool, error: poolError } = await poolQuery;

  if (poolError || !pool || pool.length < 1) {
    return NextResponse.json(
      { error: 'No bills available', detail: `Could not fetch bill pool for ${scope}` },
      { status: 404 }
    );
  }

  // Shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  // Find first unseen
  for (const bill of pool) {
    if (!seenSet.has(bill.id)) {
      supabase.from('seen_bills').insert({
        session_id: sessionId,
        bill_id: bill.id,
      }).then(() => {});

      return NextResponse.json({ bill, source: 'supabase' });
    }
  }

  // Try second pool
  const offset2 = (offset + poolSize) % Math.max(1, count);
  let retryQuery = supabase
    .from('bills')
    .select(selectFields)
    .eq('is_fluff', false)
    .eq('is_summarized', true);

  if (scope !== 'all') {
    retryQuery = retryQuery.eq('level', scope);
  }

  retryQuery = retryQuery
    .order('id')
    .range(offset2, offset2 + poolSize - 1);

  if (scope === 'state' && state && state !== 'all') {
    retryQuery = retryQuery.eq('state', state);
  }

  const { data: pool2 } = await retryQuery;

  if (pool2 && pool2.length > 0) {
    for (let i = pool2.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool2[i], pool2[j]] = [pool2[j], pool2[i]];
    }

    for (const bill of pool2) {
      if (!seenSet.has(bill.id)) {
        supabase.from('seen_bills').insert({
          session_id: sessionId,
          bill_id: bill.id,
        }).then(() => {});

        return NextResponse.json({ bill, source: 'supabase' });
      }
    }
  }

  return NextResponse.json(
    { error: 'All bills seen', detail: 'You have rated all available bills. Check back later for new ones!' },
    { status: 404 }
  );
}
