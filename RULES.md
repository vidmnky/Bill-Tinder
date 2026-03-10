# Bill-Tinder / LegisSwipe — Project Rules

**READ THIS FILE AT THE START OF EVERY SESSION. These rules are non-negotiable.**

---

## NEVER PUSH WITHOUT PERMISSION — ABSOLUTE RULE
- NEVER run `git push` unless Nick explicitly says the word "push" in that specific exchange.
- "commit and push" = push allowed. "commit" alone = commit only, do NOT push.
- After committing: say "committed locally, ready to push when you say so" — then STOP AND WAIT.
- This rule was established after 3 unauthorized pushes in session 1, and VIOLATED AGAIN in session 3.
- No exceptions. No "it seemed safe." No "he said push earlier so it's fine now." ASK EVERY TIME.
- "Deploy" or "get it on Vercel" does NOT mean "push." Ask: "Ready for me to push to GitHub?"
- If in doubt: DO NOT PUSH. Ask first. Always.

## CRASH LOG UPDATE RULE
- Update ~/Desktop/Bill-Tinder/CRASH_LOG.md after EVERY exchange.
- Not just when Nick reminds you. This is non-negotiable.
- If there's any chance of a crash, the log should already reflect the latest state.

## NEVER REPLACE WORKING LAYOUTS
- If the current UI layout is working and confirmed, NEVER replace it with a different layout.
- Fix problems WITHIN the existing layout.
- If a plan calls for replacing the layout, STOP and ask Nick first.

## DON'T PASTE SECRETS IN CHAT
- API keys go directly into .env.local, not into conversation.
- If Nick pastes keys, put them in the file immediately and note the security concern.

## LEGISCAN API — CONSERVATIVE USAGE
- Monthly limit: 30,000 queries (LegiScan's rule)
- Our soft limit: 1,000/month (self-imposed)
- Emergency stop: 2,000/month
- Strategy: BULK DATASETS ONLY (getDatasetList + getDataset)
- NEVER use getMasterList/getBill/getBillText for batch fetching
- Every call: budget-checked BEFORE, logged AFTER, rate-limited 200ms
- If budget check fails: abort entire cycle, no partial runs
- See lib/legiscan-budget.js for hardcoded rules

## ENV VAR NAMES (Supabase updated their naming)
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (NOT the old `anon key`)
- `SUPABASE_SECRET_KEY` (NOT the old `service_role key`)
- These names must match in .env.local, env.example, and lib/supabase.js

## SESSION RECOVERY
On every new session:
1. Read this RULES.md file FIRST
2. Read CRASH_LOG.md to see where we left off
3. Read the plan file: ~/.claude/plans/radiant-chasing-dusk.md
4. Resume from last recorded step — don't re-investigate from scratch
