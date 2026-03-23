import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

/**
 * POST /api/vote/single
 * Records an approve/reject rating for a single bill.
 * Body: { bill_id, rating, session_id, user_state }
 *
 * NOTE: When bills come from the Basin API directly (not synced to local
 * Supabase cache), the bill UUID won't exist in the local bills table
 * and the FK insert will fail. This is expected and non-fatal.
 */
export async function POST(request) {
  const body = await request.json();
  const { bill_id, rating, session_id, user_state } = body;

  if (!bill_id || !rating || !session_id) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  if (rating !== 'approve' && rating !== 'reject') {
    return NextResponse.json({ error: 'rating must be "approve" or "reject"' }, { status: 400 });
  }

  const { error } = await supabase.from('ratings').insert({
    bill_id,
    rating,
    session_id,
    user_state,
  });

  if (error) {
    // FK violation is expected when bills are served from Basin API
    // but haven't been synced to local Supabase cache yet.
    console.warn('[Vote/Single] Insert failed (expected if bill not in local cache):', error.message);
    return NextResponse.json({ ok: true, cached: false });
  }

  return NextResponse.json({ ok: true, cached: true });
}
