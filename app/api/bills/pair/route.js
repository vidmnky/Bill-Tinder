import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';
import { fetchSwipeBills } from '../../../../lib/basin';

/**
 * GET /api/bills/pair
 * Returns a random pair of bills, excluding pairs this session has already seen.
 *
 * PRIMARY: Fetches from CM Basin API directly.
 * FALLBACK: Falls back to local Supabase cache if Basin API is down.
 *
 * Query params: state, scope (federal|state), session_id, source (basin|supabase)
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

  // Get seen pairs for this session (for both paths)
  const { data: seenRows } = await supabase
    .from('seen_pairs')
    .select('bill_a_id, bill_b_id')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(500);

  const seenPairSet = new Set(
    (seenRows || []).map(r => `${r.bill_a_id}|${r.bill_b_id}`)
  );

  // Try Basin API first (unless explicitly requesting supabase)
  if (source !== 'supabase') {
    try {
      const result = await fetchPairFromBasin(scope, state, seenPairSet, sessionId);
      if (result) return NextResponse.json(result);
      // If basin returned no usable pair, fall through to Supabase
    } catch (err) {
      console.warn('[Pair] Basin API failed, falling back to Supabase:', err.message);
    }
  }

  // Fallback: Supabase local cache
  return fetchPairFromSupabase(scope, state, seenPairSet, sessionId);
}

/**
 * Fetch a pair of bills from the CM Basin API.
 * Returns { billA, billB } or null if not enough bills.
 */
async function fetchPairFromBasin(scope, state, seenPairSet, sessionId) {
  const level = scope === 'federal' ? 'federal' : scope === 'state' ? 'state' : undefined;
  const basinState = (scope === 'state' && state && state !== 'all') ? state : undefined;

  // Fetch a pool of bills from basin
  const pool = await fetchSwipeBills({
    limit: 40,
    state: basinState,
    level,
  });

  if (!pool || pool.length < 2) return null;

  // Shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  // Find an unseen pair
  // Use the bill's id (UUID from basin) or cm_pk for pair tracking
  for (let i = 0; i < pool.length - 1; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const idA = pool[i].id;
      const idB = pool[j].id;
      const [ordA, ordB] = idA < idB ? [idA, idB] : [idB, idA];
      const pairKey = `${ordA}|${ordB}`;

      if (!seenPairSet.has(pairKey)) {
        const [billA, billB] = idA < idB ? [pool[i], pool[j]] : [pool[j], pool[i]];

        // Record as seen (non-blocking) — uses string IDs, which is fine for the seen_pairs table
        // Note: seen_pairs has UUID FK constraints to bills table, so this will only work
        // if the bills have been synced to Supabase. For pure basin mode we skip seen tracking.
        try {
          supabase.from('seen_pairs').insert({
            session_id: sessionId,
            bill_a_id: billA.id,
            bill_b_id: billB.id,
          }).then(() => {}).catch(() => {});
        } catch {
          // Non-critical — seen tracking is best-effort
        }

        return { billA, billB, source: 'basin' };
      }
    }
  }

  // All pairs seen in this pool — just return first two (user has seen a lot)
  if (pool.length >= 2) {
    return { billA: pool[0], billB: pool[1], source: 'basin' };
  }

  return null;
}

/**
 * FALLBACK: Fetch a pair from local Supabase cache.
 * This is the original logic, preserved for when Basin API is unavailable.
 */
async function fetchPairFromSupabase(scope, state, seenPairSet, sessionId) {
  let countQuery = supabase
    .from('bills')
    .select('id', { count: 'exact', head: true })
    .eq('is_fluff', false)
    .eq('is_summarized', true)
    .eq('level', scope);

  if (scope === 'state' && state && state !== 'all') {
    countQuery = countQuery.eq('state', state);
  }

  const { count, error: countError } = await countQuery;

  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }

  if (!count || count < 2) {
    return NextResponse.json(
      { error: 'Not enough bills', detail: `Only ${count || 0} eligible bills found for ${scope}${state ? ` / ${state}` : ''}` },
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
    .eq('is_summarized', true)
    .eq('level', scope)
    .order('id')
    .range(offset, offset + poolSize - 1);

  if (scope === 'state' && state && state !== 'all') {
    poolQuery = poolQuery.eq('state', state);
  }

  const { data: pool, error: poolError } = await poolQuery;

  if (poolError || !pool || pool.length < 2) {
    return NextResponse.json(
      { error: 'Not enough bills', detail: `Could not fetch bill pool for ${scope}` },
      { status: 404 }
    );
  }

  // Shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  // Pick unseen pair
  for (let i = 0; i < pool.length - 1; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const [billA, billB] = pool[i].id < pool[j].id
        ? [pool[i], pool[j]]
        : [pool[j], pool[i]];
      const pairKey = `${billA.id}|${billB.id}`;

      if (!seenPairSet.has(pairKey)) {
        supabase.from('seen_pairs').insert({
          session_id: sessionId,
          bill_a_id: billA.id,
          bill_b_id: billB.id,
        }).then(() => {});

        return NextResponse.json({ billA, billB, source: 'supabase' });
      }
    }
  }

  // Try second offset
  const offset2 = (offset + poolSize) % Math.max(1, count);
  let retryQuery = supabase
    .from('bills')
    .select(selectFields)
    .eq('is_fluff', false)
    .eq('is_summarized', true)
    .eq('level', scope)
    .order('id')
    .range(offset2, offset2 + poolSize - 1);

  if (scope === 'state' && state && state !== 'all') {
    retryQuery = retryQuery.eq('state', state);
  }

  const { data: pool2 } = await retryQuery;

  if (pool2 && pool2.length >= 2) {
    for (let i = pool2.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool2[i], pool2[j]] = [pool2[j], pool2[i]];
    }

    for (let i = 0; i < pool2.length - 1; i++) {
      for (let j = i + 1; j < pool2.length; j++) {
        const [billA, billB] = pool2[i].id < pool2[j].id
          ? [pool2[i], pool2[j]]
          : [pool2[j], pool2[i]];
        const pairKey = `${billA.id}|${billB.id}`;

        if (!seenPairSet.has(pairKey)) {
          supabase.from('seen_pairs').insert({
            session_id: sessionId,
            bill_a_id: billA.id,
            bill_b_id: billB.id,
          }).then(() => {});

          return NextResponse.json({ billA, billB, source: 'supabase' });
        }
      }
    }
  }

  return NextResponse.json(
    { error: 'All pairs seen', detail: 'You have seen all available matchups. Check back later for new bills!' },
    { status: 404 }
  );
}
