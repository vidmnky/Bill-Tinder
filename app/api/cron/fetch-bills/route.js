import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { fetchBasinBills } from '../../../../lib/basin';

/**
 * GET /api/cron/fetch-bills
 * Protected by CRON_SECRET.
 *
 * PRIMARY SOURCE: Civic Mirror Basin API.
 * Fetches summarized bills from CM and upserts into local Supabase cache.
 * This replaces direct Congress.gov and LegiScan fetching — CM handles that.
 *
 * LEGACY SOURCE: Congress.gov + LegiScan (preserved as fallback, disabled by default).
 * Set ?source=legacy to use the old Congress.gov + LegiScan pipeline.
 *
 * Query params:
 *   source=basin (default) | legacy
 *   limit=500 (max bills to fetch from basin)
 *   state=XX (optional state filter)
 *   level=federal|state (optional level filter)
 */
export async function GET(request) {
  // Auth check
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const source = searchParams.get('source') || 'basin';

  if (source === 'legacy') {
    return handleLegacyFetch(request);
  }

  // --- Basin API fetch (default) ---
  const limit = parseInt(searchParams.get('limit') || '500', 10);
  const state = searchParams.get('state') || undefined;
  const level = searchParams.get('level') || undefined;

  try {
    const results = await fetchFromBasin({ limit, state, level });
    return NextResponse.json(results);
  } catch (err) {
    console.error('[Cron/Fetch] Basin API error:', err.message);
    return NextResponse.json({ error: err.message, source: 'basin' }, { status: 500 });
  }
}

/**
 * Fetch bills from the CM Basin API and upsert into local Supabase cache.
 * Only syncs summarized bills — unsummarized ones have no value for the swipe UI.
 */
