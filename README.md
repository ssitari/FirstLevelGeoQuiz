# First-Level Geo Quiz

A geography quiz: a first-level administrative unit somewhere on Earth — a state,
province, region, prefecture, oblast, department — is shown in silhouette, north
up, and you name it. Wrong guesses buy you hints (continent, then country, then a
city) at a steep cost. Solve cleanly to build a streak multiplier.

The reveal shows the answer twice: among its neighbouring units, and as a dot on
an orthographic globe, so you finish each question knowing where on Earth you
were.

Built with [D3.js](https://d3js.org) for the map projections. No build step for
the site itself — plain HTML, CSS, and ES-module JavaScript.

---

## Live demo

**<https://firstlevelgeoquiz.metaalias.workers.dev>**

Unlike the other static projects in this collection, this one is **not** on
GitHub Pages. It is served by a Cloudflare Worker (`firstlevelgeoquiz`) with
static assets, connected to this repo through Cloudflare Workers Builds: every
push to `main` triggers a build, and a successful build deploys. A failed build
does not deploy, so the previous version stays up.

There is a second, entirely separate Worker for the community stats backend —
see [`worker/`](worker/). The two share nothing but a naming prefix.

---

## Modes

| Mode | Pool | Hints |
|---|---|---|
| **Novice** | one country you pick (of the 199 with at least `MIN_NOVICE_UNITS` units) | unit type + size, largest city, first/last letter |
| **Hard** | the whole world, weighted toward units that are prominent *and* distinctively shaped | continent → country → city |
| **Ironman** | uniform random over all 3,611 playable units | continent → country → city |
| **Daily** | five fixed puzzles, same for everyone, from the recognizable set | continent → country → city |

Hard weights each question by a **prominence score** (`prom`) — area +
largest-city population + capital status + country — *and* a **distinctiveness
score** (`distinct`, 0..1) measuring how much identifying information the outline
actually carries. The obscure long tail and the featureless-rectangle set are
both suppressed by weight, not a hard cut. Ironman ignores both — that's the
point of it.

The capital-status term is deliberately small and scales with the unit's area. A
flat bonus made capital *districts* — city boundaries, a couple of thousand km²
— the most prominent units on Earth outright, and the Daily was drawing five of
them at a time (Hovedstaden, Moskva, Dar-es-Salaam…), which nobody can identify
from an outline. It rewards "the province containing the capital", not "the
city".

## Scoring

A correct answer is worth `BASE_POINTS[mode]`, minus penalties:

- each **wrong guess** costs 17% of base and reveals the next hint — the hint it
  reveals is **free**, the miss is the whole charge;
- **buying a hint** you haven't earned with a miss costs its own fraction
  (continent 30%, country 45%, city 20%);
- a decaying **time bonus** (up to +40%) multiplies what you earned, rather than
  being added on top of base;
- a **streak multiplier** (up to ×2.0) builds on clean solves — no bought hints,
  at most `CLEAN_MAX_WRONG` misses.

That gives a legible ladder for a solved question: **1.00 / 0.83 / 0.66 / 0.49 /
0.32 / 0.15** of base as the misses pile up, so every guess through the sixth is
still worth making. Six wrong ends the question at zero. Every number above lives
in [`config.js`](config.js) — tune to taste.

Two things here are deliberate corrections rather than taste. Charging for both
the miss *and* the hint it forced put a question on the floor by the second guess
(1.00 / 0.62 / 0.09 / 0.05), so four of the six guesses were worth nothing. And
adding the time bonus on top of base rather than multiplying meant a fast solve
with a wrong guess beat a slow clean one — 816 against 800 on an 800-point
question, which is backwards for a quiz about knowing things.

## Community stats (optional)

If `STATS_API` in `config.js` points at the Cloudflare Worker in [`worker/`](worker/),
the reveal panel shows how often other players get each unit ("get this 34% of
the time"), and the 📊 button opens a toughest / most-nailed list. Anonymous
aggregate counters only — no identity, no per-game rows. Empty `STATS_API`
disables it completely (no network calls). Deploy steps: [`worker/README.md`](worker/README.md).

Reporting is consented, not assumed: the footer says in plain words what gets
sent and carries a **Turn off** toggle, and reporting is skipped outright for any
browser sending Global Privacy Control or Do Not Track.

## Running locally

The page loads its data with `fetch()`, so it needs to be served over HTTP:

```bash
python3 -m http.server 8000    # then open http://localhost:8000
```

`localhost` enables a small dev aid (`window.__ps.answer`); it's off on the
published site.

## Rebuilding the data

`data/admin1.topojson` and `data/manifest.json` are generated from
[Natural Earth](https://www.naturalearthdata.com/) (public domain):

```bash
python3 scripts/fetch.py     # downloads NE layers to scripts/cache/ (git-ignored)
python3 scripts/build.py     # enrich (area/city/tier) → mapshaper simplify + TopoJSON
```

`build.py` shells out to `npx mapshaper`, so it needs Node on `PATH`. Knobs at the
top of the script: `SIMPLIFY_K` / `QUANTIZATION` (shape fidelity vs file size) and
the `prominence()` / `tier_for()` / `distinctiveness_raw()` functions.

Mapshaper runs twice over the admin-1 data: once to simplify and de-sliver (out
as GeoJSON), then — after `distinctiveness_raw()` has scored the simplified
outlines and `percentile_ranks()` has ranked them — once more to encode TopoJSON.
The manifest is built from that same post-simplify feature set, so its counts
describe what actually shipped.

### Data notes

- Source: Natural Earth 1:10m Admin 1 – States, Provinces, **"lakes" variant** —
  its unit boundaries follow lake shorelines (Great Lakes, Caspian, Victoria…)
  instead of running through open water. The plain variant makes lake-bordering
  units like Wisconsin unrecognizable. 3,654 units across 249 countries after
  sliver/tiny-island filtering, the boundary-currency overrides and the
  administrative-level rollups below.
- **Boundary-currency overrides:** Kenya, Nepal, DR Congo and Morocco have
  out-of-date subdivisions in Natural Earth, so those four are swapped for
  [geoBoundaries](https://www.geoboundaries.org/) gbHumanitarian (CC BY 3.0 IGO).
- **Palestine** is treated as its own country, with its 16 governorates as the
  first-level units — a deliberately stronger position than Natural Earth, which
  maps the area as two Israeli-sovereign polygons. Geometry from geoBoundaries
  (OCHA oPt COD-AB); Jerusalem governorate is included.
- **Administrative-level rollups:** Natural Earth ships a tier *below* the real
  first level for eight countries — its UK is 232 districts and boroughs, its
  Italy 110 provinces, its Slovenia 181 municipalities. Those are dissolved up on
  one of NE's own grouping fields (`geonunit` for the UK, `region` for the rest),
  so no outside data and no hand-keyed names: GBR→4, FRA→18, ITA→20, PHL→17,
  SVN→12, LVA→5, MLT→3, UGA→4. See `ROLLUPS` in `build.py`.
- **Not every unit is asked.** Units carry `playable`; 43 of the 3,654 are held
  out. A country with a single admin-1 unit isn't subdivided at all — its "unit"
  is the country outline, a different game — which structurally removes
  Antarctica, Baykonur, Clipperton, the sovereign base areas, and also Somaliland,
  Northern Cyprus, Western Sahara and Siachen Glacier without anyone taking a
  position on them. On top of that, `EXCLUDE_UNITS` holds out six units the hint
  ladder could not attribute without asserting a contested sovereignty: Crimea and
  Sevastopol (NE assigns both to Russia) and the four Kashmir units. Held-out
  units stay in the data and are still drawn as neighbours on the reveal map —
  they are simply never the answer.
- See [`docs/data-currency.md`](docs/data-currency.md) — the running checklist for
  staleness, level, and disputed-territory calls.
- Output is **TopoJSON** (shared arcs + quantization), ~4.8 MB / ~1.6 MB gzipped.
- Simplification uses a **per-feature distance threshold** (`≈ SIMPLIFY_K ·
  sqrt(area_km²)` metres), not a percentage. A flat percentage keeps thousands of
  points on a huge province that will never be shown at that detail while gutting
  a small one; the per-feature threshold gives every silhouette the same on-screen
  fidelity. Lower `SIMPLIFY_K` = finer and larger.
- Natural Earth's `labelrank` turns out to encode the *country*, not unit fame,
  so it isn't used. Prominence is built from area + largest-city population +
  capital status instead.
- "First-level admin unit" is not comparable across countries — a US state, a
  French department, and a Maltese local council are all "admin-1" and span four
  orders of magnitude in size. Small units are penalized in the prominence score
  so they don't clog Hard/Daily, but they're all still in Ironman.
- Largest-city hints are found by point-in-polygon against the full-resolution
  geometry; where no populated place falls inside a unit, the nearest city in the
  same country is shown and flagged "(near)".
- Units with mostly straight (surveyed / colonial) borders — much of the Sahara,
  the Canadian prairies, western US state lines — have little silhouette
  information even at full fidelity. Each unit carries a `distinct` (0..1)
  shape-distinctiveness score (boundary detail that survived simplification +
  straight-edge fraction + concavity + islands); Hard and Daily scale a
  question's draw weight by it, so Colorado / Saskatchewan / the desert oblasts
  turn up ~20× less than an equally-prominent distinctive unit. Ironman and
  Novice ignore it. It can also feed scoring (`DISTINCT_SCORING` in config, off
  by default).
- Two things about how `distinct` is measured. It runs on the **simplified**
  geometry the player is actually shown, not the full-resolution source — scoring
  the source measured vertex density, which handed every small, densely-digitised
  city district a perfect 1.00. And every term is scale-free (a ratio, or
  relative to the unit's own linear size), so units three orders of magnitude
  apart in area are judged on the same footing.
- The score is then **percentile-ranked** across the population rather than put
  through a fixed stretch. The raw score clusters hard: the old fixed stretch
  shipped a median of 0.85 with 18% of units pinned above 0.95, so the draw
  weighting was being applied to what was very nearly a constant. Ranking makes
  the spread uniform by construction, which is the distribution `config.js` is
  written against.
- `data/land.topojson` (~31 KB) is a dissolved, heavily simplified world
  coastline for the globe inset on the reveal, out of the same NE 50m admin-0
  layer. Optional at runtime: if it fails to load, the globe hides itself.

---

Boundaries and place names from [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/)
(public domain); Kenya, Nepal, DR Congo, Morocco and Palestine first-level
boundaries from [geoBoundaries](https://www.geoboundaries.org/) (CC BY 3.0 IGO —
Runfola et al. 2020, PLoS ONE 15(4): e0231866).

Built with assistance from Claude (Anthropic).

## License

[MIT](LICENSE)
