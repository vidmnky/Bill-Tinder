// =============================================
// Groq Summarization Client
// =============================================
// Uses Llama 3.1 8B for bill summaries in 3 modes.
// Free tier: 30 requests/minute — we self-limit to 24/min (2.5s gap).
// =============================================

import Groq from 'groq-sdk';

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

/**
 * Summarize a bill in a specific mode.
 *
 * @param {string} title - bill title
 * @param {string} rawText - first ~3000 chars of bill text
 * @param {'balanced'|'liberal'|'conservative'} mode
 * @returns {string} summary
 */
export async function summarizeBill(title, rawText, mode = 'balanced') {
  const userContent = `Bill Title: ${title}\n\nBill Text (excerpt):\n${rawText || '(No text available — summarize from title only)'}`;

  const completion = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      { role: 'system', content: PROMPTS[mode] || PROMPTS.balanced },
      { role: 'user', content: userContent },
    ],
    temperature: 0.3,
    max_tokens: 200,
  });

  return completion.choices[0]?.message?.content?.trim() || '';
}
