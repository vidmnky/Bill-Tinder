const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const limit = parseInt(process.argv[2] || '20', 10);
const perState = parseInt(process.argv[3] || '0', 10); // 0 = old behavior, >0 = round-robin

const ALL_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
  'US'
];

async function main() {
  if (perState > 0) {
    // Round-robin: fetch perState bills from each state, prioritizing states with fewest summaries
    const counts = [];
    for (const st of ALL_STATES) {
      const { count } = await supabase.from('bills').select('id', { count: 'exact', head: true })
        .eq('state', st).eq('is_summarized', true).eq('is_fluff', false);
      counts.push({ state: st, summarized: count || 0 });
    }
    // Also check orphan bills with state IS NULL (legacy federal imports)
    const { count: nullCount } = await supabase.from('bills').select('id', { count: 'exact', head: true })
      .is('state', null).eq('is_summarized', true).eq('is_fluff', false);
    if (nullCount > 0) {
      counts.push({ state: null, summarized: nullCount || 0, label: 'null-state' });
    }

    // Sort by fewest summarized first
    counts.sort((a, b) => a.summarized - b.summarized);

    const allBills = [];
    let remaining = limit;

    for (const entry of counts) {
      if (remaining <= 0) break;
      const take = Math.min(perState, remaining);

      let query = supabase.from('bills')
        .select('id, title, raw_text, state')
        .eq('is_summarized', false)
        .eq('is_fluff', false)
        .limit(take);

      if (entry.state === null) {
        query = query.is('state', null);
      } else {
        query = query.eq('state', entry.state);
      }

      const { data, error } = await query;
      if (error) { console.error(JSON.stringify(error)); continue; }
      if (data && data.length > 0) {
        allBills.push(...data);
        remaining -= data.length;
      }
    }

    console.log(JSON.stringify(allBills));
  } else {
    // Original behavior
    const { data, error } = await supabase
      .from('bills')
      .select('id, title, raw_text')
      .eq('is_summarized', false)
      .eq('is_fluff', false)
      .limit(limit);

    if (error) {
      console.error(JSON.stringify(error));
      process.exit(1);
    }

    console.log(JSON.stringify(data));
  }
}

main();
