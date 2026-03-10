import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

/**
 * GET /api/bills/pair
 * Returns a random pair of bills, excluding pairs this session has already seen.
 * Uses count + random offset to avoid loading all bills into memory.
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

  // Get count of eligible bills first (fast — just a count)
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

  // Get seen pairs for this session
  const { data: seenRows } = await supabase
    .from('seen_pairs')
    .select('bill_a_id, bill_b_id')
    .eq('session_id', sessionId);

  const seenPairSet = new Set(
    (seenRows || []).map(r => `${r.bill_a_id}|${r.bill_b_id}`)
  );

  const selectFields = 'id, external_id, title, summary, summary_liberal, summary_conservative, sponsor_name, sponsor_state, level, state, status, introduced_date';

  // Try up to 10 times to find an unseen pair using random offsets
  for (let attempt = 0; attempt < 10; attempt++) {
    const offsetA = Math.floor(Math.random() * count);
    let offsetB = Math.floor(Math.random() * (count - 1));
    if (offsetB >= offsetA) offsetB++;

    // Fetch just 2 individual bills by random offset
    let qA = supabase
      .from('bills')
      .select(selectFields)
      .eq('is_fluff', false)
      .eq('is_summarized', true)
      .eq('level', scope);

    let qB = supabase
      .from('bills')
      .select(selectFields)
      .eq('is_fluff', false)
      .eq('is_summarized', true)
      .eq('level', scope);

    if (scope === 'state' && state && state !== 'all') {
      qA = qA.eq('state', state);
      qB = qB.eq('state', state);
    }

    const [resA, resB] = await Promise.all([
      qA.range(offsetA, offsetA).single(),
      qB.range(offsetB, offsetB).single(),
    ]);

    if (resA.error || resB.error || !resA.data || !resB.data) continue;
    if (resA.data.id === resB.data.id) continue;

    const a = resA.data;
    const b = resB.data;

    // Enforce consistent ordering
    const [billA, billB] = a.id < b.id ? [a, b] : [b, a];
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

  // Fallback — extremely unlikely with 200k+ bills
  return NextResponse.json(
    { error: 'All pairs seen', detail: 'You have seen all available matchups. Check back later for new bills!' },
    { status: 404 }
  );
}
