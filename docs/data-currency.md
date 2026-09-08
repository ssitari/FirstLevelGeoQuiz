# Data currency & political-geography checklist

The quiz ships Natural Earth 1:10m Admin 1 (lakes variant). NE's subdivision set
is not always current, and it embeds editorial choices about disputed territory.
This is a project authored in the US about the whole world's internal borders, so
getting this right matters. This file tracks the work; nothing here is done until
its row cites a source.

**Method rule:** every fix pulls geometry/names from a citable source (a national
mapping agency's open data, geoBoundaries, OpenStreetMap, or an official gazette).
Do not hand-key boundaries or counts from memory.

---

## 1. Stale subdivisions

Candidates surfaced by comparing NE's admin-1 count to ISO 3166-2 (see
`province_counts.csv` in this folder). ISO 3166-2 is a cross-check, not ground
truth — it sometimes counts a different level. Confirm each against a primary source before
patching.

| Country | NE has | Now using | Change | Status |
|---|---|---|---|---|
| Kenya | 8 provinces | **47 counties** | 2010 constitution / 2013 elections | ✅ patched → geoBoundaries |
| Nepal | 14 zones (*anchal*) | **7 provinces** | 2015 constitution (Province 1→Koshi, 2→Madhesh renamed 2022–23) | ✅ patched → geoBoundaries |
| DR Congo | 11 provinces | **26 provinces** | 2006 constitution, implemented 2015 | ✅ patched → geoBoundaries |
| Morocco | 16 regions | **10 regions** | 2015 reform; Western Sahara's 2 regions excluded (see §2) | ✅ patched → geoBoundaries |
| Palestine | NE "West Bank" + "Gaza Strip", sovereignty → Israel | **16 governorates**, country = Palestine | deliberate editorial call, stronger than NE (see §2) | ✅ patched → geoBoundaries |
| Algeria | 48 wilayas | 48 wilayas | 10 added 2019 — geoBoundaries still at 48, no clean source yet | ☐ open |
| Tanzania | 30 regions | 30 | Songwe added 2016 | ☐ open |
| Myanmar | 15 | 15 | ~ok (Naypyidaw included) | ☐ spot-check |
| Macedonia | 84 (statistical regions + municipalities mixed) | 84 | NE's set is internally inconsistent; 15 units carry no `region` value | ☐ open — decide level |
| Azerbaijan | 78 districts | 78 | NE's `region` groups them into 10 economic regions, one being Kalbajar-Lachin — a rollup would bake in a Nagorno-Karabakh position | ☐ open — political, not just level |

---

## 1b. Wrong *level*: Natural Earth ships a tier below the country's first level

Distinct from staleness above: for these, NE's data isn't out of date, it's a
different (deeper) administrative tier. NE's UK is 232 districts and boroughs;
its Italy is 110 provinces. A silhouette of Waltham Forest is not the game.

Each is dissolved on one of **Natural Earth's own grouping fields** (`ROLLUPS` in
`build.py`), so no outside data is introduced and no names are hand-keyed — the
field value becomes the unit name verbatim. All eight have 100% field coverage
(no unit lacks a value), which the build asserts before dissolving.

| ISO | NE ships | Rolled up to | NE field | Status |
|---|---|---|---|---|
| GBR | 232 districts / boroughs / council areas | **4** — England, Scotland, Wales, Northern Ireland | `geonunit` | ✅ |
| FRA | 101 departments | **18 régions** | `region` | ✅ |
| ITA | 110 provinces | **20 regions** | `region` | ✅ |
| PHL | 118 provinces + highly-urbanized cities (mixed) | **17 administrative regions** | `region` | ✅ |
| SVN | 193 municipalities | **12 statistical regions** | `region` | ✅ |
| LVA | 119 municipalities | **5 historical regions** | `region` | ✅ judgement call |
| MLT | 68 local councils | **3 regions** | `region` | ✅ judgement call |
| UGA | 112 districts / counties | **4 regions** | `region` | ✅ judgement call |

**The three judgement calls.** Latvia's actual first level is its 43 municipalities
(2021 reform); the 5 historical regions are not an administrative tier, but they
are the units a quiz can meaningfully ask. Malta has no real admin-1 at all.
Uganda's regions are a statistical grouping over districts. In each case the
alternative was a pool of 60–190 units nobody can name from an outline. Reverse
any of them by deleting a row from `ROLLUPS` and re-running the build.

