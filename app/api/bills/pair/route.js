import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

/**
 * GET /api/bills/pair
 * Returns a random pair of bills, excluding pairs this session has already seen.
 * Fetches a pool of bills in ONE query, then picks an unseen pair locally.
 *
 * Query params: state, scope (federal|state), session_id
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const state = searchParams.get('state');
  const scope = searchParams.get('scope') || 'federal';
  const sessionId = searchParams.get('session_id');

  if (!sessionId) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  }

  // Get count of eligible bills (fast — head-only count)
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

  // Get seen pairs for this session (limit to last 500 to avoid huge memory loads)
  const { data: seenRows } = await supabase
    .from('seen_pairs')
    .select('bill_a_id, bill_b_id')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(500);

  const seenPairSet = new Set(
    (seenRows || []).map(r => `${r.bill_a_id}|${r.bill_b_id}`)
  );

  const selectFields = 'id, external_id, bill_number, title, summary, summary_liberal, summary_conservative, impact_line, impact_line_liberal, impact_line_conservative, sponsor_name, sponsor_party, sponsor_state, level, state, status, introduced_date';

  // Fetch a pool of bills in ONE query (much faster than individual offset fetches)
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

  // Shuffle the pool for randomness
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  // Pick the first unseen pair from the shuffled pool
  for (let i = 0; i < pool.length - 1; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const [billA, billB] = pool[i].id < pool[j].id
        ? [pool[i], pool[j]]
        : [pool[j], pool[i]];
      const pairKey = `${billA.id}|${billB.id}`;

      if (!seenPairSet.has(pairKey)) {
        // Record this pair as seen (non-blocking)
        supabase.from('seen_pairs').insert({
          session_id: sessionId,
          bill_a_id: billA.id,
          bill_b_id: billB.id,
        }).then(() => {});

        return NextResponse.json({ billA, billB });
      }
    }
  }

  // If the entire pool was seen, try one more pool from a different offset
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

          return NextResponse.json({ billA, billB });
        }
      }
    }
  }

  return NextResponse.json(
    { error: 'All pairs seen', detail: 'You have seen all available matchups. Check back later for new bills!' },
    { status: 404 }
  );
}
