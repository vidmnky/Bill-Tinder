import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { summarizeBill } from '../../../../lib/groq';

const BATCH_SIZE = 50;
const DELAY_MS = 2500; // 2.5s between calls = 24/min (under 30/min free tier)

/**
 * GET /api/cron/summarize-bills
 * Protected by CRON_SECRET. Picks unsummarized bills and generates
 * plain-English summaries via Groq Llama 3 8B.
 */
export async function GET(request) {
  // Auth check
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fetch unsummarized, non-fluff bills
  const { data: bills, error } = await supabaseAdmin
    .from('bills')
    .select('id, title, raw_text')
    .eq('is_summarized', false)
    .eq('is_fluff', false)
    .limit(BATCH_SIZE);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!bills || bills.length === 0) {
    return NextResponse.json({ message: 'No bills to summarize', summarized: 0 });
  }

  let summarized = 0;
  let failed = 0;

  for (const bill of bills) {
    try {
      const summary = await summarizeBill(bill.title, bill.raw_text);

      if (summary) {
        const { error: updateErr } = await supabaseAdmin
          .from('bills')
          .update({ summary, is_summarized: true })
          .eq('id', bill.id);

        if (updateErr) {
          console.error(`[Summarize] Update error for ${bill.id}:`, updateErr.message);
          failed++;
        } else {
          summarized++;
        }
      } else {
        failed++;
      }
    } catch (err) {
      console.error(`[Summarize] Groq error for ${bill.id}:`, err.message);
      failed++;
    }

    // Rate limit: 2.5s between calls
    if (bills.indexOf(bill) < bills.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  return NextResponse.json({
    total: bills.length,
    summarized,
    failed,
  });
}