**Known gap:** rolled-up units carry no alternate names, so Italy answers only to
`Apulia` / `Sicily` / `Lombardia` as NE spells them, not `Puglia` / `Sicilia` /
`Lombardy`. Needs an alt-name source before this goes public. ☐ open

### Sources for the patched four (geoBoundaries gbHumanitarian ADM1, CC BY 3.0 IGO, pinned release `9469f09`)

| ISO | Level used | geoBoundaries year | Upstream source |
|---|---|---|---|
| KEN | ADM1 | 2018 | HDX / OCHA COD-AB Kenya |
| NPL | ADM1 | 2020 | HDX — Survey Department of Nepal |
| COD | ADM1 | 2019 | HDX / OCHA COD-AB DR Congo |
| MAR | ADM1 | 2020 | HDX / OCHA COD-AB Morocco |
| PSE | **ADM2** | 2021 | HDX / OCHA oPt COD-AB (geoBoundaries treats West Bank & Gaza as its ADM1) |

Cite: Runfola et al. (2020), *geoBoundaries: A global database of political administrative boundaries*, PLoS ONE 15(4): e0231866.

Add rows as they turn up. Anything with `delta_ne_minus_iso` beyond ±50% in the
CSV deserves a look.

### How a patch is integrated (done — this is how it works now)

`OVERRIDES` at the top of `build.py` maps `adm0_a3` → `{type, note, rename?}`.
`fetch.py` pulls each country's geoBoundaries ADM1 GeoJSON to
`scripts/cache/overrides/<A3>.geojson`. In `build.py`, NE's units for an
overridden country are skipped and the geoBoundaries features are fed through the
exact same enrich pipeline (city point-in-polygon, prominence, distinctiveness,
per-feature simplify). `rename` fixes stale or de-diacriticked names and keeps
the originals as accepted alternates. To add a country: add its ISO3 to
`GB_ISOS` in `fetch.py` and a row to `OVERRIDES`, re-run both scripts.

---

## 2. Disputed / contested territory

NE carries per-viewpoint fields (`FCLASS_ISO`, `FCLASS_US`, `FCLASS_RU`, …). The
build currently ignores them and ingests everything at face value. Decide a
consistent line, apply it via those fields, and state it plainly in the README.

Proposed default: **`FCLASS_ISO`** (the UN/ISO membership view) where it exists,
and exclude first-level units the quiz can't attribute cleanly rather than pick a
side.

