import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

/**
 * GET /api/bills/pair
 * Returns a random pair of bills from the same level, excluding pairs
 * this session has already seen.
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

  // Get IDs of bills this session has already seen in pairs
  const { data: seenRows } = await supabase
    .from('seen_pairs')
    .select('bill_a_id, bill_b_id')
    .eq('session_id', sessionId);

  const seenPairSet = new Set(
    (seenRows || []).map(r => `${r.bill_a_id}|${r.bill_b_id}`)
  );

  // Fetch eligible bills (not fluff, has summary)
  let query = supabase
    .from('bills')
    .select('id, external_id, title, summary, sponsor_name, sponsor_state, level, state, status, introduced_date')
    .eq('is_fluff', false)
    .eq('is_summarized', true)
    .eq('level', scope);

  if (scope === 'state' && state) {
    query = query.eq('state', state);
  }

  const { data: bills, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!bills || bills.length < 2) {
    return NextResponse.json(
      { error: 'Not enough bills', detail: `Only ${bills?.length || 0} eligible bills found for ${scope}${state ? ` / ${state}` : ''}` },
      { status: 404 }
    );
  }

  // Try up to 50 times to find an unseen pair
  for (let attempt = 0; attempt < 50; attempt++) {
    const i = Math.floor(Math.random() * bills.length);
    let j = Math.floor(Math.random() * (bills.length - 1));
    if (j >= i) j++;

    const a = bills[i];
    const b = bills[j];

    // Enforce consistent ordering: bill_a < bill_b by UUID
    const [billA, billB] = a.id < b.id ? [a, b] : [b, a];
    const pairKey = `${billA.id}|${billB.id}`;

    if (!seenPairSet.has(pairKey)) {
      // Record this pair as seen
      await supabase.from('seen_pairs').insert({
        session_id: sessionId,
        bill_a_id: billA.id,
        bill_b_id: billB.id,
      });

      return NextResponse.json({ billA, billB });
    }
  }

  // All pairs exhausted for this session
  return NextResponse.json(
    { error: 'All pairs seen', detail: 'You have seen all available matchups. Check back later for new bills!' },
    { status: 404 }
  );
}
