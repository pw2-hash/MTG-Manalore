import Head from "next/head";
import { useState, useEffect, useCallback } from "react";
import {
  importance, demand, priceNow, projPrice, driftMo, confidence,
  role, imgUri, legalFormats, reprintRisk, W_IMP, enrich
} from "../lib/engine";

// ── Tiny helpers ────────────────────────────────────────────
function fmt$(v) { return v == null ? "n/a" : `$${v.toFixed(2)}`; }
function fmtDelta(c) {
  const p = priceNow(c), pj = projPrice(c);
  if (!p || !pj) return { txt: "n/a", pos: true };
  const d = (pj / p * 100 - 100);
  return { txt: `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`, pos: d >= 0 };
}

// ── Reusable micro components ────────────────────────────────
function Spinner() { return <span className="spinner" />; }

function Loading({ label = "Loading…" }) {
  return (
    <div className="loading-state">
      <Spinner /> {label}
    </div>
  );
}

function Metric({ label, value, delta }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {delta && <div className="metric-delta">{delta}</div>}
    </div>
  );
}

function SectionHeader({ title }) {
  return (
    <div className="section-header">
      <h2>{title}</h2>
      <div className="divider" />
    </div>
  );
}

function BarChart({ data, maxVal }) {
  const max = maxVal || Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ marginBottom: 12 }}>
      {data.map(({ label, value }) => (
        <div className="bar-row" key={label}>
          <div className="bar-label">{label}</div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(value / max * 100).toFixed(1)}%` }} />
          </div>
          <div className="bar-val">{value.toFixed(1)}</div>
        </div>
      ))}
    </div>
  );
}

function LineSparkline({ values, color = "#5fc28a" }) {
  const max = Math.max(...values, 0.01);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  return (
    <div className="sparkline" style={{ height: 60 }}>
      {values.map((v, i) => (
        <div
          key={i}
          className="spark-bar"
          style={{ height: `${((v - min) / range * 100).toFixed(1)}%`, background: color }}
        />
      ))}
    </div>
  );
}

// ── TABS ─────────────────────────────────────────────────────

function TabTerminal({ pool }) {
  if (!pool.length) return <Loading label="Summoning live card data…" />;

  const gainer = pool.reduce((best, c) => {
    const d = (projPrice(c) || 0) - (priceNow(c) || 0);
    const bd = (projPrice(best) || 0) - (priceNow(best) || 0);
    return d > bd ? c : best;
  });
  const avgDem = Math.round(pool.reduce((s, c) => s + demand(c), 0) / pool.length);
  const reserved = pool.filter(c => c.reserved).length;
  const gDelta = fmtDelta(gainer);

  const sorted = [...pool].sort((a, b) => importance(b) - importance(a));

  return (
    <>
      <div className="metrics">
        <Metric label="Watchlist Demand" value={avgDem} delta={`${pool.length} cards tracked`} />
        <Metric label="Top Gainer 90d" value={gainer.name.split(",")[0]} delta={<span className={gDelta.pos ? "green" : "red"}>{gDelta.txt}</span>} />
        <Metric label="Reserved List" value={reserved} delta="supply-locked" />
        <Metric label="Cards Tracked" value={pool.length} />
      </div>

      <div className="card-grid">
        {sorted.map(c => {
          const art = imgUri(c, "art_crop");
          const { txt, pos } = fmtDelta(c);
          return (
            <div className="card-item" key={c.id}>
              {art && <img src={art} alt={c.name} loading="lazy" />}
              <div className="card-name">{c.name}</div>
              <div className="card-meta">
                IMP {importance(c)} · {fmt$(priceNow(c))} ·{" "}
                <span className={pos ? "green" : "red"}>{txt}</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function TabCardIntel({ pool }) {
  const [query, setQuery] = useState("Ragavan, Nimble Pilferer");
  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const lookup = useCallback(async (name) => {
    setLoading(true);
    const cached = pool.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (cached) { setCard(cached); setLoading(false); setSearched(true); return; }
    try {
      const res = await fetch(`/api/card?name=${encodeURIComponent(name)}`);
      const data = await res.json();
      setCard(data.card || null);
    } catch {}
    setLoading(false);
    setSearched(true);
  }, [pool]);

  const c = card;
  const featureLabels = [
    ["Play-rank", "play_rank"], ["Efficiency", "eff"], ["Card adv", "card_adv"],
    ["Ubiquity", "ubiq"], ["Flexibility", "flex"], ["Keywords", "kw"],
  ];

  return (
    <>
      <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && lookup(query)}
          placeholder="Card name…"
        />
        <button className="btn btn-primary" onClick={() => lookup(query)} disabled={loading}>
          {loading ? <Spinner /> : "Look up"}
        </button>
      </div>

      {loading && <Loading label="Consulting the oracle…" />}
      {!loading && searched && !c && <p className="muted mono" style={{ fontSize: 13 }}>Card not found.</p>}
      {!loading && c && (
        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 28, alignItems: "start" }}>
          <div>
            {imgUri(c, "normal") && <img src={imgUri(c, "normal")} alt={c.name} style={{ width: "100%", borderRadius: 6 }} />}
            <div className="card-meta" style={{ marginTop: 8 }}>
              {legalFormats(c).join(" · ").toUpperCase() || "—"}
            </div>
          </div>
          <div>
            <h3 style={{ fontFamily: "'Marcellus', serif", color: "var(--gold)", fontSize: 22, marginBottom: 16, letterSpacing: 1 }}>{c.name}</h3>
            <div className="metrics" style={{ marginBottom: 20 }}>
              <Metric label="Importance" value={importance(c)} />
              <Metric label="Demand" value={demand(c)} />
              <Metric label="Price Now" value={fmt$(priceNow(c))} delta={<span className={fmtDelta(c).pos ? "green" : "red"}>{fmtDelta(c).txt} 90d</span>} />
            </div>

            <SectionHeader title="Score Breakdown" />
            <BarChart data={featureLabels.map(([label, key]) => ({
              label,
              value: W_IMP[key] * (c._f[key] || 0) * 10,
            }))} maxVal={3} />

            <SectionHeader title="Price Projection" />
            <LineSparkline values={[0, 1, 2, 3].map(m => {
              const p = priceNow(c);
              return p ? parseFloat((p * (1 + m * driftMo(c))).toFixed(2)) : 0;
            })} />
            <div className="mono muted" style={{ fontSize: 10, marginTop: 6 }}>
              Now → +30d → +60d → +90d
            </div>

            <div style={{ marginTop: 16, fontSize: 12, color: "var(--muted)", fontFamily: "IBM Plex Mono" }}>
              Role: <span className="gold">{role(c)}</span> ·
              Confidence: {confidence(c)}% ·
              Reprint risk: {reprintRisk(c)}/10
              {c.reserved && " · ⚠ RESERVED LIST"}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TabMarket({ pool }) {
  if (!pool.length) return <Loading />;

  const rows = pool.map(c => ({
    name: c.name,
    demand: demand(c),
    now: priceNow(c) || 0,
    proj: parseFloat((projPrice(c) || 0).toFixed(2)),
    move: parseFloat(((projPrice(c) || 0) / (priceNow(c) || 1) * 100 - 100).toFixed(1)),
    conf: confidence(c),
    c,
  })).sort((a, b) => Math.abs(b.move) - Math.abs(a.move));

  return (
    <>
      <SectionHeader title="Market Movers" />
      <div style={{ overflowX: "auto", marginBottom: 32 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Card</th><th>Demand</th><th>Now</th><th>Proj 90d</th><th>Move %</th><th>Conf</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td>{r.demand}</td>
                <td>{fmt$(r.now)}</td>
                <td>{fmt$(r.proj)}</td>
                <td><span className={r.move >= 0 ? "green" : "red"}>{r.move >= 0 ? "+" : ""}{r.move}%</span></td>
                <td>{r.conf}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SectionHeader title="Demand vs Price" />
      <ScatterPlot data={pool.map(c => ({ x: demand(c), y: priceNow(c) || 0, label: c.name }))} />
    </>
  );
}

function ScatterPlot({ data }) {
  if (!data.length) return null;
  const maxX = Math.max(...data.map(d => d.x), 1);
  const maxY = Math.max(...data.map(d => d.y), 1);
  return (
    <div style={{ position: "relative", background: "var(--surface)", border: "1px solid var(--border)", padding: 12, height: 260 }}>
      {data.map((d, i) => (
        <div
          key={i}
          title={`${d.label}: demand ${d.x}, $${d.y.toFixed(2)}`}
          style={{
            position: "absolute",
            left: `${(d.x / maxX * 88 + 5).toFixed(1)}%`,
            bottom: `${(d.y / maxY * 80 + 5).toFixed(1)}%`,
            width: 6, height: 6,
            borderRadius: "50%",
            background: "var(--gold2)",
            opacity: 0.8,
            cursor: "pointer",
          }}
        />
      ))}
      <div className="mono muted" style={{ position: "absolute", bottom: 4, left: 0, right: 0, textAlign: "center", fontSize: 10 }}>Demand →</div>
      <div className="mono muted" style={{ position: "absolute", top: "50%", left: 4, transform: "rotate(-90deg) translateX(-50%)", fontSize: 10, transformOrigin: "left center" }}>Price →</div>
    </div>
  );
}

const COLOR_MAP = { W: "#f5f0e0", U: "#3a80c8", B: "#7c4ea0", R: "#d44030", G: "#3a8c4a" };

function TabForge() {
  const [colors, setColors] = useState(["R"]);
  const [arch, setArch] = useState("Aggro");
  const [fmt, setFmt] = useState("modern");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const archetypes = ["Aggro", "Tempo", "Control", "Midrange", "Burn", "Ramp", "Combo", "Artifacts"];
  const formats = ["modern", "pioneer", "legacy", "commander", "pauper"];

  const toggleColor = (col) => {
    setColors(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]);
  };

  const forge = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const params = new URLSearchParams({ colors: colors.join(","), arch, fmt });
      const res = await fetch(`/api/forge?${params}`);
      if (!res.ok) { const d = await res.json(); setError(d.error); }
      else setResult(await res.json());
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  const totalValue = result
    ? result.groups.reduce((s, g) => s + g.picks.reduce((ps, [c, q]) => ps + (priceNow(c) || 0) * q, 0), 0)
    : 0;

  return (
    <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20, alignItems: "flex-end" }}>
        <div>
          <div className="mono muted" style={{ fontSize: 10, letterSpacing: 1, marginBottom: 6 }}>COLORS</div>
          <div style={{ display: "flex", gap: 6 }}>
            {Object.entries(COLOR_MAP).map(([col, bg]) => (
              <button
                key={col}
                className={`color-btn${colors.includes(col) ? " selected" : ""}`}
                style={{ background: bg, color: col === "W" ? "#333" : "#fff" }}
                onClick={() => toggleColor(col)}
              >{col}</button>
            ))}
          </div>
        </div>
        <div style={{ minWidth: 140 }}>
          <div className="mono muted" style={{ fontSize: 10, letterSpacing: 1, marginBottom: 6 }}>ARCHETYPE</div>
          <select value={arch} onChange={e => setArch(e.target.value)}>
            {archetypes.map(a => <option key={a}>{a}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 140 }}>
          <div className="mono muted" style={{ fontSize: 10, letterSpacing: 1, marginBottom: 6 }}>FORMAT</div>
          <select value={fmt} onChange={e => setFmt(e.target.value)}>
            {formats.map(f => <option key={f}>{f}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" onClick={forge} disabled={loading || !colors.length}>
          {loading ? <><Spinner /> &nbsp;Forging…</> : "Forge Deck"}
        </button>
      </div>

      {error && <div className="info-box" style={{ borderColor: "var(--red)", color: "var(--red)", marginBottom: 16 }}>{error}</div>}

      {loading && <Loading label="Consulting the Scryfall grimoire…" />}

      {result && (
        <>
          <div className="metrics" style={{ marginBottom: 20 }}>
            <Metric label="Deck Size" value={result.nonland + result.lands} delta={`${result.nonland} spells / ${result.lands} lands`} />
            <Metric label="Est. Spell Value" value={`$${totalValue.toFixed(0)}`} />
            <Metric label="Core Role" value={result.groups[0]?.role || "—"} />
          </div>

          {result.groups.map(({ role: r, picks, cnt }) => (
            <div className="forge-group" key={r}>
              <div className="forge-group-header">
                <span>{r}</span>
                <span className="muted">·</span>
                <span className="muted">{cnt} cards</span>
              </div>
              {picks.map(([c, q]) => (
                <div className="forge-item" key={c.id}>
                  <span><span className="forge-count">{q}×</span> {c.name}</span>
                  <span>
                    <span className="role-badge">{role(c)}</span>
                    &nbsp;&nbsp;
                    <span className="forge-price">{fmt$(priceNow(c))}</span>
                    &nbsp;&nbsp;
                    <span className="gold mono" style={{ fontSize: 10 }}>IMP {importance(c)}</span>
                  </span>
                </div>
              ))}
            </div>
          ))}

          <div className="mono muted" style={{ fontSize: 11, marginTop: 8 }}>
            {result.lands}× lands · color identity: {colors.join("") || "C"}
          </div>
        </>
      )}
    </>
  );
}

function TabDeck() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const analyze = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch(`/api/analyze?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      if (!res.ok) setError(data.error);
      else setResult(data);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  const cards = result?.cards || [];
  const recs  = result?.recs  || [];
  const totalVal = cards.reduce((s, c) => s + (priceNow(c) || 0), 0);
  const avgImp   = cards.length ? Math.round(cards.reduce((s, c) => s + importance(c), 0) / cards.length) : 0;

  // mana curve: count by cmc
  const curveMap = {};
  for (const c of cards) {
    const cmc = Math.min(c.cmc || 0, 7);
    curveMap[cmc] = (curveMap[cmc] || 0) + 1;
  }
  const curveKeys = Array.from({ length: 8 }, (_, i) => i);

  return (
    <>
      <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
        Paste a public Moxfield deck link to score it and get upgrade recommendations.
      </p>
      <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
        <input
          type="text"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === "Enter" && analyze()}
          placeholder="https://www.moxfield.com/decks/…"
        />
        <button className="btn btn-primary" onClick={analyze} disabled={loading || !url.trim()}>
          {loading ? <Spinner /> : "Analyze"}
        </button>
      </div>

      {error && (
        <div className="info-box" style={{ borderColor: "var(--red)", color: "var(--red)", marginBottom: 16 }}>
          {error}
          <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 11 }}>
            Tip: deck must be public. Moxfield may throttle bots — try again in a moment.
          </div>
        </div>
      )}

      {loading && <Loading label="Fetching decklist…" />}

      {result && cards.length > 0 && (
        <>
          <div className="metrics" style={{ marginBottom: 24 }}>
            <Metric label="Cards" value={cards.length} />
            <Metric label="Deck Value" value={`$${totalVal.toFixed(0)}`} />
            <Metric label="Avg Importance" value={avgImp} />
          </div>

          <SectionHeader title="Mana Curve" />
          <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 80, marginBottom: 24 }}>
            {curveKeys.map(cmc => (
              <div key={cmc} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{
                  width: "100%",
                  height: `${((curveMap[cmc] || 0) / Math.max(...Object.values(curveMap), 1) * 60).toFixed(0)}px`,
                  background: "var(--gold2)",
                  borderRadius: "2px 2px 0 0",
                  minHeight: curveMap[cmc] ? 4 : 0,
                  transition: "height .4s",
                }} />
                <div className="mono muted" style={{ fontSize: 10 }}>{cmc}{cmc === 7 ? "+" : ""}</div>
              </div>
            ))}
          </div>

          <SectionHeader title="Co-occurrence Upgrade Suggestions" />
          {recs.map(c => (
            <div className="forge-item" key={c.id} style={{ marginBottom: 4 }}>
              <span>+ {c.name}</span>
              <span>
                <span className="role-badge">{role(c)}</span>
                &nbsp;&nbsp;
                <span className="forge-price">{fmt$(priceNow(c))}</span>
                &nbsp;&nbsp;
                <span className="gold mono" style={{ fontSize: 10 }}>IMP {importance(c)}</span>
              </span>
            </div>
          ))}
          <div className="mono muted" style={{ fontSize: 10, marginTop: 10 }}>
            Ranked by synergy proxy (play volume + flexibility + card advantage). Swap _proxy_cooccur for a real co-occurrence corpus to make it data-driven.
          </div>
        </>
      )}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────
