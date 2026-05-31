# MANALORE Terminal

The Bloomberg terminal of Magic: The Gathering — ported from Streamlit to Next.js for Vercel deployment.

## Tech Stack

| Original (Streamlit) | Replaced by |
|---|---|
| `streamlit` | Next.js 14 (React) |
| `requests` | `fetch` (native in Node.js 18+) |
| `pandas` | Plain JS arrays/objects |
| `numpy` | Plain JS math |
| `scikit-learn` | Weighted formula in `lib/engine.js` |
| Scryfall Python client | `lib/scryfall.js` (direct REST calls) |
| Moxfield Python client | `pages/api/analyze.js` (direct REST) |

## Deploy to Vercel

### Option A — Vercel CLI
```bash
npm i -g vercel
vercel
# follow prompts, framework auto-detected as Next.js
```

### Option B — GitHub + Vercel Dashboard
1. Push this repo to GitHub
2. Go to https://vercel.com/new
3. Import your repo — Vercel auto-detects Next.js
4. Click **Deploy** — done

No environment variables needed. All data comes from public Scryfall & Moxfield APIs.

## Local Development
```bash
npm install
npm run dev
# open http://localhost:3000
```

## Architecture

```
pages/
  index.js          ← all UI tabs (Terminal, Card Intel, Market, Deck Forge, Deck Analyzer)
  api/
    staples.js      ← GET /api/staples  → batch-fetch 40 staple cards
    card.js         ← GET /api/card?name=... → single card lookup
    forge.js        ← GET /api/forge?colors=R,G&arch=Aggro&fmt=modern
    analyze.js      ← GET /api/analyze?url=<moxfield_url>
lib/
  engine.js         ← all analysis logic (importance, demand, projPrice, etc.)
  scryfall.js       ← thin Scryfall REST wrappers
styles/
  globals.css       ← terminal aesthetic (dark gold theme)
```

## Notes

- **Prices** are Scryfall aggregated market values, not live bids.
- **Projections** are model output — not financial advice.
- Moxfield throttles bot traffic; the Deck Analyzer may occasionally get a 429. Retry after a moment.
- Scryfall rate-limits at ~10 req/sec — API routes include a 90ms sleep between batch chunks.
- API routes are cached via `Cache-Control: s-maxage=3600` so repeated loads are fast on Vercel's CDN.
