// =============================================
// Fluff Filter
// =============================================
// Detects bills that aren't substantive legislation:
// - Resolutions (commemorative, congratulatory)
// - Building/post office namings
// - Commemorations and awareness months
// - Coins and medals
// - Stubs with no real content
//
// Runs LOCALLY on extracted data — zero API cost.
// =============================================

const FLUFF_PATTERNS = [
  // Commemorative resolutions
  {
    test: (title) => /\b(congratulat|commend|honor|recogniz|acknowledg|celebrat)/i.test(title),
    reason: 'commemorative_resolution',
  },
  // Building and post office namings
  {
    test: (title) => /\b(designat|nam)(e|es|ed|ing)\b.{0,40}\b(building|post office|courthouse|facility|bridge|highway|road|street|park|center|memorial)/i.test(title),
    reason: 'building_naming',
  },
  // Awareness days/weeks/months
  {
    test: (title) => /\b(awareness|appreciation|recognition|observance)\s+(day|week|month|year)/i.test(title),
    reason: 'awareness_designation',
  },
  // Coins and medals
  {
    test: (title) => /\b(commemorative coin|congressional (gold |silver )?medal|mint.*coin)/i.test(title),
    reason: 'coin_or_medal',
  },
  // Adjournment / procedural
  {
    test: (title) => /\b(adjourn|sine die|order of business)\b/i.test(title),
    reason: 'procedural',
  },
];

/**
 * Check if a bill is "fluff" — not substantive legislation.
 *
 * @param {string} title - bill title
 * @param {string} rawText - bill text (optional, for stub detection)
 * @returns {{ isFluff: boolean, reason: string|null }}
 */
export function detectFluff(title, rawText) {
  if (!title) {
    return { isFluff: true, reason: 'no_title' };
  }

  // Check title against patterns
  for (const pattern of FLUFF_PATTERNS) {
    if (pattern.test(title)) {
      return { isFluff: true, reason: pattern.reason };
    }
  }

  // Stub detection: title too short AND no text
  if (title.length < 20 && (!rawText || rawText.length < 100)) {
    return { isFluff: true, reason: 'stub' };
  }

  return { isFluff: false, reason: null };
}
