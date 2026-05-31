import { scryfallCollection } from "../../lib/scryfall";
import { enrich, STAPLES } from "../../lib/engine";

export default async function handler(req, res) {
  try {
    const raw = await scryfallCollection(STAPLES);
    const cards = raw.filter(c => c.name).map(enrich);
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
    res.json({ cards });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
