import { NextResponse } from 'next/server';
import AdmZip from 'adm-zip';
import { supabaseAdmin } from '../../../../lib/supabase';
import { fetchDatasetList, fetchDataset, getMonthlyCallCount } from '../../../../lib/legiscan';
import { getChangedDatasets, preFlightCheck, ALL_STATES } from '../../../../lib/legiscan-budget';
import { fetchRecentBills, fetchBillDetail, fetchBillText } from '../../../../lib/congress';
import { detectFluff } from '../../../../lib/filter';

/**
 * GET /api/cron/fetch-bills
 * Protected by CRON_SECRET. Fetches bills from Congress.gov and LegiScan.
 *
 * Congress.gov: fetches recent federal bills individually (generous rate limit).
 * LegiScan: bulk datasets only (ZIP → extract → filter → upsert).
 */
export async function GET(request) {
  // Auth check
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const maxDatasets = parseInt(searchParams.get('max_datasets') || '5', 10);
  const skipCongress = searchParams.get('skip_congress') === 'true';

  const results = { congress: null, legiscan: null };

  // --- Congress.gov ---
  if (!skipCongress) {
    try {
      results.congress = await fetchCongressBills();
    } catch (err) {
      console.error('[Cron/Fetch] Congress.gov error:', err.message);
      results.congress = { error: err.message };
    }
  }

  // --- LegiScan ---
  try {
    results.legiscan = await fetchLegiScanBills(maxDatasets);
  } catch (err) {
    console.error('[Cron/Fetch] LegiScan error:', err.message);
    results.legiscan = { error: err.message };
  }

  return NextResponse.json(results);
}

/**
 * Fetch recent federal bills from Congress.gov and upsert into the bill pool.
 * Writes directly to core_mediaitem (the single bill table).
 * The `bills` VIEW exposes these to LegisSwipe automatically.
 */
async function fetchCongressBills() {
  const bills = await fetchRecentBills(500);
  let inserted = 0;
  let skipped = 0;

  // Build rows for batch upsert into core_mediaitem
  const rows = [];
  for (const bill of bills) {
    const externalId = `congress:${bill.type?.toLowerCase() || 'bill'}${bill.number}-${bill.congress}`;
    const { isFluff, reason } = detectFluff(bill.title || '');

    const sponsorName = bill.sponsors?.[0]?.fullName
      || bill.sponsors?.[0]?.name
      || null;
    const sponsorState = bill.sponsors?.[0]?.state || null;
    const sponsorParty = bill.sponsors?.[0]?.party || null;
    const sponsorBioguide = bill.sponsors?.[0]?.bioguideId || null;

    // Build bill number: e.g. "HR 7531", "S 236"
    const billType = (bill.type || 'bill').toUpperCase();
    const billNum = bill.number ? `${billType} ${bill.number}` : '';

    rows.push({
      media_type: 'bill',
      bill_id: externalId,
      bill_number: billNum,
      title: (bill.title || 'Untitled').slice(0, 1000),
      bill_sponsor_name: sponsorName || '',
      bill_sponsor_party: sponsorParty || '',
      bill_sponsor_state: sponsorState || '',
      bill_sponsor_bioguide_id: sponsorBioguide || '',
      bill_level: 'federal',
      bill_state_code: '',
      bill_stage: (bill.latestAction?.text || '').slice(0, 30),
      source_date: bill.introducedDate || null,
      bill_source: 'congress',
      source_name: 'congress',
      is_fluff: isFluff,
      fluff_reason: reason || '',
      content_text: '',
      legisswipe_uuid: crypto.randomUUID(),
      // Defaults for required fields
      description: '',
      summary: '',
      summary_liberal: '',
      summary_conservative: '',
      impact_line: '',
      impact_line_liberal: '',
      impact_line_conservative: '',
      review_notes: '',
      bill_committee: '',
      bill_chamber: '',
      bill_actions: '',
      external_url: '',
      source_url: '',
      verdict: 'unrated',
      status: 'pending',
      pin_order: 0,
      bill_active: true,
      is_summarized: false,
      is_hot: false,
      hot_score: 0,
    });
  }

  // Batch upsert — skip duplicates via bill_id (was external_id)
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error, count } = await supabaseAdmin
      .from('core_mediaitem')
      .upsert(chunk, { onConflict: 'bill_id', ignoreDuplicates: true });

    if (error) {
      console.error(`[Congress] Batch insert error:`, error.message);
    } else {
      inserted += chunk.length;
    }
  }

  skipped = bills.length - inserted;
  return { fetched: bills.length, inserted, skipped };
}

/**
 * Fetch state bills via LegiScan bulk datasets.
 * Downloads changed datasets as ZIPs, extracts bill JSONs, filters, upserts.
 */
// LegiScan state_id to abbreviation map
// state_id 1=AL, 2=AK, 3=AZ, ... 50=WY, 51=DC, 52=US (federal)
const STATE_ID_MAP = {};
ALL_STATES.forEach((code, i) => { STATE_ID_MAP[i + 1] = code; });
STATE_ID_MAP[52] = 'US';

