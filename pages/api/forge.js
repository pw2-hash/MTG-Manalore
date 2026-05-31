import { scryfallSearch } from "../../lib/scryfall";
import { enrich, buildDeckFromCards, ARCH_FILTER } from "../../lib/engine";

export default async function handler(req, res) {
  const { colors, arch, fmt } = req.query;
  const colArr = colors ? colors.split(",") : [];
  const colExpr = colArr.length ? `id<=${colArr.join("").toLowerCase()}` : "id=c";
  const filter = ARCH_FILTER[arch] || ARCH_FILTER["Aggro"];
  const q = `${colExpr} ${filter} f:${fmt || "modern"} -t:land`;

  try {
    const raw = await scryfallSearch(q, 80);
    const cards = raw.filter(c => c.name).map(enrich);
    if (!cards.length) return res.status(404).json({ error: "No cards matched" });
    const deck = buildDeckFromCards(cards, arch, fmt || "modern");
    res.setHeader("Cache-Control", "s-maxage=600");
    res.json(deck);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
