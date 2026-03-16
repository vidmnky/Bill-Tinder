import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { summarizeBill } from '../../../../lib/groq';

const BATCH_SIZE = 50; // 3 calls per bill × 50 = 150 calls
const DELAY_MS = 500;  // Groq handles high throughput

/**
 * GET /api/cron/summarize-bills
 * Protected by CRON_SECRET. Generates all 3 summary modes per bill.
 */
export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || String(BATCH_SIZE), 10), 200);

  const { data: bills, error } = await supabaseAdmin
    .from('bills')
    .select('id, title, raw_text')
    .eq('is_summarized', false)
    .eq('is_fluff', false)
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!bills || bills.length === 0) {
    return NextResponse.json({ message: 'No bills to summarize', summarized: 0 });
  }

  let summarized = 0;
  let failed = 0;
  const errors = [];

  for (const bill of bills) {
    try {
      const balanced = await summarizeBill(bill.title, bill.raw_text, 'balanced');
      await new Promise(r => setTimeout(r, DELAY_MS));

      const liberal = await summarizeBill(bill.title, bill.raw_text, 'liberal');
      await new Promise(r => setTimeout(r, DELAY_MS));

      const conservative = await summarizeBill(bill.title, bill.raw_text, 'conservative');
      await new Promise(r => setTimeout(r, DELAY_MS));

      if (balanced) {
        const { error: updateErr } = await supabaseAdmin
          .from('bills')
          .update({
            summary: balanced,
            summary_liberal: liberal || null,
            summary_conservative: conservative || null,
            is_summarized: true,
          })
          .eq('id', bill.id);

        if (updateErr) {
          errors.push(`${bill.id}: update failed: ${updateErr.message}`);
          failed++;
        } else {
          summarized++;
        }
      } else {
        errors.push(`${bill.id}: empty balanced summary`);
        failed++;
      }
    } catch (err) {
      errors.push(`${bill.id}: ${err.message}`);
      failed++;
    }
  }

  return NextResponse.json({
    total: bills.length,
    summarized,
    failed,
    errors: errors.length > 0 ? errors : undefined,
  });
}
