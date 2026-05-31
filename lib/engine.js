// ============================================================
// MANALORE ENGINE  —  all Python analysis logic ported to JS
// ============================================================

const SCRYFALL = "https://api.scryfall.com";
const FORMATS = ["standard", "pioneer", "modern", "legacy", "vintage", "commander", "pauper"];

export const STAPLES = [
  "Ragavan, Nimble Pilferer", "Sheoldred, the Apocalypse", "Lightning Bolt", "Counterspell",
  "The One Ring", "Orcish Bowmasters", "Sol Ring", "Fatal Push", "Thoughtseize",
  "Teferi, Time Raveler", "Wrenn and Six", "Murktide Regent", "Brainstorm",
  "Swords to Plowshares", "Birds of Paradise", "Esper Sentinel", "Solitude", "Grief",
  "Monastery Swiftspear", "Atraxa, Grand Unifier", "Force of Will", "Ledger Shredder",
  "Liliana of the Veil", "Tarmogoyf", "Snapcaster Mage", "Dark Confidant",
  "Walking Ballista", "Aether Vial", "Karn, the Great Creator", "Leyline Binding",
  "Bloodtithe Harvester", "Mox Opal", "Misty Rainforest", "Urza's Saga",
  "Cyclonic Rift", "Rhystic Study", "Smothering Tithe", "Cultivate",
  "Underground Sea", "Mana Crypt",
];

export const ARCH_FILTER = {
  "Aggro":     "(t:creature mv<=3)",
  "Tempo":     "(t:creature mv<=3 or o:\"counter target spell\" or o:flash)",
  "Control":   "(o:\"counter target spell\" or o:\"draw\" or o:\"destroy target\" or t:planeswalker)",
  "Midrange":  "(t:creature mv>=2 mv<=5 or o:\"destroy target\")",
  "Burn":      "(o:\"damage\" (t:instant or t:sorcery or t:creature mv<=2))",
  "Ramp":      "(o:\"add {\" or o:\"search your library for\" t:land or mv>=5)",
  "Combo":     "(o:\"whenever\" or o:\"you may\" or t:artifact)",
  "Artifacts": "(t:artifact or o:\"artifact\")",
};

export const CURVE = {
  "Aggro":     { Threat: 18, Removal: 6, "Card Advantage": 2 },
  "Tempo":     { Threat: 11, Counter: 4, Removal: 5, "Card Advantage": 3, Disruption: 1 },
  "Control":   { Removal: 8, Counter: 6, "Card Advantage": 6, Engine: 4 },
  "Midrange":  { Threat: 9, Removal: 6, Disruption: 3, "Card Advantage": 4, Engine: 2 },
  "Burn":      { Threat: 11, Removal: 11, "Card Advantage": 2 },
  "Ramp":      { Ramp: 11, Engine: 5, "Card Advantage": 4, Threat: 3, Removal: 1 },
  "Combo":     { Engine: 7, "Card Advantage": 6, Ramp: 4, Disruption: 3, Counter: 2 },
  "Artifacts": { Engine: 8, Ramp: 6, Threat: 4, "Card Advantage": 3, Removal: 2 },
};

export const W_IMP = { play_rank: 0.26, eff: 0.18, card_adv: 0.14, flex: 0.12, ubiq: 0.18, kw: 0.12 };

// ── Helpers ──────────────────────────────────────────────────
export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

export function imgUri(c, kind = "normal") {
  const u = c.image_uris || (c.card_faces?.[0]?.image_uris ?? null);
  return u ? u[kind] : null;
}

export function oracle(c) {
  let t = c.oracle_text || "";
  if (!t && c.card_faces) t = c.card_faces.map(f => f.oracle_text || "").join(" ");
  return (t || "").toLowerCase();
}

export function typeLine(c) {
  return (c.type_line || c.card_faces?.[0]?.type_line || "").toLowerCase();
}

export function priceNow(c) {
  const p = c.prices || {};
  if (p.usd)      return parseFloat(p.usd);
  if (p.usd_foil) return parseFloat(p.usd_foil);
  if (p.eur)      return parseFloat(p.eur) * 1.08;
  return null;
}

export function legalFormats(c) {
  const L = c.legalities || {};
  return FORMATS.filter(f => L[f] === "legal");
}

