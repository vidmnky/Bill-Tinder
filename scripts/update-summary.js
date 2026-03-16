const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

// Read JSON from stdin
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', async () => {
  const updates = JSON.parse(input);
  let ok = 0, fail = 0;

  for (const u of updates) {
    const { error } = await supabase
      .from('bills')
      .update({
        summary: u.summary,
        summary_liberal: u.summary_liberal,
        summary_conservative: u.summary_conservative,
        is_summarized: true,
      })
      .eq('id', u.id);

    if (error) {
      console.error(`FAIL ${u.id}: ${error.message}`);
      fail++;
    } else {
      ok++;
    }
  }

  console.log(JSON.stringify({ updated: ok, failed: fail }));
});
