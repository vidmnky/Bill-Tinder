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
 * Fetch recent federal bills from Congress.gov and upsert into DB.
 * Uses batch insert — imports list metadata only (no per-bill detail/text calls).
 * The summarizer can work from titles; detail enrichment can run separately later.
 */
async function fetchCongressBills() {
  const bills = await fetchRecentBills(250);
  let inserted = 0;
  let skipped = 0;

  // Build rows for batch upsert
  const rows = [];
  for (const bill of bills) {
    const externalId = `congress:${bill.type?.toLowerCase() || 'bill'}${bill.number}-${bill.congress}`;
    const { isFluff, reason } = detectFluff(bill.title || '');

    rows.push({
      external_id: externalId,
      title: bill.title || 'Untitled',
      sponsor_name: null,
      sponsor_state: null,
      level: 'federal',
      state: null,
      status: bill.latestAction?.text || null,
      introduced_date: bill.introducedDate || null,
      source: 'congress',
      is_fluff: isFluff,
      fluff_reason: reason,
      raw_text: null,
    });
  }

  // Batch upsert — skip duplicates via onConflict
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error, count } = await supabaseAdmin
      .from('bills')
      .upsert(chunk, { onConflict: 'external_id', ignoreDuplicates: true });

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

          // Upsert bill
          const { error } = await supabaseAdmin.from('bills').upsert({
            external_id: externalId,
            title,
            sponsor_name: bill.sponsors?.[0]?.name || null,
            sponsor_state: dsState || bill.state || null,
            level: 'state',
            state: dsState || bill.state || null,
            status: bill.status_desc || null,
            introduced_date: bill.status_date || null,
            source: 'legiscan',
            is_fluff: isFluff,
            fluff_reason: reason,
            raw_text: rawText.slice(0, 3000) || null,
          }, { onConflict: 'external_id' });

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