async function fetchLegiScanBills(maxDatasets = 5) {
  // 1. Get current budget
  const monthlyCount = await getMonthlyCallCount(supabaseAdmin);

  // 2. Fetch dataset list (1 API call)
  const datasets = await fetchDatasetList(supabaseAdmin);

  // 3. Load stored hashes to compare (keyed by session_id, which is the dataset identifier)
  const { data: cachedRows } = await supabaseAdmin
    .from('dataset_cache')
    .select('session_id, dataset_hash');

  const storedHashes = new Map(
    (cachedRows || []).map(r => [r.session_id, r.dataset_hash])
  );

  // 4. Filter to current sessions only (year_start >= current year - 1)
  const currentYear = new Date().getFullYear();
  const currentDatasets = datasets.filter(ds => {
    const yr = ds.year_start || ds.year_end || 0;
    return yr >= currentYear - 1;
  });

  // 5. Find changed datasets
  const changed = getChangedDatasets(currentDatasets, storedHashes);

  // 5. Pre-flight budget check
  const preflight = preFlightCheck(monthlyCount + 1, changed.length); // +1 for getDatasetList already called
  if (!preflight.proceed) {
    return { message: preflight.message, changed: changed.length, downloaded: 0 };
  }

  // 6. Download changed datasets (up to budget limit AND maxDatasets param)
  const limit = Math.min(preflight.maxDatasets, maxDatasets);
  const toDownload = changed.slice(0, limit);
  let totalBills = 0;
  const cacheErrors = [];

  for (const ds of toDownload) {
    try {
      const dsState = STATE_ID_MAP[ds.state_id] || '';
      const dataset = await fetchDataset(ds.session_id, ds.access_key, supabaseAdmin);

      // Extract bills from ZIP
      const zip = new AdmZip(dataset.zipBuffer);
      const entries = zip.getEntries();
      let billsFromDataset = 0;

      for (const entry of entries) {
        // Bill JSON files are in the /bill/ directory
        if (!entry.entryName.includes('/bill/') || !entry.entryName.endsWith('.json')) {
          continue;
        }

        try {
          const billJson = JSON.parse(entry.getData().toString('utf8'));
          const bill = billJson.bill;
          if (!bill) continue;

          const externalId = `legiscan:${bill.bill_id}`;
          const title = bill.title || '';
          const rawText = bill.description || '';

          // Fluff filter — zero API cost
          const { isFluff, reason } = detectFluff(title, rawText);

          // Extract primary sponsor info (name + LegiScan people_id)
          const primarySponsor = bill.sponsors?.find(s => s.sponsor_type_id === 1) || bill.sponsors?.[0];

          // Upsert bill into core_mediaitem (the single bill pool)
          const { error } = await supabaseAdmin.from('core_mediaitem').upsert({
            media_type: 'bill',
            bill_id: externalId,
            bill_number: (bill.bill_number || '').slice(0, 30),
            title: title.slice(0, 1000) || 'Untitled',
            bill_sponsor_name: primarySponsor?.name || '',
            bill_sponsor_party: primarySponsor?.party || '',
            bill_sponsor_state: dsState || bill.state || '',
            bill_sponsor_legiscan_id: primarySponsor?.people_id || null,
            bill_level: 'state',
            bill_state_code: dsState || bill.state || '',
            bill_stage: (bill.status_desc || '').slice(0, 30),
            source_date: bill.status_date || null,
            bill_source: 'legiscan',
            source_name: 'legiscan',
            is_fluff: isFluff,
            fluff_reason: reason || '',
            content_text: rawText.slice(0, 3000) || '',
            legisswipe_uuid: crypto.randomUUID(),
            // Defaults for required fields
            description: '',
            summary: '',
            summary_liberal: '',
            summary_conservative: '',
            impact_line: '',
            impact_line_liberal: '',
            impact_line_conservative: '',
            review_notes: '',
            bill_committee: '',
            bill_chamber: '',
            bill_actions: '',
            external_url: '',
            source_url: '',
            verdict: 'unrated',
            status: 'pending',
            pin_order: 0,
            bill_active: true,
            is_summarized: false,
            is_hot: false,
            hot_score: 0,
          }, { onConflict: 'bill_id' });

          if (!error) billsFromDataset++;
        } catch {
          // Skip malformed entries
        }
      }

      // Update dataset cache — delete old entry then insert fresh
      await supabaseAdmin.from('dataset_cache').delete().eq('session_id', ds.session_id);
      const { error: cacheError } = await supabaseAdmin.from('dataset_cache').insert({
        dataset_id: ds.session_id,  // use session_id as the dataset_id (schema legacy)
        session_id: ds.session_id,
        state: dsState,
        session_name: ds.session_name || '',
        dataset_hash: ds.dataset_hash,
        access_key: ds.access_key,
        dataset_date: ds.dataset_date || null,
        bills_imported: billsFromDataset,
        last_downloaded: new Date().toISOString(),
      });

      if (cacheError) {
        cacheErrors.push(`${ds.dataset_id}: ${cacheError.message} (${cacheError.details || 'no details'})`);
      }

      totalBills += billsFromDataset;
    } catch (err) {
      console.error(`[LegiScan] Failed to process dataset ${ds.dataset_id}:`, err.message);
    }
  }

  return {
    datasetsAvailable: datasets.length,
    datasetsChanged: changed.length,
    datasetsDownloaded: toDownload.length,
    billsImported: totalBills,
    cacheErrors: cacheErrors.length > 0 ? cacheErrors : undefined,
  };
}
