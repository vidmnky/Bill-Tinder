import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

/**
 * POST /api/vote/single
 * Records an approve/reject rating for a single bill.
 * Body: { bill_id, rating, session_id, user_state }
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
    console.error('[Vote/Single] Insert error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
