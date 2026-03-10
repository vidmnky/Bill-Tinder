// =============================================
// Groq Summarization Client
// =============================================
// Uses Llama 3 8B for plain-speak bill summaries.
// Free tier: 30 requests/minute — we self-limit to 24/min (2.5s gap).
// =============================================

import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = `Summarize this bill in 2-3 factual sentences for a regular voter. State what the bill does, then state BOTH the intended benefit AND the cost or tradeoff. Be dry and balanced — do not make the bill sound good or bad.

Format: "[What it does]. [Who benefits and how]. [Who pays, what it costs, or what the tradeoff is]."

Rules:
- Plain English, no jargon, no bill numbers, no legalese.
- Never start with "This bill would" or "If this passes." Just state facts.
- Include dollar amounts, deadlines, or thresholds when available.
- Always mention a cost, tradeoff, or criticism if one exists. If the cost is unclear, say "Cost/funding source not specified."
- No opinions, no spin, no enthusiasm. Boring is good.
- No newlines. One continuous paragraph. Under 60 words.`;

/**
 * Summarize a bill using Groq's Llama 3 8B model.
 *
 * @param {string} title - bill title
 * @param {string} rawText - first ~3000 chars of bill text
 * @returns {string} plain-English summary
 */
export async function summarizeBill(title, rawText) {
  const userContent = `Bill Title: ${title}\n\nBill Text (excerpt):\n${rawText || '(No text available — summarize from title only)'}`;

  const completion = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    temperature: 0.3,
    max_tokens: 200,
  });

  return completion.choices[0]?.message?.content?.trim() || '';
}
