import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

/**
 * GET /api/leaderboard?state=IN  or  ?state=all
 * Returns top bills by pick count and top sponsors by aggregate picks.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const stateFilter = searchParams.get('state') || 'all';

  // Build bill picks query — count how many times each bill was picked as winner
  let billQuery = supabase
    .from('comparisons')
    .select('winner_id');

  // We need raw SQL for aggregation — use RPC or inline.
  // Supabase JS client doesn't support GROUP BY, so we query comparisons
  // and aggregate client-side, or use the bill_win_rates view.
  // For efficiency, let's query comparisons + bills and aggregate.

  // Fetch all comparisons (winner_id only) — filtered by state if needed
  let comparisonsQuery = supabase
    .from('comparisons')
    .select('winner_id');

  // If filtering by state, we need to join through bills.
  // Since supabase-js can't do complex joins with GROUP BY,
  // fetch winner counts then enrich with bill data.

  const { data: comparisons, error: compError } = await comparisonsQuery;

  if (compError) {
    console.error('[Leaderboard] Comparisons query error:', compError.message);
    return NextResponse.json({ error: compError.message }, { status: 500 });
  }

  // Count picks per bill
  const pickCounts = {};
  for (const row of comparisons || []) {
    pickCounts[row.winner_id] = (pickCounts[row.winner_id] || 0) + 1;
  }

  const billIds = Object.keys(pickCounts);
  if (billIds.length === 0) {
    return NextResponse.json({ bills: [], sponsors: [], states: [] });
  }

  // Fetch bill details for all bills that have picks
  let billsQuery = supabase
    .from('bills')
    .select('id, title, sponsor_name, sponsor_state, state, level')
    .in('id', billIds);

  const { data: bills, error: billsError } = await billsQuery;

  if (billsError) {
    console.error('[Leaderboard] Bills query error:', billsError.message);
    return NextResponse.json({ error: billsError.message }, { status: 500 });
  }

  // Collect all states that have data (for the filter dropdown)
  const statesWithData = new Set();
  for (const b of bills || []) {
    if (b.state) statesWithData.add(b.state);
    if (b.sponsor_state) statesWithData.add(b.sponsor_state);
    if (b.level === 'federal') statesWithData.add('federal');
  }

  // Merge pick counts with bill data, apply state filter
  const billsRanked = [];
  const sponsorAgg = {}; // sponsor_name -> { total_picks, bill_count, state }

  for (const b of bills || []) {
    const picks = pickCounts[b.id] || 0;

    // State filter
    if (stateFilter !== 'all') {
      const billState = b.state || (b.level === 'federal' ? 'federal' : null);
      if (billState !== stateFilter && b.sponsor_state !== stateFilter) continue;
    }

    billsRanked.push({
      title: b.title,
      sponsor_name: b.sponsor_name,
      state: b.state || 'federal',
      picks,
    });

    // Aggregate sponsors
    const sponsorKey = b.sponsor_name || 'Unknown';
    if (!sponsorAgg[sponsorKey]) {
      sponsorAgg[sponsorKey] = {
        sponsor_name: sponsorKey,
        state: b.sponsor_state || b.state || 'federal',
        total_picks: 0,
        bill_count: 0,
      };
    }
    sponsorAgg[sponsorKey].total_picks += picks;
    sponsorAgg[sponsorKey].bill_count += 1;
  }

  // Sort bills by picks descending, top 50
  billsRanked.sort((a, b) => b.picks - a.picks);
  const topBills = billsRanked.slice(0, 50);

  // Sort sponsors by total_picks descending, top 25
  const sponsorsRanked = Object.values(sponsorAgg)
    .sort((a, b) => b.total_picks - a.total_picks)
    .slice(0, 25);

  return NextResponse.json({
    bills: topBills,
    sponsors: sponsorsRanked,
    states: [...statesWithData].sort(),
  });
}
