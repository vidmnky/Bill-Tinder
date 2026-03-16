/**
 * summarize-gemini.js
 *
 * Fetches unsummarized, non-fluff bills from Supabase and generates
 * three perspective summaries (balanced, liberal, conservative) via
 * Gemini 2.5 Flash, then writes the results back to Supabase.
 *
 * Usage:
 *   node scripts/summarize-gemini.js [batch_size] [delay_ms]
 *
 *   batch_size  — number of bills to process (default 50)
 *   delay_ms    — pause between API calls in ms (default 4500, ~13 RPM)
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

// ── Environment ──────────────────────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

if (!GEMINI_API_KEY) {
  console.error('ERROR: GEMINI_API_KEY not found in .env.local');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY not found in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── CLI args ─────────────────────────────────────────────────────────
const batchSize = parseInt(process.argv[2], 10) || 50;
const delayMs = parseInt(process.argv[3], 10) || 4500;

// ── Gemini endpoint ──────────────────────────────────────────────────
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// ── Helpers ──────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPrompt(bill) {
  const rawText = bill.raw_text && bill.raw_text.trim()
    ? bill.raw_text
    : 'No additional text available';

  return `You are summarizing a bill for a civic engagement app. Write THREE summaries of this bill, each ~60 words:

1. **Balanced**: Neutral, factual summary of what the bill does
2. **Liberal/Progressive**: How a progressive would view this bill (supportive or critical)
3. **Conservative**: How a conservative would view this bill (supportive or critical)

Return ONLY valid JSON with this exact format, no markdown fencing:
{"summary":"...","summary_liberal":"...","summary_conservative":"..."}

Bill title: ${bill.title}
Bill text/description: ${rawText}
State: ${bill.state}`;
}

function parseGeminiResponse(raw) {
  // The response text may be wrapped in ```json ... ``` fencing
  let text = raw.trim();
  // Strip markdown code fencing if present
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  text = text.trim();
  const parsed = JSON.parse(text);
  // Validate required keys
  if (!parsed.summary || !parsed.summary_liberal || !parsed.summary_conservative) {
    throw new Error('Response JSON missing required keys');
  }
  return parsed;
}

async function callGemini(prompt) {
  const body = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4096,
    },
  };

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API ${res.status}: ${errText}`);
  }

  const rawText = await res.text();
  if (!rawText || rawText.length < 10) {
    throw new Error(`Gemini returned empty/short body (${rawText.length} chars): ${rawText}`);
  }
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (e) {
    throw new Error(`Failed to parse Gemini JSON (${rawText.length} chars): ${rawText.slice(0, 300)}`);
  }

  // Extract text from the first candidate
  const candidates = data.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error('Gemini returned no candidates');
  }
  const parts = candidates[0].content?.parts;
  if (!parts || parts.length === 0) {
    throw new Error('Gemini candidate has no parts');
  }
  // Gemini 2.5 Flash may include "thought" parts — find the text part
  const textPart = parts.find(p => p.text !== undefined && !p.thought);
  if (!textPart) {
    // Fallback: last part is usually the response text
    const lastPart = parts[parts.length - 1];
    if (lastPart.text) return lastPart.text;
    throw new Error('No text part found in Gemini response');
  }
  return textPart.text;
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log(`Fetching up to ${batchSize} unsummarized, non-fluff bills...`);

  const { data: bills, error: fetchErr } = await supabase
    .from('bills')
    .select('id, title, raw_text, state')
    .eq('is_summarized', false)
    .eq('is_fluff', false)
    .limit(batchSize);

  if (fetchErr) {
    console.error('Supabase fetch error:', fetchErr.message);
    process.exit(1);
  }

  if (!bills || bills.length === 0) {
    console.log('No unsummarized bills found. Done.');
    return;
  }

  console.log(`Found ${bills.length} bills to summarize (delay: ${delayMs}ms between calls)\n`);

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < bills.length; i++) {
    const bill = bills[i];
    const titleSnippet = (bill.title || '(no title)').substring(0, 60);
    console.log(`Processing [${i + 1}/${bills.length}]: ${bill.state} - ${titleSnippet}...`);

    try {
      const prompt = buildPrompt(bill);
      const rawResponse = await callGemini(prompt);
      if (!rawResponse) throw new Error('Empty response from Gemini');
      if (process.env.DEBUG) console.log('  RAW:', rawResponse.slice(0, 200));
      const summaries = parseGeminiResponse(rawResponse);

      const { error: updateErr } = await supabase
        .from('bills')
        .update({
          summary: summaries.summary,
          summary_liberal: summaries.summary_liberal,
          summary_conservative: summaries.summary_conservative,
          is_summarized: true,
        })
        .eq('id', bill.id);

      if (updateErr) {
        console.error(`  FAILED (Supabase update): ${updateErr.message}`);
        failed++;
      } else {
        console.log(`  OK`);
        succeeded++;
      }
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      failed++;
    }

    // Delay before next call (skip delay after the last bill)
    if (i < bills.length - 1) {
      await sleep(delayMs);
    }
  }

  console.log(`\nDone. { processed: ${bills.length}, succeeded: ${succeeded}, failed: ${failed} }`);
}

main();
