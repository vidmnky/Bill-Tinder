require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { createClient } = require('@supabase/supabase-js');
const https = require('https');
const fs = require('fs');
const path = require('path');

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
const KEY = process.env.LEGISCAN_API_KEY;
const CACHE_FILE = path.join(__dirname, 'data', 'party_cache.json');

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function getAllRows() {
  const all = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await sb.from('bills')
      .select('id, sponsor_name, sponsor_state, external_id')
      .eq('is_summarized', true).eq('is_fluff', false)
      .eq('source', 'legiscan')
      .is('sponsor_party', null)
      .not('sponsor_name', 'is', null)
      .range(offset, offset + pageSize - 1);
    if (error) { console.log('Query error:', error.message); break; }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

function looksLikeCommittee(name) {
  const lower = name.toLowerCase();
  const keywords = ['committee', 'education', 'judiciary', 'transportation',
    'commerce', 'health', 'government', 'workforce', 'agriculture', 'finance',
    'appropriations', 'revenue', 'ethics', 'environment', 'energy', 'ways and means',
    'rules', 'budget', 'veterans', 'corrections', 'insurance', 'banking',
    'elections', 'housing', 'natural resources', 'public safety', 'human services',
    'transparency', 'taxation', 'labor', 'military', 'defense', 'regulatory'];
  return keywords.some(k => lower.includes(k));
}

(async () => {
  // Load cache
  let partyCache = {};
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  try {
    if (fs.existsSync(CACHE_FILE)) {
      partyCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      console.log(`Loaded ${Object.keys(partyCache).length} cached parties`);
    }
  } catch {}

  console.log('Fetching bills...');
  const data = await getAllRows();
  console.log(`Got ${data.length} bills`);

  // Dedupe sponsors, skip committees and cached
  const sponsorMap = {};
  for (const row of data) {
    const key = row.sponsor_name + '|' + (row.sponsor_state || '');
    if (!sponsorMap[key] && !looksLikeCommittee(row.sponsor_name) && !partyCache[key]) {
      sponsorMap[key] = row.external_id.replace('legiscan:', '');
    }
  }

  const toLookUp = Object.entries(sponsorMap);
  console.log(`${toLookUp.length} sponsors to look up\n`);

  // ── Phase 1: LegiScan lookups ──
  let apiCalls = 0;
  for (let i = 0; i < toLookUp.length; i++) {
    const [key, billId] = toLookUp[i];
    try {
      const json = await httpGet(
        `https://api.legiscan.com/?key=${KEY}&op=getBill&id=${billId}`
      );
      apiCalls++;

      if (json && json.status === 'OK' && json.bill?.sponsors?.length > 0) {
        const sponsor = json.bill.sponsors.find(s => s.sponsor_type_id === 1)
          || json.bill.sponsors[0];
        const party = sponsor.party || '';
        if (party.length > 0) {
          partyCache[key] = party;
        }
      }
    } catch (e) {
      // timeout or network error — skip
    }

    if (i % 100 === 0 || i === toLookUp.length - 1) {
      console.log(`API: ${i + 1}/${toLookUp.length}  cached: ${Object.keys(partyCache).length}`);
      fs.writeFileSync(CACHE_FILE, JSON.stringify(partyCache, null, 2));
    }

    await new Promise(r => setTimeout(r, 350));
  }

  console.log(`\nPhase 1 done. ${apiCalls} calls, ${Object.keys(partyCache).length} parties.`);
  fs.writeFileSync(CACHE_FILE, JSON.stringify(partyCache, null, 2));

  // ── Phase 2: Update bills by ID ──
  console.log('\nPhase 2: Updating bills...');
  let updated = 0, skipped = 0;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const key = row.sponsor_name + '|' + (row.sponsor_state || '');
    const party = partyCache[key];
    if (!party) { skipped++; continue; }

    const { error } = await sb.from('bills')
      .update({ sponsor_party: party })
      .eq('id', row.id);

    if (!error) updated++;

    if (updated % 500 === 0 && updated > 0) {
      console.log(`  Updated ${updated}/${data.length} bills...`);
    }
  }

  console.log(`\nDone. Updated: ${updated}  Skipped: ${skipped}`);
  process.exit(0);
})();
