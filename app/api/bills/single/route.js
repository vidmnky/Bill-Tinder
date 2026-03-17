import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

/**
 * GET /api/bills/single
 * Returns a single unseen bill for Rate mode.
 * Same pool logic as /api/bills/pair but returns one bill.
 *
 * Query params: session_id, scope (federal|state), state
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const state = searchParams.get('state');
  const scope = searchParams.get('scope') || 'federal';
  const sessionId = searchParams.get('session_id');

  if (!sessionId) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  }

  // Count eligible bills
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

  // Get seen bills for this session (limit to last 1000)
  const { data: seenRows } = await supabase
    .from('seen_bills')
    .select('bill_id')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1000);

  const seenSet = new Set((seenRows || []).map(r => r.bill_id));

  const selectFields = 'id, external_id, title, summary, summary_liberal, summary_conservative, impact_line, sponsor_name, sponsor_party, sponsor_state, level, state, status, introduced_date';

  // Fetch a pool of bills
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

  // Shuffle the pool
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  // Find first unseen bill
  for (const bill of pool) {
    if (!seenSet.has(bill.id)) {
      // Record as seen (non-blocking)
      supabase.from('seen_bills').insert({
        session_id: sessionId,
        bill_id: bill.id,
      }).then(() => {});

      return NextResponse.json({ bill });
    }
  }

  // Try a second pool from a different offset
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

        return NextResponse.json({ bill });
      }
    }
  }

  return NextResponse.json(
    { error: 'All bills seen', detail: 'You have rated all available bills. Check back later for new ones!' },
    { status: 404 }
  );
}
