/**
 * Backfill impact_line for summarized bills that don't have one.
 * Uses Groq Llama 3.1 8B (free tier).
 *
 * Usage: node scripts/backfill_impact.js [--limit 500]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const Groq = require('groq-sdk');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
  timeout: 15000
});

const IMPACT_PROMPT = `Write ONE sentence explaining what this bill means for a regular person. Make it personal and concrete — use "you" or "your." Examples of good impact lines:
- "Your grocery bill could go up if import tariffs rise."
- "You'd get 12 weeks of paid leave if you have a new baby."
- "Your kids' school would get less federal funding."

Rules:
- One sentence only. Under 25 words.
- Use "you" or "your" — make it feel personal.
- Be specific about the real-world effect, not the policy mechanism.
- No jargon, no bill numbers, no hedging. Just the impact.
- If the bill is too procedural or narrow to affect regular people, write "Affects government operations, not daily life."`;

const DELAY_MS = 350; // Stay well under Groq rate limits

async function generateImpact(title, rawText, summary) {
  const userContent = `Bill Title: ${title}\n\nSummary: ${summary || '(none)'}\n\nBill Text (excerpt):\n${rawText || '(No text available)'}`;
  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: IMPACT_PROMPT },
        { role: 'user', content: userContent },
      ],
      temperature: 0.3,
      max_tokens: 60,
    });
    return completion.choices[0]?.message?.content?.trim() || null;
  } catch (err) {
    if (err.status === 429) {
      console.log('  Rate limited, waiting 30s...');
      await new Promise(r => setTimeout(r, 30000));
      try {
        const completion = await groq.chat.completions.create({
          model: 'llama-3.1-8b-instant',
          messages: [
            { role: 'system', content: IMPACT_PROMPT },
            { role: 'user', content: userContent },
          ],
          temperature: 0.3,
          max_tokens: 60,
        });
        return completion.choices[0]?.message?.content?.trim() || null;
      } catch { return null; }
    }
    console.log(`  Groq error: ${err.message}`);
    return null;
  }
}

async function getAllBills(limit) {
  const all = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await sb.from('bills')
      .select('id, title, raw_text, summary')
      .eq('is_summarized', true)
      .eq('is_fluff', false)
      .is('impact_line', null)
      .range(offset, offset + pageSize - 1);
    if (error) { console.log('Query error:', error.message); break; }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (limit && all.length >= limit) { all.length = limit; break; }
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

(async () => {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : null;

  console.log(`Fetching bills missing impact_line${limit ? ` (limit ${limit})` : ''}...`);
  const bills = await getAllBills(limit);
  console.log(`${bills.length} bills to process\n`);

  let done = 0, failed = 0;

  for (let i = 0; i < bills.length; i++) {
    const bill = bills[i];
    const impact = await generateImpact(bill.title, bill.raw_text, bill.summary);

    if (impact) {
      const { error } = await sb.from('bills')
        .update({ impact_line: impact })
        .eq('id', bill.id);
      if (!error) done++;
      else failed++;
    } else {
      failed++;
    }

    if ((i + 1) % 100 === 0 || i === bills.length - 1) {
      console.log(`${i + 1}/${bills.length}  done:${done} failed:${failed}`);
    }

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log(`\nDone. Generated: ${done}  Failed: ${failed}`);
  process.exit(0);
})();
