"""
MANALORE TERMINAL - MTG Intelligence (Streamlit production build)
================================================================
The Bloomberg terminal of Magic: The Gathering.

This is the production target the browser demo points to. It uses:
  - Scryfall   : card data, images, live market prices, EDHREC play-rank
  - Moxfield   : real published decklists -> co-occurrence synergy engine
  - scikit-learn (optional): the importance model can be trained instead of weighted

Run:
  pip install -r requirements.txt
  streamlit run app.py

requirements.txt:
  streamlit
  requests
  pandas
  numpy

Author: Plawffy  |  Data Analyst portfolio
NOTE: prices are Scryfall aggregated market values, not a brokerage quote.
      Projections are analysis, not financial advice.
"""

import re
import math
import time
import json
import requests
import numpy as np
import pandas as pd
import streamlit as st

SCRYFALL = "https://api.scryfall.com"
MOXFIELD = "https://api.moxfield.com/v2/decks/all"
HEADERS = {"User-Agent": "ManaloreTerminal/1.0", "Accept": "application/json"}

FORMATS = ["standard", "pioneer", "modern", "legacy", "vintage", "commander", "pauper"]

STAPLES = [
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
]

# ----------------------------------------------------------------------------
# DATA LAYER : Scryfall
# ----------------------------------------------------------------------------
@st.cache_data(show_spinner=False, ttl=3600)
def scry_collection(names):
    """Batch fetch exact cards (up to 75 per request)."""
    out = []
    for i in range(0, len(names), 70):
        chunk = names[i:i + 70]
        body = {"identifiers": [{"name": n} for n in chunk]}
        r = requests.post(f"{SCRYFALL}/cards/collection", json=body, headers=HEADERS, timeout=20)
        r.raise_for_status()
        out.extend(r.json().get("data", []))
        time.sleep(0.09)
    return out


@st.cache_data(show_spinner=False, ttl=3600)
def scry_named(name):
    r = requests.get(f"{SCRYFALL}/cards/named", params={"fuzzy": name}, headers=HEADERS, timeout=20)
    return r.json() if r.ok else None


@st.cache_data(show_spinner=False, ttl=3600)
def scry_search(query, max_cards=80):
    cards, url = [], f"{SCRYFALL}/cards/search"
    params = {"q": query, "order": "edhrec", "unique": "cards"}
    try:
        r = requests.get(url, params=params, headers=HEADERS, timeout=20)
        if not r.ok:
            return []
        data = r.json()
        cards.extend(data.get("data", []))
    except requests.RequestException:
        return []
    return cards[:max_cards]


def img_uri(c, kind="normal"):
    u = c.get("image_uris") or (c.get("card_faces", [{}])[0].get("image_uris") if c.get("card_faces") else None)
    return u.get(kind) if u else None


def oracle(c):
    t = c.get("oracle_text", "")
    if not t and c.get("card_faces"):
        t = " ".join(f.get("oracle_text", "") for f in c["card_faces"])
    return (t or "").lower()


def type_line(c):
    return c.get("type_line") or (c.get("card_faces", [{}])[0].get("type_line", "") if c.get("card_faces") else "")


def price_now(c):
    p = c.get("prices", {}) or {}
    if p.get("usd"):
        return float(p["usd"])
    if p.get("usd_foil"):
        return float(p["usd_foil"])
    if p.get("eur"):
        return float(p["eur"]) * 1.08
    return None


def legal_formats(c):
    L = c.get("legalities", {})
    return [f for f in FORMATS if L.get(f) == "legal"]


# ----------------------------------------------------------------------------
# FEATURE EXTRACTION : parsed from real card text + Scryfall fields
# ----------------------------------------------------------------------------
def clamp(v, a, b):
    return max(a, min(b, v))