| Territory | NE's current treatment | Decision | Notes |
|---|---|---|---|
| Western Sahara | separate `SAH` unit "Western Sahara"; 2 Moroccan regions flagged `FCLASS_ISO=Unrecognized` | ✅ resolved | Morocco override = the 10 regions in undisputed territory; WS stays its own single unit, not attributed to Morocco |
| Palestine / West Bank / Gaza | NE: two units "West Bank" & "Gaza Strip", `sov_a3 = ISR` | ✅ resolved (deliberate) | Promoted to country "Palestine" (NE's own 50m admin-0 name for `PSX`); first-level = the 16 governorates. This is a stronger position than Natural Earth takes, chosen on purpose. Jerusalem governorate included as one of the 16. |
| Crimea, Sevastopol | NE assigns both to **Russia** (`adm0_a3 = RUS`) | ✅ held out | The hint ladder would have said "Country: Russia", which is not the UN/ISO view. Excluded rather than reattributed — reattributing is also a position. |
| Kashmir (J&K, Ladakh, Azad Kashmir, Northern Areas) | J&K + Ladakh to India; Azad Kashmir + Northern Areas (Gilgit-Baltistan) to Pakistan | ✅ held out | No clean UN/ISO attribution for any of the four. Aksai Chin is not a separate NE unit (it falls inside Xinjiang / Tibet) so it is untouched — ☐ still open. |
| Siachen Glacier | NE ships it as a one-unit "country" (`KAS`) | ✅ held out | Caught by the single-unit rule, not by name. |
| West Bank, Gaza | replaced by the 16 governorates of Palestine | ✅ resolved | See §1. |
| Taiwan | own country, 21 units, `admin = Taiwan` | ✅ kept | NE attributes them to Taiwan, not to China; the hint says "Country: Taiwan". |
| Kosovo | own country, 30 municipalities | ✅ kept | NE gives Kosovo its own `adm0_a3`. Level is arguably too deep — ☐ candidate for §1b. |
| Abkhazia | NE assigns to **Georgia** | ✅ kept | Matches the UN/ISO view, so the country hint asserts nothing unusual. South Ossetia is not a separate NE unit (it sits inside Shida Kartli). |
| Northern Cyprus, Somaliland, Western Sahara | one-unit "countries" in NE | ✅ held out | Caught by the single-unit rule. The quiz never has to name their sovereign. |
| Nagorno-Karabakh (Kəlbəcər, Qubadli, Zəngilan…) | NE assigns to **Azerbaijan** as ordinary districts | ☐ open | Currently playable. Matches ISO 3166-2:AZ, but see the Azerbaijan row in §1. |
| Antarctic claims | one "Antarctica" unit | ✅ held out | Single-unit rule. |

### How a unit is held out

`EXCLUDE_UNITS` in `build.py` is a set of `(adm0_a3, NE name)` pairs, and the build
**fails** if any entry stops matching — so a Natural Earth rename cannot silently
put a contested unit back into play. Separately, any country with a single admin-1
unit is held out automatically: it isn't subdivided, so its "unit" is the country
outline, which is a different game. That structural rule is what removes
Somaliland, Northern Cyprus, Western Sahara, Siachen Glacier, Antarctica, Baykonur,
the sovereign base areas and the uninhabited-island entries, without anyone having
to take a position on any of them.

Held-out units stay in `admin1.topojson` and are still drawn as neighbours on the
reveal map — they carry `playable: false` and are filtered out of every question
pool and out of the autocomplete. 43 of 3,654 units are held out (37 single-unit
countries + 6 contested).

Note: `FCLASS_ISO` is only populated on those 2 Moroccan regions in the NE admin-1
layer — it is **not** a general contested-unit flag. The other rows need
per-country judgement (which `adm0`/`admin` NE assigns them to).

For anything included: does the hint ladder ("Country: X") state something the
project is comfortable asserting? If not, exclude the unit from the pool (a
`playable: false` flag) rather than ship a contested claim as a quiz answer.

---

## 3. Names

- Prefer the unit's **official / local name** as the primary answer.
- Accept a widely-used **English exonym** as an alternate (already done via
  `alt`), and show it as the parenthetical on the reveal — fix the current bug
  where the parenthetical sometimes shows a parent region instead.
- Do **not** quiz on contested names (e.g. bodies of water, or units whose name
  itself is disputed). Where a name is contested, either use the UN/ISO form or
  set `playable: false`.
- Transliteration: keep NE's Latin-script name but make matching
  diacritic- and romanization-insensitive (already done in `norm()`); spot-check
  Arabic, Cyrillic, CJK, and Thai units.

---

## 4. Done

- **2026-09-07** — Kenya, Nepal, DR Congo, Morocco swapped from stale Natural
  Earth admin-1 to geoBoundaries gbHumanitarian ADM1 (CC BY 3.0 IGO). Nepal's
  numbered provinces renamed Koshi / Madhesh. Morocco = the 10 regions in
  undisputed territory (Western Sahara left as its own unit). Mechanism:
  `OVERRIDES` in `build.py` + `GB_LAYERS` in `fetch.py`.
- **2026-09-07** — Palestine promoted to a country (`PSX` → "Palestine"); its 16
  governorates (geoBoundaries PSE **ADM2**, CC BY 3.0 IGO, OCHA oPt COD-AB 2021)
  replace NE's two Israeli-sovereign "West Bank" / "Gaza Strip" units. Deliberate,
  stated in the README. Cross-checks: ISO 3166-2:PS and PCBS both use these 16.
- **2026-09-07** — Eight countries rolled up to their real first level (§1b):
  GBR, FRA, ITA, PHL, SVN, LVA, MLT, UGA. 4,624 → 3,654 units. Dissolved on
  Natural Earth's own `geonunit` / `region` fields; no outside data introduced.
- **2026-09-07** — `playable` flag added (§2). Crimea, Sevastopol and the four
  Kashmir units held out explicitly; every single-unit "country" held out
  structurally. 43 units held out, all still drawn as map context.
