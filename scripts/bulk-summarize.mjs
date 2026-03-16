import { createClient } from '@supabase/supabase-js';
import Groq from 'groq-sdk';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const PROMPTS = {
  balanced: `Summarize this bill in 2-3 factual sentences for a regular voter. State what the bill does, then state BOTH the intended benefit AND the cost or tradeoff. Be dry and balanced — do not make the bill sound good or bad.
Format: "[What it does]. [Who benefits and how]. [Who pays, what it costs, or what the tradeoff is]."
Rules:
- Plain English, no jargon, no bill numbers, no legalese.
- Never start with "This bill would" or "If this passes." Just state facts.
- Include dollar amounts, deadlines, or thresholds when available.
- Always mention a cost, tradeoff, or criticism if one exists. If the cost is unclear, say "Cost/funding source not specified."
- No opinions, no spin, no enthusiasm. Boring is good.
- No newlines. One continuous paragraph. Under 60 words.`,

  liberal: `Summarize this bill in 2-3 plain sentences the way a liberal voter would naturally talk about it. State what the bill does, then describe it in terms of the things liberals tend to care about — access to services, fairness, protecting people who have less, public health, the environment, accountability for corporations.
Rules:
- Be matter-of-fact, not dramatic. No rallying cries, no hyperbole, no "threatens" or "attacks."
- Just say what happens and who it affects, through the lens of what a liberal would pay attention to.
- Plain English, no jargon, no bill numbers. Never start with "This bill would."
- No newlines. One continuous paragraph. Under 60 words.`,

  conservative: `Summarize this bill in 2-3 plain sentences the way a conservative voter would naturally talk about it. State what the bill does, then describe it in terms of the things conservatives tend to care about — cost to taxpayers, personal responsibility, keeping government small, protecting businesses, strong defense, family, property rights.
Rules:
- Be matter-of-fact, not dramatic. No rallying cries, no hyperbole, no "threatens" or "attacks."
- Just say what happens and who it affects, through the lens of what a conservative would pay attention to.
- Plain English, no jargon, no bill numbers. Never start with "This bill would."
- No newlines. One continuous paragraph. Under 60 words.`,
};

async function summarize(title, rawText, mode) {
  const text = rawText?.slice(0, 3000) || title;
  const res = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      { role: 'system', content: PROMPTS[mode] },
      { role: 'user', content: `Bill title: ${title}\n\nBill text:\n${text}` },
    ],
    temperature: 0.3,
    max_tokens: 200,
  });
  return res.choices?.[0]?.message?.content?.trim() || null;
}

const BATCH = 50;
const DELAY = 2500; // ms between Groq calls

let totalDone = 0;
let totalFailed = 0;

while (true) {
  const { data: bills, error } = await admin
    .from('bills')
    .select('id, title, raw_text')
    .eq('is_summarized', false)
    .eq('is_fluff', false)
    .limit(BATCH);

  if (error) { console.error('DB error:', error.message); break; }
  if (!bills || bills.length === 0) { console.log('All bills summarized!'); break; }

  console.log(`\nBatch: ${bills.length} bills (${totalDone} done so far)`);

  for (const bill of bills) {
    try {
      const balanced = await summarize(bill.title, bill.raw_text, 'balanced');
      await new Promise(r => setTimeout(r, DELAY));
      const liberal = await summarize(bill.title, bill.raw_text, 'liberal');
      await new Promise(r => setTimeout(r, DELAY));
      const conservative = await summarize(bill.title, bill.raw_text, 'conservative');
      await new Promise(r => setTimeout(r, DELAY));

      if (balanced) {
        await admin.from('bills').update({
          summary: balanced,
          summary_liberal: liberal,
          summary_conservative: conservative,
          is_summarized: true,
        }).eq('id', bill.id);
        totalDone++;
        process.stdout.write(`✓`);
      } else {
        totalFailed++;
        process.stdout.write(`✗`);
      }
    } catch (err) {
      console.error(`\nError on ${bill.id}: ${err.message}`);
      totalFailed++;
      // If rate limited, wait longer
      if (err.message.includes('rate') || err.status === 429) {
        console.log('Rate limited, waiting 30s...');
        await new Promise(r => setTimeout(r, 30000));
      }
    }
  }
}

console.log(`\nDone. Summarized: ${totalDone}, Failed: ${totalFailed}`);