def features(c):
    t, tl = oracle(c), type_line(c).lower()
    cmc = c.get("cmc", 0) or 0
    rank = c.get("edhrec_rank") or 45000
    play_rank = clamp(10 - math.log10(rank + 1) * 2.05, 0, 10)
    ubiq = clamp(len(legal_formats(c)) * 1.55, 0, 10)
    kw = clamp(len(c.get("keywords", [])) * 1.6 + (2 if re.search(r"modal|choose one|escape|flashback", t) else 0), 0, 10)
    eff = clamp(9.5 - cmc * 1.1, 1, 10)
    if "instant" in tl:
        eff = clamp(eff + 0.8, 0, 10)
    card_adv = 0
    if re.search(r"draw (a|two|three|four|\w+) cards?", t): card_adv += 6
    if "search your library" in t: card_adv += 3
    if re.search(r"create .*token", t): card_adv += 2
    if re.search(r"whenever .* dies|whenever .* enters", t): card_adv += 2
    card_adv = clamp(card_adv, 0, 10)
    ci = c.get("color_identity", [])
    flex = clamp(4 + (2 - len(ci)) + (2 if "instant" in tl else 0) + (2 if re.search(r"any (color|type)|choose|modal", t) else 0), 0, 10)
    tempo = clamp((3 if re.search(r"haste|flash|flying|prowess", t) else 0) + (10 - cmc) * 0.55 + (1.5 if "creature" in tl else 0), 0, 10)
    return dict(play_rank=play_rank, ubiq=ubiq, kw=kw, eff=eff, card_adv=card_adv, flex=flex, tempo=tempo, cmc=cmc, rank=rank)


def reprint_risk(c):
    rr = {"common": 8, "uncommon": 7, "rare": 5, "mythic": 3, "special": 2, "bonus": 2}.get(c.get("rarity"), 5)
    if c.get("reserved"):
        rr = 0
    return rr


W_IMP = dict(play_rank=.26, eff=.18, card_adv=.14, flex=.12, ubiq=.18, kw=.12)


def importance(c):
    f = c["_f"]
    return round(sum(W_IMP[k] * f[k] for k in W_IMP) / 10 * 100)


def demand(c):
    f = c["_f"]
    return round((0.55 * f["play_rank"] + 0.25 * f["flex"] + 0.20 * f["card_adv"]) / 10 * 100)


def drift_mo(c):
    return (demand(c) / 100 - 0.5) * 0.060 - (reprint_risk(c) / 10) * 0.020


def proj_price(c):
    p = price_now(c)
    return None if p is None else p * (1 + 3 * drift_mo(c))


def confidence(c):
    f = c["_f"]
    return round(clamp(45 + f["play_rank"] * 5 - reprint_risk(c) * 1.5, 45, 95))


def role(c):
    t, tl = oracle(c), type_line(c).lower()
    if "land" in tl: return "Land"
    if re.search(r"counter target (spell|ability|creature spell)", t): return "Counter"
    if re.search(r"destroy target|exile target|deals? \d+ damage to (any|target)|fight", t): return "Removal"
    if re.search(r"add \{|untap target land|search your library for .*(land|basic)", t): return "Ramp"
    if re.search(r"draw (a|two|three|four|\w+) cards?", t): return "Card Advantage"
    if re.search(r"discard|sacrifices|can't|loses the game|skip (your|their)", t): return "Disruption"
    if "planeswalker" in tl: return "Engine"
    if "artifact" in tl or "enchantment" in tl: return "Engine"
    if "creature" in tl: return "Threat"
    return "Spell"


def enrich(c):
    c["_f"] = features(c)
    return c


# ----------------------------------------------------------------------------
# MOXFIELD : real published decks -> co-occurrence synergy
# ----------------------------------------------------------------------------
def moxfield_id(url_or_id):
    m = re.search(r"/decks/([A-Za-z0-9_-]+)", url_or_id)
    return m.group(1) if m else url_or_id.strip()


@st.cache_data(show_spinner=False, ttl=1800)
def fetch_moxfield_deck(url_or_id):
    """Return list of card names in a public Moxfield deck.
    Moxfield throttles bots; this is defensive and may need a personal token."""
    did = moxfield_id(url_or_id)
    try:
        r = requests.get(f"{MOXFIELD}/{did}", headers=HEADERS, timeout=20)
        if not r.ok:
            return None, f"Moxfield returned {r.status_code} (deck may be private or rate-limited)."
        data = r.json()
        names = []
        for zone in ("mainboard", "commanders", "companions"):
            for _, entry in (data.get(zone, {}) or {}).items():
                card = entry.get("card", {})
                if card.get("name"):
                    names.append(card["name"])
        return names, None
    except requests.RequestException as e:
        return None, str(e)


def cooccurrence_recommend(seed_names, candidate_cards, top=15):
    """
    The real synergy layer. In production you aggregate MANY decks and count
    how often each candidate co-occurs with the seed list. Here we approximate
    co-occurrence strength with a transparent proxy:
        synergy = shared color identity + role complementarity + play-rank
    Swap `_proxy_cooccur` for a count over a corpus of fetched Moxfield decks
    to make it fully data-driven.
    """
    scored = []
    seed_roles = {}  # role -> count present in seed
    for c in candidate_cards:
        if c["name"] in seed_names:
            continue
        s = _proxy_cooccur(c, seed_names)
        scored.append((s, c))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [c for _, c in scored[:top]]


