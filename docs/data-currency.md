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

Candidates surfaced by comparing NE's admin-1 count to ISO 3166-2 (see the
`province_counts.csv` audit (in this folder)). ISO 3166-2 is a cross-check, not ground truth — it
sometimes counts a different level. Confirm each against a primary source before
patching.

| Country | NE has | Believed current | Change | Source (fill in) | Status |
|---|---|---|---|---|---|
| Kenya | 8 provinces | 47 counties | 2010 constitution / 2013 elections | | ☐ verify ☐ patch |
| Nepal | 14 zones (*anchal*) | 7 provinces | 2015 constitution | | ☐ verify ☐ patch |
| DR Congo | 11 provinces | 26 provinces | 2006 constitution, implemented 2015 | | ☐ verify ☐ patch |
| Morocco | 16 regions | 12 regions | 2015 territorial reform | | ☐ verify ☐ patch |
| Algeria | 48 wilayas | 58 wilayas | 10 added 2019 | | ☐ verify ☐ patch |
| Uganda | ~112 "counties" | 100+ districts | ongoing district creation | | ☐ verify ☐ decide level |
| Tanzania | 30 regions | 31 regions | Songwe added 2016 | | ☐ verify ☐ patch |
| France | 96 metro departments | 13 metro regions | NE models departments, not regions | | ☐ decide which level |
| Myanmar | 14 (states/regions) | 15 (Naypyidaw Union Territory) | | | ☐ verify |
| Philippines | mixed set incl. HUCs | 17 regions / 82 provinces | NE's set is inconsistent | | ☐ decide level |

Add rows as they turn up. Anything with `delta_ne_minus_iso` beyond ±50% in the
CSV deserves a look.

### How a patch is integrated

`build.py` reads `scripts/cache/ne_10m_admin_1_states_provinces_lakes.geojson`.
Add an override step: for a country in an `OVERRIDES` map, drop NE's features for
that `adm0_a3` and substitute the replacement GeoJSON (reprojected to WGS84,
same property shape). Keep each override file under `scripts/overrides/<a3>.geojson`
with a `SOURCE` note in a sibling `.md`. The rest of the pipeline (city PiP,
prominence, distinctiveness, simplify) then runs on the substituted geometry
unchanged.

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
| Crimea, Sevastopol | | ☐ | attributed to which country in the data? |
| Western Sahara | | ☐ | own polygon / part of Morocco / excluded? |
| Kashmir (J&K, Ladakh, Gilgit-Baltistan, Aksai Chin) | | ☐ | |
| West Bank, Gaza | | ☐ | currently one polygon each, unnamed |
| Taiwan | | ☐ | include its counties? label? |
| Kosovo | | ☐ | |
| Abkhazia, South Ossetia | | ☐ | |
| Northern Cyprus | | ☐ | |
| Somaliland | | ☐ | |
| Antarctic claims | | ☐ | currently one "Antarctica" unit — fine to keep or drop |

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

_(move rows here with the commit hash and source once complete)_
