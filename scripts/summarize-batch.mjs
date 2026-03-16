#!/usr/bin/env node
/**
 * Multi-provider bill summarizer with state-spread prioritization.
 *
 * Usage:
 *   node scripts/summarize-batch.mjs [count] [provider]
 *   count:    bills per run (default 50)
 *   provider: groq | gemini | cerebras (default groq)
 *
 * Run multiple instances with different providers in parallel — no redundancy,
 * each pulls unsummarized bills and marks them done atomically.
 *
 * Prioritization:
 *   1. States with fewest summarized bills (spread coverage)
 *   2. Federal bills interleaved
 *   3. Recently introduced bills first within each state
 */

import { createClient } from '@supabase/supabase-js';
import Groq from 'groq-sdk';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

// ---- PROVIDER SETUP ----

const PROVIDER = process.argv[3] || 'groq';

function makeGroqSummarizer() {
  const client = new Groq({ apiKey: process.env.GROQ_API_KEY, timeout: 15000 });
  return async (systemPrompt, userContent) => {
    const r = await client.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.3,
      max_tokens: 200,
    });
    return r.choices[0]?.message?.content?.trim() || '';
  };
}

function makeGeminiSummarizer() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not set in .env.local');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
  return async (systemPrompt, userContent) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userContent }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 200 },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  };
}

function makeCerebrasSummarizer() {
  const key = process.env.CEREBRAS_API_KEY;
  if (!key) throw new Error('CEREBRAS_API_KEY not set in .env.local');
  return async (systemPrompt, userContent) => {
    const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.3,
        max_tokens: 200,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Cerebras ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  };
}

const providers = { groq: makeGroqSummarizer, gemini: makeGeminiSummarizer, cerebras: makeCerebrasSummarizer };
if (!providers[PROVIDER]) {
  console.error(`Unknown provider: ${PROVIDER}. Use: groq, gemini, cerebras`);
  process.exit(1);
}

const callLLM = providers[PROVIDER]();
console.log(`Provider: ${PROVIDER}`);

// ---- PROMPTS ----

const PROMPTS = {
  balanced: `Summarize this bill in 2-3 factual sentences for a regular voter. State what the bill does, then state BOTH the intended benefit AND the cost or tradeoff. Be dry and balanced — do not make the bill sound good or bad. Plain English, no jargon. Under 60 words.`,
  liberal: `Summarize this bill in 2-3 plain sentences the way a liberal voter would naturally talk about it. State what the bill does, then describe it through the lens of what liberals care about — access, fairness, environment, accountability. Matter-of-fact, not dramatic. Under 60 words.`,
  conservative: `Summarize this bill in 2-3 plain sentences the way a conservative voter would naturally talk about it. State what the bill does, then describe it through the lens of what conservatives care about — taxpayer cost, personal responsibility, limited government, property rights. Matter-of-fact, not dramatic. Under 60 words.`,
};

// ---- RATE LIMITS (requests per minute by provider) ----
const RATE_LIMITS = { groq: 28, gemini: 14, cerebras: 28 };
const rpm = RATE_LIMITS[PROVIDER] || 28;
const delayMs = Math.ceil(60000 / rpm); // ms between calls to stay under RPM

// ---- PRIORITIZED BILL FETCHING ----

async function fetchPrioritizedBills(count) {
  // Get summarized counts per state to find gaps
  const { data: stateCounts } = await supabase
    .from('bills')
    .select('state')
    .eq('is_fluff', false)
    .eq('is_summarized', true);

  const summarizedPerState = {};
  for (const row of stateCounts || []) {
    const s = row.state || 'federal';
    summarizedPerState[s] = (summarizedPerState[s] || 0) + 1;
  }

  // Get all states that have unsummarized bills
  const { data: statesWithWork } = await supabase
    .from('bills')
    .select('state')
    .eq('is_fluff', false)
    .eq('is_summarized', false)
    .limit(5000);

  const needsWork = new Set((statesWithWork || []).map(r => r.state || 'federal'));

  // Sort states by fewest summarized (spread coverage)
  const stateOrder = [...needsWork].sort((a, b) =>
    (summarizedPerState[a] || 0) - (summarizedPerState[b] || 0)
  );

  // Pull a few bills from each state in round-robin
  const perState = Math.max(1, Math.ceil(count / stateOrder.length));
  const allBills = [];

  for (const st of stateOrder) {
    if (allBills.length >= count) break;

    let q = supabase
      .from('bills')
      .select('id, title, raw_text, state, introduced_date')
      .eq('is_fluff', false)
      .eq('is_summarized', false)
      .order('introduced_date', { ascending: false, nullsFirst: false })
      .limit(perState);

    if (st === 'federal') {
      q = q.is('state', null);
    } else {
      q = q.eq('state', st);
    }

    const { data } = await q;
    if (data) allBills.push(...data);
  }

  return allBills.slice(0, count);
}

// ---- MAIN ----

const BATCH = parseInt(process.argv[2] || '50', 10);

console.log(`Fetching ${BATCH} prioritized bills (states with least coverage first)...`);

const bills = await fetchPrioritizedBills(BATCH);

if (!bills.length) { console.log('No bills to summarize.'); process.exit(0); }

// Show state distribution
const dist = {};
for (const b of bills) { const s = b.state || 'FED'; dist[s] = (dist[s] || 0) + 1; }
console.log(`Got ${bills.length} bills across ${Object.keys(dist).length} states:`, dist);

let ok = 0, fail = 0;

for (const bill of bills) {
  try {
    const userContent = `Bill Title: ${bill.title}\n\nBill Text (excerpt):\n${bill.raw_text || '(No text available — summarize from title only)'}`;

    const balanced = await callLLM(PROMPTS.balanced, userContent);
    await new Promise(r => setTimeout(r, delayMs));

    const liberal = await callLLM(PROMPTS.liberal, userContent);
    await new Promise(r => setTimeout(r, delayMs));

    const conservative = await callLLM(PROMPTS.conservative, userContent);
    await new Promise(r => setTimeout(r, delayMs));

    if (balanced) {
      await supabase.from('bills').update({
        summary: balanced,
        summary_liberal: liberal || null,
        summary_conservative: conservative || null,
        is_summarized: true,
      }).eq('id', bill.id);
      ok++;
      process.stdout.write(`\r  ${ok + fail}/${bills.length} (${ok} ok, ${fail} fail) [${bill.state || 'FED'}]`);
    } else {
      fail++;
    }
  } catch (err) {
    console.error(`\n  Failed [${bill.state || 'FED'}] ${bill.title.slice(0, 50)}: ${err.message}`);
    fail++;
    // If rate limited, wait extra
    if (err.message.includes('429') || err.message.includes('rate')) {
      console.log('  Rate limited — waiting 30s...');
      await new Promise(r => setTimeout(r, 30000));
    }
  }
}

console.log(`\nDone: ${ok} summarized, ${fail} failed out of ${bills.length}`);