const TABS = ["Terminal", "Card Intel", "Market", "Deck Forge", "Deck Analyzer"];

export default function Home() {
  const [tab, setTab] = useState(0);
  const [pool, setPool] = useState([]);
  const [poolLoading, setPoolLoading] = useState(true);

  useEffect(() => {
    fetch("/api/staples")
      .then(r => r.json())
      .then(d => { setPool(d.cards || []); setPoolLoading(false); })
      .catch(() => setPoolLoading(false));
  }, []);

  return (
    <>
      <Head>
        <title>MANALORE Terminal</title>
        <meta name="description" content="The Bloomberg terminal of Magic: The Gathering" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>✦</text></svg>" />
      </Head>

      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 20px" }}>
        {/* Header */}
        <header style={{ padding: "28px 0 20px", borderBottom: "1px solid var(--border)", marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
            <h1 style={{ fontFamily: "'Marcellus', serif", fontSize: 28, color: "var(--gold)", letterSpacing: 4 }}>
              ✦ MANALORE
            </h1>
            <span className="mono muted" style={{ fontSize: 11, letterSpacing: 2 }}>
              ACADEMY OF CARD MASTERY &nbsp;·&nbsp; LIVE MARKET DATA
            </span>
          </div>
          {poolLoading && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
              <Spinner />
              <span className="mono muted" style={{ fontSize: 11 }}>Summoning live card data from Scryfall…</span>
            </div>
          )}
        </header>

        {/* Tabs */}
        <div className="tabs">
          {TABS.map((t, i) => (
            <button key={t} className={`tab-btn${tab === i ? " active" : ""}`} onClick={() => setTab(i)}>
              {t}
            </button>
          ))}
        </div>

        {/* Tab panels */}
        {tab === 0 && <TabTerminal pool={pool} />}
        {tab === 1 && <TabCardIntel pool={pool} />}
        {tab === 2 && <TabMarket pool={pool} />}
        {tab === 3 && <TabForge />}
        {tab === 4 && <TabDeck />}

        {/* Footer */}
        <footer style={{ marginTop: 48, paddingTop: 16, borderTop: "1px solid var(--border)", paddingBottom: 32 }}>
          <p className="mono muted" style={{ fontSize: 11 }}>
            Prices are aggregated market values from Scryfall, not a brokerage quote.
            Projections are model output for analysis only — not financial advice.
          </p>
        </footer>
      </div>
    </>
  );
}
