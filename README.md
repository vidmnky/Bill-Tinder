# LegisSwipe

Two bills. One choice. Your vote on what matters.

A mobile-first app that presents real legislation — federal and state — for users to compare and pick. No fluff. No renaming of bridges. Plain-speak summaries. Anonymous voting data collected as a ranked-choice dataset.

---

## Setup

### 1. Get your API keys

You need accounts at all four:

| Service | Where to register | Cost |
|---|---|---|
| Congress.gov | https://api.congress.gov/sign-up/ | Free |
| LegiScan | https://legiscan.com/legiscan | Free (30k req/month) |
| Groq | https://console.groq.com | Free |
| Supabase | https://supabase.com | Free tier |

### 2. Set up Supabase

1. Create a new Supabase project
2. Go to the **SQL Editor** in your project dashboard
3. Paste the entire contents of `supabase/schema.sql` and run it
4. Go to **Project Settings → API** and copy your keys

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Then fill in every value in `.env.local`. For `CRON_SECRET`, generate one:
```bash
openssl rand -hex 32
```

### 4. Install and run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000

### 5. Deploy to Vercel

1. Push this repo to GitHub
2. Go to https://vercel.com, sign in with GitHub, import the repo
3. In Vercel project settings → **Environment Variables**, add all variables from `.env.local`
4. Deploy

Vercel will automatically pick up the cron jobs defined in `vercel.json`.

---

## How the bill pipeline works

```
[Every 6 hours]
  Congress.gov API → fetch 250 most recently updated federal bills
  LegiScan API → fetch master list for a rotating batch of ~7 states
  → Heuristic filter removes commemorations, renamings, simple resolutions
  → Remaining bills stored in `bills` table with is_summarized = false

[Every 2 hours]
  Pick up to 50 unsummarized bills
  → Send each to Groq (llama3-8b-8192) for plain-speak summary
  → Summary cached in DB — never regenerated

[User opens app]
  → Selects their state
  → App requests a bill pair from /api/bills/pair
  → Two bills returned — same level (both federal or both state)
  → User swipes up on preferred bill
  → Vote recorded in `comparisons` table
  → Pair marked as seen for this session
```

---

## The data

All votes are stored in the `comparisons` table. Each row is:
- `bill_a_id` / `bill_b_id` — the two bills compared
- `winner_id` — which one the user chose
- `user_state` — what state filter was active
- `session_id` — anonymous session UUID (no PII)
- `created_at` — timestamp

The `bill_win_rates` view gives you instant rankings.

---

## Keyboard shortcuts (desktop)

- `←` Left arrow — choose left bill
- `→` Right arrow — choose right bill

---

## Architecture

```
Next.js (App Router)
├── app/
│   ├── page.jsx              # Root — state selection + game
│   ├── components/
│   │   ├── SwipeArena.jsx    # Game logic, touch/click/keyboard
│   │   ├── BillCard.jsx      # Individual bill display
│   │   ├── StateSelect.jsx   # First-run state picker
│   │   └── session.js        # Anonymous session UUID
│   └── api/
│       ├── bills/pair/       # GET — returns a bill pair
│       ├── vote/             # POST — records a vote
│       └── cron/
│           ├── fetch-bills/  # Pulls new bills from APIs
│           └── summarize-bills/ # Generates summaries via Groq
├── lib/
│   ├── supabase.js           # DB client (public + admin)
│   ├── congress.js           # Congress.gov API wrapper
│   ├── legiscan.js           # LegiScan API wrapper
│   ├── groq.js               # Groq summarization
│   └── filter.js             # Fluff bill detection
└── supabase/
    └── schema.sql            # Full DB schema + views
```
