import { scryfallNamed } from "../../lib/scryfall";
import { enrich } from "../../lib/engine";

export default async function handler(req, res) {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: "name required" });
  try {
    const raw = await scryfallNamed(name);
    if (!raw) return res.status(404).json({ error: "not found" });
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
    res.json({ card: enrich(raw) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
