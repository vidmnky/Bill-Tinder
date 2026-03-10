// =============================================
// Groq Summarization Client
// =============================================
// Uses Llama 3 8B for plain-speak bill summaries.
// Free tier: 30 requests/minute — we self-limit to 24/min (2.5s gap).
// =============================================

import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = `You are a nonpartisan bill summarizer. Given a bill's title and text, write a 2-3 sentence summary that:
1. Explains what the bill actually does in plain English (no jargon)
2. Mentions who it affects
3. Notes any key numbers (dollar amounts, dates, thresholds)

Do NOT include opinions, partisan framing, or your own analysis. Just the facts in everyday language a high schooler would understand. Keep it under 80 words.`;

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
    model: 'llama3-8b-8192',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    temperature: 0.3,
    max_tokens: 200,
  });

  return completion.choices[0]?.message?.content?.trim() || '';
}
