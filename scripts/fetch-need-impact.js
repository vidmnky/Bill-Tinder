const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const limit = parseInt(process.argv[2] || '50', 10);

async function main() {
  const { data, error } = await supabase
    .from('bills')
    .select('id, title, summary, state')
    .eq('is_summarized', true)
    .eq('is_fluff', false)
    .is('impact_line', null)
    .limit(limit);

  if (error) {
    console.error(JSON.stringify(error));
    process.exit(1);
  }

  console.log(JSON.stringify(data));
}

main();
