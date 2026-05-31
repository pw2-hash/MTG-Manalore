const SCRYFALL = "https://api.scryfall.com";
const HEADERS = { "User-Agent": "ManaloreTerminal/1.0", Accept: "application/json" };

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function scryfallCollection(names) {
  const out = [];
  for (let i = 0; i < names.length; i += 70) {
    const chunk = names.slice(i, i + 70);
    const body = { identifiers: chunk.map(n => ({ name: n })) };
    const res = await fetch(`${SCRYFALL}/cards/collection`, {
      method: "POST",
      headers: { ...HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) continue;
    const data = await res.json();
    out.push(...(data.data || []));
    await sleep(90);
  }
  return out;
}

export async function scryfallNamed(name) {
  const res = await fetch(
    `${SCRYFALL}/cards/named?fuzzy=${encodeURIComponent(name)}`,
    { headers: HEADERS }
  );
  return res.ok ? res.json() : null;
}

export async function scryfallSearch(query, maxCards = 80) {
  const params = new URLSearchParams({ q: query, order: "edhrec", unique: "cards" });
  const res = await fetch(`${SCRYFALL}/cards/search?${params}`, { headers: HEADERS });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.data || []).slice(0, maxCards);
}
