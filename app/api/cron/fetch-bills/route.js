import { NextResponse } from 'next/server';
import AdmZip from 'adm-zip';
import { supabaseAdmin } from '../../../../lib/supabase';
import { fetchDatasetList, fetchDataset, getMonthlyCallCount } from '../../../../lib/legiscan';
import { getChangedDatasets, preFlightCheck } from '../../../../lib/legiscan-budget';
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

  const results = { congress: null, legiscan: null };

  // --- Congress.gov ---
  try {
    results.congress = await fetchCongressBills();
  } catch (err) {
    console.error('[Cron/Fetch] Congress.gov error:', err.message);
    results.congress = { error: err.message };
  }

  // --- LegiScan ---
  try {
    results.legiscan = await fetchLegiScanBills();
  } catch (err) {
    console.error('[Cron/Fetch] LegiScan error:', err.message);
    results.legiscan = { error: err.message };
  }

  return NextResponse.json(results);
}

/**
 * Fetch recent federal bills from Congress.gov and upsert into DB.
 */
async function fetchCongressBills() {
  const bills = await fetchRecentBills(250);
  let inserted = 0;
  let skipped = 0;

  for (const bill of bills) {
    const externalId = `congress:${bill.type?.toLowerCase() || 'bill'}${bill.number}-${bill.congress}`;

    // Check if already exists
    const { data: existing } = await supabaseAdmin
      .from('bills')
      .select('id')
      .eq('external_id', externalId)
      .maybeSingle();

    if (existing) {
      skipped++;
      continue;
    }

    // Fluff check on title
    const { isFluff, reason } = detectFluff(bill.title || '');

    // Try to get bill text for summarization
    let rawText = null;
    try {
      rawText = await fetchBillText(
        String(bill.congress),
        bill.type?.toLowerCase() || 'hr',
        String(bill.number)
      );
      await new Promise(r => setTimeout(r, 200)); // rate limit
    } catch {
      // Text not available — that's fine
    }

    // Get sponsor info from detail
    let sponsorName = null;
    let sponsorState = null;
    try {
      const detail = await fetchBillDetail(
        String(bill.congress),
        bill.type?.toLowerCase() || 'hr',
        String(bill.number)
      );
      if (detail?.sponsors?.[0]) {
        const s = detail.sponsors[0];
        sponsorName = s.fullName || `${s.firstName} ${s.lastName}`;
        sponsorState = s.state;
      }
      await new Promise(r => setTimeout(r, 200));
    } catch {
      // Detail not available
    }

    const { error } = await supabaseAdmin.from('bills').insert({
      external_id: externalId,
      title: bill.title || 'Untitled',
      sponsor_name: sponsorName,
      sponsor_state: sponsorState,
      level: 'federal',
      state: null,
      status: bill.latestAction?.text || null,
      introduced_date: bill.introducedDate || null,
      source: 'congress',
      is_fluff: isFluff,
      fluff_reason: reason,
      raw_text: rawText,
    });

    if (error) {
      console.error(`[Congress] Insert error for ${externalId}:`, error.message);
    } else {
      inserted++;
    }
  }

  return { fetched: bills.length, inserted, skipped };
}

/**
 * Fetch state bills via LegiScan bulk datasets.
 * Downloads changed datasets as ZIPs, extracts bill JSONs, filters, upserts.
 */
async function fetchLegiScanBills() {
  // 1. Get current budget
  const monthlyCount = await getMonthlyCallCount(supabaseAdmin);

  // 2. Fetch dataset list (1 API call)
  const datasets = await fetchDatasetList(supabaseAdmin);

  // 3. Load stored hashes to compare
  const { data: cachedRows } = await supabaseAdmin
    .from('dataset_cache')
    .select('dataset_id, dataset_hash');

  const storedHashes = new Map(
    (cachedRows || []).map(r => [r.dataset_id, r.dataset_hash])
  );

  // 4. Find changed datasets
  const changed = getChangedDatasets(datasets, storedHashes);

  // 5. Pre-flight budget check
  const preflight = preFlightCheck(monthlyCount + 1, changed.length); // +1 for getDatasetList already called
  if (!preflight.proceed) {
    return { message: preflight.message, changed: changed.length, downloaded: 0 };
  }

  // 6. Download changed datasets (up to budget limit)
  const toDownload = changed.slice(0, preflight.maxDatasets);
  let totalBills = 0;

  for (const ds of toDownload) {
    try {
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
            sponsor_state: ds.state_abbr || bill.state || null,
            level: 'state',
            state: ds.state_abbr || bill.state || null,
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

      // Update dataset cache
      await supabaseAdmin.from('dataset_cache').upsert({
        dataset_id: ds.dataset_id,
        session_id: ds.session_id,
        state: ds.state_abbr || ds.state || '',
        session_name: ds.session_name || '',
        dataset_hash: ds.dataset_hash,
        access_key: ds.access_key,
        dataset_date: ds.dataset_date || null,
        bills_imported: billsFromDataset,
        last_downloaded: new Date().toISOString(),
      }, { onConflict: 'dataset_id' });

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
  };
}
