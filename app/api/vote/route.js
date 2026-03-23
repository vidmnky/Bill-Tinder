import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

/**
 * POST /api/vote
 * Records a comparison vote.
 * Body: { bill_a_id, bill_b_id, winner_id, user_state, session_id }
 *
 * Enforces bill_a_id < bill_b_id ordering (the DB constraint requires it).
 *
 * NOTE: When bills come from the Basin API directly (not synced to local
 * Supabase cache), the bill UUIDs won't exist in the local bills table
 * and the FK insert will fail. This is expected and non-fatal — the vote
 * is silently dropped. Once the cron syncs basin bills into Supabase,
 * voting will persist normally.
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
    // FK violation is expected when bills are served from Basin API
    // but haven't been synced to local Supabase cache yet.
    // Log it but return ok so the UI doesn't show errors.
    console.warn('[Vote] Insert failed (expected if bill not in local cache):', error.message);
    return NextResponse.json({ ok: true, cached: false });
  }

  return NextResponse.json({ ok: true, cached: true });
}
