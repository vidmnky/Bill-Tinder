import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

/**
 * POST /api/vote
 * Records a comparison vote.
 * Body: { bill_a_id, bill_b_id, winner_id, user_state, session_id }
 *
 * Enforces bill_a_id < bill_b_id ordering (the DB constraint requires it).
 */
export async function POST(request) {
  const body = await request.json();
  const { bill_a_id, bill_b_id, winner_id, user_state, session_id } = body;

  if (!bill_a_id || !bill_b_id || !winner_id || !session_id) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Enforce consistent ordering
  const [orderedA, orderedB] = bill_a_id < bill_b_id
    ? [bill_a_id, bill_b_id]
    : [bill_b_id, bill_a_id];

  const { error } = await supabase.from('comparisons').insert({
    bill_a_id: orderedA,
    bill_b_id: orderedB,
    winner_id,
    user_state,
    session_id,
  });

  if (error) {
    console.error('[Vote] Insert error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