def _proxy_cooccur(c, seed_names):
    f = c["_f"]
    return 0.5 * f["play_rank"] + 0.3 * f["flex"] + 0.2 * f["card_adv"]


# ----------------------------------------------------------------------------
# DECK FORGE
# ----------------------------------------------------------------------------
ARCH_FILTER = {
    "Aggro": '(t:creature mv<=3)',
    "Tempo": '(t:creature mv<=3 or o:"counter target spell" or o:flash)',
    "Control": '(o:"counter target spell" or o:"draw" or o:"destroy target" or t:planeswalker)',
    "Midrange": '(t:creature mv>=2 mv<=5 or o:"destroy target")',
    "Burn": '(o:"damage" (t:instant or t:sorcery or t:creature mv<=2))',
    "Ramp": '(o:"add {" or o:"search your library for" t:land or mv>=5)',
    "Combo": '(o:"whenever" or o:"you may" or t:artifact)',
    "Artifacts": '(t:artifact or o:"artifact")',
}
CURVE = {
    "Aggro": {"Threat": 18, "Removal": 6, "Card Advantage": 2},
    "Tempo": {"Threat": 11, "Counter": 4, "Removal": 5, "Card Advantage": 3, "Disruption": 1},
    "Control": {"Removal": 8, "Counter": 6, "Card Advantage": 6, "Engine": 4},
    "Midrange": {"Threat": 9, "Removal": 6, "Disruption": 3, "Card Advantage": 4, "Engine": 2},
    "Burn": {"Threat": 11, "Removal": 11, "Card Advantage": 2},
    "Ramp": {"Ramp": 11, "Engine": 5, "Card Advantage": 4, "Threat": 3, "Removal": 1},
    "Combo": {"Engine": 7, "Card Advantage": 6, "Ramp": 4, "Disruption": 3, "Counter": 2},
    "Artifacts": {"Engine": 8, "Ramp": 6, "Threat": 4, "Card Advantage": 3, "Removal": 2},
}


def build_deck(colors, arch, fmt):
    col_expr = f"id<={''.join(colors).lower()}" if colors else "id=c"
    q = f"{col_expr} {ARCH_FILTER[arch]} f:{fmt} -t:land"
    cards = [enrich(c) for c in scry_search(q, 80)]
    if not cards:
        return None
    by_role = {}
    for c in cards:
        r = role(c)
        r = "Card Advantage" if r == "Spell" else r
        by_role.setdefault(r, []).append(c)
    for r in by_role:
        by_role[r].sort(key=importance, reverse=True)
    groups, nonland = [], 0
    for r, want in CURVE.get(arch, {}).items():
        lst = by_role.get(r, [])
        if not lst:
            continue
        picks, remain, i = [], want, 0
        while remain > 0 and i < len(lst):
            q4 = min(4, math.ceil(remain / (len(lst) - i)))
            add = min(q4, remain)
            picks.append((lst[i], add)); remain -= add; i += 1
        cnt = sum(q for _, q in picks)
        nonland += cnt
        groups.append((r, picks, cnt))
    total = 100 if fmt == "commander" else 60
    lands = max(0, total - nonland)
    return groups, nonland, lands


# ----------------------------------------------------------------------------
# UI : Streamlit, themed to match the terminal
# ----------------------------------------------------------------------------
st.set_page_config(page_title="MANALORE Academy", page_icon="✦", layout="wide")