// ── Feature extraction ────────────────────────────────────────
export function features(c) {
  const t  = oracle(c);
  const tl = typeLine(c);
  const cmc  = c.cmc || 0;
  const rank = c.edhrec_rank || 45000;

  const play_rank = clamp(10 - Math.log10(rank + 1) * 2.05, 0, 10);
  const ubiq      = clamp(legalFormats(c).length * 1.55, 0, 10);
  const kw        = clamp(
    (c.keywords?.length || 0) * 1.6 + (/modal|choose one|escape|flashback/.test(t) ? 2 : 0),
    0, 10
  );
  let eff = clamp(9.5 - cmc * 1.1, 1, 10);
  if (tl.includes("instant")) eff = clamp(eff + 0.8, 0, 10);

  let card_adv = 0;
  if (/draw (a|two|three|four|\w+) cards?/.test(t)) card_adv += 6;
  if (t.includes("search your library"))             card_adv += 3;
  if (/create .*token/.test(t))                      card_adv += 2;
  if (/whenever .* dies|whenever .* enters/.test(t)) card_adv += 2;
  card_adv = clamp(card_adv, 0, 10);

  const ci  = c.color_identity || [];
  const flex = clamp(
    4 + (2 - ci.length)
      + (tl.includes("instant") ? 2 : 0)
      + (/any (color|type)|choose|modal/.test(t) ? 2 : 0),
    0, 10
  );
  const tempo = clamp(
    (/haste|flash|flying|prowess/.test(t) ? 3 : 0)
      + (10 - cmc) * 0.55
      + (tl.includes("creature") ? 1.5 : 0),
    0, 10
  );
  return { play_rank, ubiq, kw, eff, card_adv, flex, tempo, cmc, rank };
}

export function reprintRisk(c) {
  const rr = { common: 8, uncommon: 7, rare: 5, mythic: 3, special: 2, bonus: 2 }[c.rarity] ?? 5;
  return c.reserved ? 0 : rr;
}

export function importance(c) {
  const f = c._f;
  return Math.round(Object.keys(W_IMP).reduce((s, k) => s + W_IMP[k] * f[k], 0) / 10 * 100);
}

export function demand(c) {
  const f = c._f;
  return Math.round((0.55 * f.play_rank + 0.25 * f.flex + 0.20 * f.card_adv) / 10 * 100);
}

export function driftMo(c) {
  return (demand(c) / 100 - 0.5) * 0.060 - (reprintRisk(c) / 10) * 0.020;
}

export function projPrice(c) {
  const p = priceNow(c);
  return p == null ? null : p * (1 + 3 * driftMo(c));
}

export function confidence(c) {
  return Math.round(clamp(45 + c._f.play_rank * 5 - reprintRisk(c) * 1.5, 45, 95));
}

export function role(c) {
  const t  = oracle(c);
  const tl = typeLine(c);
  if (tl.includes("land"))   return "Land";
  if (/counter target (spell|ability|creature spell)/.test(t)) return "Counter";
  if (/destroy target|exile target|deals? \d+ damage to (any|target)|fight/.test(t)) return "Removal";
  if (/add \{|untap target land|search your library for .*(land|basic)/.test(t)) return "Ramp";
  if (/draw (a|two|three|four|\w+) cards?/.test(t)) return "Card Advantage";
  if (/discard|sacrifices|can't|loses the game|skip (your|their)/.test(t)) return "Disruption";
  if (tl.includes("planeswalker")) return "Engine";
  if (tl.includes("artifact") || tl.includes("enchantment")) return "Engine";
  if (tl.includes("creature")) return "Threat";
  return "Spell";
}

export function enrich(c) {
  return { ...c, _f: features(c) };
}

// ── Deck builder ──────────────────────────────────────────────
export function buildDeckFromCards(cards, arch, fmt) {
  const enriched = cards.map(enrich);
  const byRole = {};
  for (const c of enriched) {
    const r = role(c) === "Spell" ? "Card Advantage" : role(c);
    if (!byRole[r]) byRole[r] = [];
    byRole[r].push(c);
  }
  for (const r in byRole) byRole[r].sort((a, b) => importance(b) - importance(a));

  const curveWants = CURVE[arch] || {};
  const groups = [];
  let nonland = 0;

  for (const [r, want] of Object.entries(curveWants)) {
    const lst = byRole[r] || [];
    if (!lst.length) continue;
    let remain = want, i = 0;
    const picks = [];
    while (remain > 0 && i < lst.length) {
      const q4 = Math.min(4, Math.ceil(remain / (lst.length - i)));
      const add = Math.min(q4, remain);
      picks.push([lst[i], add]);
      remain -= add; i++;
    }
    const cnt = picks.reduce((s, [, q]) => s + q, 0);
    nonland += cnt;
    groups.push({ role: r, picks, cnt });
  }

  const total = fmt === "commander" ? 100 : 60;
  const lands = Math.max(0, total - nonland);
  return { groups, nonland, lands };
}

// ── Synergy proxy ─────────────────────────────────────────────
export function cooccurrenceRecommend(seedNames, candidateCards, top = 15) {
  return candidateCards
    .filter(c => !seedNames.has(c.name))
    .map(c => ({ score: 0.5 * c._f.play_rank + 0.3 * c._f.flex + 0.2 * c._f.card_adv, c }))
    .sort((a, b) => b.score - a.score)
    .slice(0, top)
    .map(x => x.c);
}
