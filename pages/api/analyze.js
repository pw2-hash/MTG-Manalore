import { scryfallCollection, scryfallSearch } from "../../lib/scryfall";
import { enrich, cooccurrenceRecommend } from "../../lib/engine";

function moxfieldId(urlOrId) {
  const m = urlOrId.match(/\/decks\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : urlOrId.trim();
}

async function fetchMoxfieldDeck(urlOrId) {
  const did = moxfieldId(urlOrId);
  const HEADERS = { "User-Agent": "ManaloreTerminal/1.0", Accept: "application/json" };
  try {
    const res = await fetch(`https://api.moxfield.com/v2/decks/all/${did}`, { headers: HEADERS });
    if (!res.ok) return { names: null, error: `Moxfield returned ${res.status}` };
    const data = await res.json();
    const names = [];
    for (const zone of ["mainboard", "commanders", "companions"]) {
      for (const entry of Object.values(data[zone] || {})) {
        if (entry.card?.name) names.push(entry.card.name);
      }
    }
    return { names, error: null };
  } catch (e) {
    return { names: null, error: e.message };
  }
}

export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "url required" });

  const { names, error } = await fetchMoxfieldDeck(url);
  if (error) return res.status(400).json({ error });

  const raw = await scryfallCollection(names);
  const cards = raw.filter(c => c.name).map(enrich);

  const ci = [...new Set(cards.flatMap(c => c.color_identity || []))].sort();
  const candQ = `id<=${ci.join("").toLowerCase() || "c"} f:commander -t:land`;
  const candRaw = await scryfallSearch(candQ, 80);
  const candidates = candRaw.map(enrich);
  const recs = cooccurrenceRecommend(new Set(names), candidates, 12);

  res.setHeader("Cache-Control", "s-maxage=600");
  res.json({ cards, recs });
}
