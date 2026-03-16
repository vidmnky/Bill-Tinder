// =============================================
// Bill Summarization Client
// =============================================
// Primary: Google Gemini Flash (1.5M tokens/day free tier)
// Fallback: Groq Llama 3.1 8B (500k tokens/day free tier)
// =============================================

import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';

// --- Gemini setup ---
const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

// --- Groq setup (fallback) ---
const groq = process.env.GROQ_API_KEY
  ? new Groq({ apiKey: process.env.GROQ_API_KEY, timeout: 15000 })
  : null;

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

  impact: `Write ONE sentence explaining what this bill means for a regular person. Make it personal and concrete — use "you" or "your." Examples of good impact lines:
- "Your grocery bill could go up if import tariffs rise."
- "You'd get 12 weeks of paid leave if you have a new baby."
- "Your kids' school would get less federal funding."

Rules:
- One sentence only. Under 25 words.
- Use "you" or "your" — make it feel personal.
- Be specific about the real-world effect, not the policy mechanism.
- No jargon, no bill numbers, no hedging. Just the impact.
- If the bill is too procedural or narrow to affect regular people, write "Affects government operations, not daily life."`,
};

/**
 * Summarize a bill using Gemini (primary) or Groq (fallback).
 *
 * @param {string} title - bill title
 * @param {string} rawText - first ~3000 chars of bill text
 * @param {'balanced'|'liberal'|'conservative'} mode
 * @returns {string} summary
 */
export async function summarizeBill(title, rawText, mode = 'balanced') {
  const systemPrompt = PROMPTS[mode] || PROMPTS.balanced;
  const userContent = `Bill Title: ${title}\n\nBill Text (excerpt):\n${rawText || '(No text available — summarize from title only)'}`;

  // Try Gemini first
  if (genAI) {
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${userContent}` }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 200 },
      });
      const text = result.response.text()?.trim();
      if (text) return text;
    } catch (err) {
      console.warn(`[Summarize] Gemini failed (${mode}), falling back to Groq:`, err.message);
    }
  }

  // Fallback to Groq
  if (groq) {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.3,
      max_tokens: 200,
    });
    return completion.choices[0]?.message?.content?.trim() || '';
  }

  throw new Error('No summarization provider available (set GEMINI_API_KEY or GROQ_API_KEY)');
}