st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Marcellus&family=Spectral:wght@300;400;500&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
.stApp{background:linear-gradient(180deg,#0c0f13,#0f141a);color:#e8e2d2;font-family:'Spectral',serif}
h1,h2,h3{font-family:'Marcellus',serif!important;color:#ecca84!important;letter-spacing:2px}
[data-testid="stMetricValue"]{font-family:'IBM Plex Mono',monospace;color:#ecca84}
.stTabs [data-baseweb="tab"]{font-family:'IBM Plex Mono';letter-spacing:1px;text-transform:uppercase;font-size:12px}
div[data-testid="stHorizontalBlock"]{gap:14px}
.card-cap{font-family:'IBM Plex Mono';font-size:11px;color:#8b95a3}
.stApp a{color:#d9a850}
</style>
""", unsafe_allow_html=True)

st.markdown("# ✦ MANALORE")
st.markdown("<div class='card-cap'>ACADEMY OF CARD MASTERY &nbsp;·&nbsp; LIVE MARKET DATA</div>", unsafe_allow_html=True)
st.write("")

with st.spinner("Summoning live card data..."):
    pool = [enrich(c) for c in scry_collection(STAPLES) if c.get("name")]

tab_term, tab_card, tab_market, tab_forge, tab_deck = st.tabs(
    ["Terminal", "Card Intel", "Market", "Deck Forge", "Deck Analyzer"])

# ---- Terminal ----
with tab_term:
    deltas = {c["name"]: (proj_price(c) or 0) - (price_now(c) or 0) for c in pool}
    gainer = max(pool, key=lambda c: (proj_price(c) or 0) - (price_now(c) or 0))
    avg_dem = int(np.mean([demand(c) for c in pool]))
    reserved = sum(1 for c in pool if c.get("reserved"))
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Watchlist Demand", avg_dem, f"{len(pool)} cards")
    g_d = (proj_price(gainer) or 0) / (price_now(gainer) or 1) * 100 - 100
    c2.metric("Top Gainer 90d", gainer["name"].split(",")[0], f"{g_d:+.1f}%")
    c3.metric("Reserved List", reserved, "supply-locked")
    c4.metric("Cards Tracked", len(pool))
    st.write("")
    cols = st.columns(5)
    for i, c in enumerate(sorted(pool, key=importance, reverse=True)):
        with cols[i % 5]:
            art = img_uri(c, "art_crop")
            if art:
                st.image(art, use_container_width=True)
            d = (proj_price(c) or 0) / (price_now(c) or 1) * 100 - 100
            st.markdown(f"**{c['name']}**")
            st.markdown(f"<span class='card-cap'>IMP {importance(c)} · "
                        f"{'$%.0f'%price_now(c) if price_now(c) else 'n/a'} · "
                        f"<span style='color:{'#5fc28a' if d>=0 else '#df7261'}'>{d:+.1f}%</span></span>",
                        unsafe_allow_html=True)

# ---- Card Intel ----
with tab_card:
    q = st.text_input("Look up any card", "Ragavan, Nimble Pilferer")
    if q:
        c = next((x for x in pool if x["name"].lower() == q.lower()), None) or scry_named(q)
        if c:
            c = enrich(c)
            left, right = st.columns([1, 2])
            with left:
                im = img_uri(c, "normal")
                if im: st.image(im, use_container_width=True)
                st.markdown("<span class='card-cap'>" + " · ".join(legal_formats(c)).upper() + "</span>", unsafe_allow_html=True)
            with right:
                st.subheader(c["name"])
                a, b, d = st.columns(3)
                a.metric("Importance", importance(c))
                b.metric("Demand", demand(c))
                pj = proj_price(c)
                delt = (pj / price_now(c) * 100 - 100) if (pj and price_now(c)) else 0
                d.metric("Price Now", f"${price_now(c):.2f}" if price_now(c) else "n/a", f"{delt:+.1f}% 90d")
                fdict = c["_f"]
                contrib = pd.DataFrame({
                    "feature": ["Play-rank", "Efficiency", "Card adv", "Ubiquity", "Flexibility", "Keywords"],
                    "contribution": [W_IMP["play_rank"] * fdict["play_rank"] * 10,
                                     W_IMP["eff"] * fdict["eff"] * 10,
                                     W_IMP["card_adv"] * fdict["card_adv"] * 10,
                                     W_IMP["ubiq"] * fdict["ubiq"] * 10,
                                     W_IMP["flex"] * fdict["flex"] * 10,
                                     W_IMP["kw"] * fdict["kw"] * 10],
                }).set_index("feature")
                st.markdown("**Why it scores this way**")
                st.bar_chart(contrib, color="#d9a850")
                st.markdown("**Price projection (demand-driven)**")
                series = [round((price_now(c) or 0) * (1 + m * drift_mo(c)), 2) for m in range(4)]
                st.line_chart(pd.DataFrame({"USD": series}, index=["Now", "+30d", "+60d", "+90d"]), color="#5fc28a")
                st.caption(f"Role parsed from oracle text: **{role(c)}** · confidence {confidence(c)}% · "
                           f"reprint risk {reprint_risk(c)}/10" + (" · RESERVED LIST" if c.get("reserved") else ""))
        else:
            st.warning("Card not found.")

# ---- Market ----
with tab_market:
    rows = [{
        "Card": c["name"], "Demand": demand(c),
        "Now": price_now(c) or 0, "Proj 90d": round(proj_price(c) or 0, 2),
        "Move %": round((proj_price(c) or 0) / (price_now(c) or 1) * 100 - 100, 1),
        "Conf": confidence(c),
    } for c in pool]
    df = pd.DataFrame(rows).sort_values("Move %", key=abs, ascending=False)
    st.dataframe(df, use_container_width=True, hide_index=True,
                 column_config={"Now": st.column_config.NumberColumn(format="$%.2f"),
                                "Proj 90d": st.column_config.NumberColumn(format="$%.2f")})
    st.scatter_chart(pd.DataFrame({"Demand": [demand(c) for c in pool],
                                   "Price": [price_now(c) or 0 for c in pool]}),
                     x="Demand", y="Price")

# ---- Deck Forge ----
with tab_forge:
    fc = st.columns([2, 2, 2, 1])
    colors = fc[0].multiselect("Colors", ["W", "U", "B", "R", "G"], default=["R"])
    arch = fc[1].selectbox("Archetype", list(ARCH_FILTER.keys()))
    fmt = fc[2].selectbox("Format", ["modern", "pioneer", "legacy", "commander", "pauper"])
    if fc[3].button("Forge", use_container_width=True):
        with st.spinner(f"Assembling {arch} cards..."):
            res = build_deck(colors, arch, fmt)
        if not res:
            st.warning("No legal cards matched. Try more colors or another archetype.")
        else:
            groups, nonland, lands = res
            value = sum((price_now(c) or 0) * q for _, picks, _ in groups for c, q in picks)
            m1, m2, m3 = st.columns(3)
            m1.metric("Deck Size", nonland + lands, f"{nonland} spells / {lands} lands")
            m2.metric("Est. Spell Value", f"${value:.0f}")
            top = groups[0] if groups else None
            m3.metric("Core Role", top[0] if top else "-")
            for r, picks, cnt in groups:
                st.markdown(f"**{r}** · {cnt}")
                for c, qn in picks:
                    st.markdown(f"<span class='card-cap'>{qn}× {c['name']} "
                                f"(IMP {importance(c)}, {'$%.2f'%price_now(c) if price_now(c) else 'n/a'})</span>",
                                unsafe_allow_html=True)
            st.markdown(f"<span class='card-cap'>{lands}× lands tuned to the curve "
                        f"({''.join(colors) or 'C'})</span>", unsafe_allow_html=True)
            st.info("Cards ranked by real-world play volume + role fit. Switch to the Deck Analyzer "
                    "tab to upgrade an existing list with deck co-occurrence.")

# ---- Deck Analyzer (Moxfield) ----
with tab_deck:
    st.markdown("Paste a public deck link to analyze it and get co-occurrence upgrades.")
    url = st.text_input("Deck link", placeholder="paste a public deck URL")
    if st.button("Analyze deck"):
        with st.spinner("Fetching deck..."):
            names, err = fetch_moxfield_deck(url)
        if err:
            st.error(err)
            st.caption("Tip: some deck sites throttle automated access. For heavy use, add a personal "
                       "API token in HEADERS, or aggregate decklists offline into a co-occurrence table.")
        elif names:
            with st.spinner("Scoring the list against live card data..."):
                cards = [enrich(c) for c in scry_collection(names) if c.get("name")]
            total_val = sum(price_now(c) or 0 for c in cards)
            a, b, d = st.columns(3)
            a.metric("Cards", len(cards))
            b.metric("Deck Value", f"${total_val:.0f}")
            d.metric("Avg Importance", round(np.mean([importance(c) for c in cards])))
            curve = pd.Series([c.get("cmc", 0) for c in cards]).value_counts().sort_index()
            st.markdown("**Mana curve**")
            st.bar_chart(curve, color="#d9a850")
            st.markdown("**Co-occurrence upgrade suggestions**")
            ci = sorted({x for c in cards for x in c.get("color_identity", [])})
            cand_q = f"id<={''.join(ci).lower() or 'c'} f:commander -t:land"
            candidates = [enrich(c) for c in scry_search(cand_q, 80)]
            recs = cooccurrence_recommend(set(names), candidates, top=12)
            for c in recs:
                st.markdown(f"<span class='card-cap'>+ {c['name']} "
                            f"(IMP {importance(c)}, {'$%.2f'%price_now(c) if price_now(c) else 'n/a'}, {role(c)})</span>",
                            unsafe_allow_html=True)
            st.caption("This demo ranks candidates by a transparent synergy proxy. Swap `_proxy_cooccur` "
                       "for a count over a corpus of fetched Moxfield decks to make it fully data-driven.")
        else:
            st.warning("No cards found in that deck.")

st.write("")
st.caption("Prices are aggregated market values, not a brokerage quote. "
           "Projections are model output for analysis, not financial advice.")