async function fetchFromBasin({ limit = 500, state, level }) {
  // Fetch summarized bills from basin (these are ready for display)
  const bills = await fetchBasinBills({
    limit,
    state,
    level,
    summarized: true,
  });

  if (!bills || bills.length === 0) {
    return { source: 'basin', fetched: 0, upserted: 0, skipped: 0 };
  }

  let upserted = 0;
  let skipped = 0;
  const errors = [];

  // Batch upsert into local Supabase bills table
  const BATCH = 50;
  for (let i = 0; i < bills.length; i += BATCH) {
    const chunk = bills.slice(i, i + BATCH);

    const rows = chunk.map(bill => ({
      // Use cm_pk as external_id prefix for dedup
      external_id: bill.external_id || `cm:${bill.cm_pk}`,
      title: (bill.title || 'Untitled').slice(0, 1000),
      summary: bill.summary || null,
      summary_liberal: bill.summary_liberal || null,
      summary_conservative: bill.summary_conservative || null,
      impact_line: bill.impact_line || null,
      impact_line_liberal: bill.impact_line_liberal || null,
      impact_line_conservative: bill.impact_line_conservative || null,
      sponsor_name: bill.sponsor_name || null,
      sponsor_party: bill.sponsor_party || null,
      sponsor_state: bill.sponsor_state || null,
      level: bill.level || 'federal',
      state: bill.state || null,
      status: bill.status || null,
      source: bill.source || 'congress',
      introduced_date: bill.introduced_date || null,
      is_fluff: false,
      is_summarized: true, // Basin only returns summarized bills
      raw_text: null,
      last_updated: new Date().toISOString(),
    }));

    const { error } = await supabaseAdmin
      .from('bills')
      .upsert(rows, { onConflict: 'external_id', ignoreDuplicates: false });

    if (error) {
      errors.push(error.message);
      console.error(`[Basin] Batch upsert error:`, error.message);
      skipped += chunk.length;
    } else {
      upserted += chunk.length;
    }
  }

  return {
    source: 'basin',
    fetched: bills.length,
    upserted,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * LEGACY: Original Congress.gov + LegiScan fetch pipeline.
 * Kept for backwards compatibility — use ?source=legacy to invoke.
 * This is the old code, preserved unchanged.
 */
async function handleLegacyFetch(request) {
  // Dynamic imports to avoid loading these modules by default
  const { fetchRecentBills, fetchBillDetail, fetchBillText } = await import('../../../../lib/congress');
  const { fetchDatasetList, fetchDataset, getMonthlyCallCount } = await import('../../../../lib/legiscan');
  const { getChangedDatasets, preFlightCheck, ALL_STATES } = await import('../../../../lib/legiscan-budget');
  const { detectFluff } = await import('../../../../lib/filter');
  const AdmZip = (await import('adm-zip')).default;

  const { searchParams } = new URL(request.url);
  const maxDatasets = parseInt(searchParams.get('max_datasets') || '5', 10);
  const skipCongress = searchParams.get('skip_congress') === 'true';

  const results = { source: 'legacy', congress: null, legiscan: null };

  // --- Congress.gov ---
  if (!skipCongress) {
    try {
      results.congress = await fetchCongressBillsLegacy(fetchRecentBills, detectFluff);
    } catch (err) {
      console.error('[Cron/Fetch] Congress.gov error:', err.message);
      results.congress = { error: err.message };
    }
  }

  // --- LegiScan ---
  try {
    results.legiscan = await fetchLegiScanBillsLegacy(
      maxDatasets, fetchDatasetList, fetchDataset, getMonthlyCallCount,
      getChangedDatasets, preFlightCheck, ALL_STATES, detectFluff, AdmZip
    );
  } catch (err) {
    console.error('[Cron/Fetch] LegiScan error:', err.message);
    results.legiscan = { error: err.message };
  }

  return NextResponse.json(results);
}

/**
 * LEGACY: Fetch from Congress.gov directly.
 */
async function fetchCongressBillsLegacy(fetchRecentBills, detectFluff) {
  const bills = await fetchRecentBills(500);
  let inserted = 0;

  const rows = [];
  for (const bill of bills) {
    const externalId = `congress:${bill.type?.toLowerCase() || 'bill'}${bill.number}-${bill.congress}`;
    const { isFluff, reason } = detectFluff(bill.title || '');

    const sponsorName = bill.sponsors?.[0]?.fullName || bill.sponsors?.[0]?.name || null;
    const sponsorState = bill.sponsors?.[0]?.state || null;
    const sponsorParty = bill.sponsors?.[0]?.party || null;
    const sponsorBioguide = bill.sponsors?.[0]?.bioguideId || null;

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

  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await supabaseAdmin
      .from('core_mediaitem')
      .upsert(chunk, { onConflict: 'bill_id', ignoreDuplicates: true });

    if (error) {
      console.error(`[Congress/Legacy] Batch insert error:`, error.message);
    } else {
      inserted += chunk.length;
    }
  }

  return { fetched: bills.length, inserted, skipped: bills.length - inserted };
}

/**
 * LEGACY: Fetch from LegiScan bulk datasets.
 */
async function fetchLegiScanBillsLegacy(
  maxDatasets, fetchDatasetList, fetchDataset, getMonthlyCallCount,
  getChangedDatasets, preFlightCheck, ALL_STATES, detectFluff, AdmZip
) {
  const STATE_ID_MAP = {};
  ALL_STATES.forEach((code, i) => { STATE_ID_MAP[i + 1] = code; });
  STATE_ID_MAP[52] = 'US';

  const monthlyCount = await getMonthlyCallCount(supabaseAdmin);
  const datasets = await fetchDatasetList(supabaseAdmin);

  const { data: cachedRows } = await supabaseAdmin
    .from('dataset_cache')
    .select('session_id, dataset_hash');

  const storedHashes = new Map(
    (cachedRows || []).map(r => [r.session_id, r.dataset_hash])
  );

  const currentYear = new Date().getFullYear();
  const currentDatasets = datasets.filter(ds => {
    const yr = ds.year_start || ds.year_end || 0;
    return yr >= currentYear - 1;
  });

  const changed = getChangedDatasets(currentDatasets, storedHashes);
  const preflight = preFlightCheck(monthlyCount + 1, changed.length);
  if (!preflight.proceed) {
    return { message: preflight.message, changed: changed.length, downloaded: 0 };
  }

  const limit = Math.min(preflight.maxDatasets, maxDatasets);
  const toDownload = changed.slice(0, limit);
  let totalBills = 0;

  for (const ds of toDownload) {
    try {
      const dsState = STATE_ID_MAP[ds.state_id] || '';
      const dataset = await fetchDataset(ds.session_id, ds.access_key, supabaseAdmin);
      const zip = new AdmZip(dataset.zipBuffer);
      const entries = zip.getEntries();
      let billsFromDataset = 0;

      for (const entry of entries) {
        if (!entry.entryName.includes('/bill/') || !entry.entryName.endsWith('.json')) continue;

        try {
          const billJson = JSON.parse(entry.getData().toString('utf8'));
          const bill = billJson.bill;
          if (!bill) continue;

          const externalId = `legiscan:${bill.bill_id}`;
          const title = bill.title || '';
          const rawText = bill.description || '';
          const { isFluff, reason } = detectFluff(title, rawText);
          const primarySponsor = bill.sponsors?.find(s => s.sponsor_type_id === 1) || bill.sponsors?.[0];

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

      await supabaseAdmin.from('dataset_cache').delete().eq('session_id', ds.session_id);
      await supabaseAdmin.from('dataset_cache').insert({
        dataset_id: ds.session_id,
        session_id: ds.session_id,
        state: dsState,
        session_name: ds.session_name || '',
        dataset_hash: ds.dataset_hash,
        access_key: ds.access_key,
        dataset_date: ds.dataset_date || null,
        bills_imported: billsFromDataset,
        last_downloaded: new Date().toISOString(),
      });

      totalBills += billsFromDataset;
    } catch (err) {
      console.error(`[LegiScan/Legacy] Failed to process dataset ${ds.dataset_id}:`, err.message);
    }
  }

  return {
    datasetsAvailable: datasets.length,
    datasetsChanged: changed.length,
    datasetsDownloaded: toDownload.length,
    billsImported: totalBills,
  };
}
