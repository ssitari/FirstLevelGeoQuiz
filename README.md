# First-Level Geo Quiz

A geography quiz: a first-level administrative unit somewhere on Earth — a state,
province, region, prefecture, oblast, department — is shown in silhouette, north
up, and you name it. Wrong guesses buy you hints (continent, then country, then a
city) at a steep cost. Solve cleanly to build a streak multiplier.

Built with [D3.js](https://d3js.org) for the map projections. No build step for
the site itself — plain HTML, CSS, and ES-module JavaScript.

---

## Live demo

[View on GitHub Pages](https://ssitari.github.io/FirstLevelGeoQuiz/)

---

## Modes

| Mode | Pool | Hints |
|---|---|---|
| **Novice** | one country you pick | unit type + size, largest city, first/last letter |
| **Intermediate** | the whole world, weighted toward units that are prominent *and* distinctively shaped | continent → country → city |
| **Ironman** | uniform random over all ~4,380 units | continent → country → city |
| **Daily** | five fixed puzzles, same for everyone, from the recognizable set | continent → country → city |

Intermediate weights each question by a **prominence score** (`prom`) — area +
largest-city population + capital status + country — *and* a **distinctiveness
score** (`distinct`, 0..1) measuring how much identifying information the outline
actually carries. The obscure long tail and the featureless-rectangle set are
both suppressed by weight, not a hard cut. Ironman ignores both — that's the
point of it.

## Scoring

A correct answer is worth `BASE_POINTS[mode]`, minus penalties:

- each **wrong guess** costs 8% of base and reveals the next hint for free;
- **revealing a hint** costs its own fraction (continent 30%, country 45%, city
  20%) whether a miss or you triggered it;
- **buying a hint early**, before you've earned it with a miss, costs 1.5×;
- a decaying **time bonus** (up to +40%) rewards fast solves;
- a **streak multiplier** (up to ×2.0) builds on clean solves — no hints, ≤1 miss.

Six wrong guesses ends the question at zero. Every number above lives in
[`config.js`](config.js) — tune to taste.

## Community stats (optional)

If `STATS_API` in `config.js` points at the Cloudflare Worker in [`worker/`](worker/),
the reveal panel shows how often other players get each unit ("get this 34% of
the time"), and the 📊 button opens a toughest / most-nailed list. Anonymous
aggregate counters only — no identity, no per-game rows. Empty `STATS_API`
disables it completely (no network calls). Deploy steps: [`worker/README.md`](worker/README.md).

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
the `prominence()` / `tier_for()` / `distinctiveness()` functions.

### Data notes

- Source: Natural Earth 1:10m Admin 1 – States, Provinces, **"lakes" variant** —
  its unit boundaries follow lake shorelines (Great Lakes, Caspian, Victoria…)
  instead of running through open water. The plain variant makes lake-bordering
  units like Wisconsin unrecognizable. ~4,630 units after sliver/tiny-island
  filtering and the boundary-currency overrides below.
- **Boundary-currency overrides:** Kenya, Nepal, DR Congo and Morocco have
  out-of-date subdivisions in Natural Earth, so those four are swapped for
  [geoBoundaries](https://www.geoboundaries.org/) gbHumanitarian ADM1
  (CC BY 3.0 IGO). See [`docs/data-currency.md`](docs/data-currency.md) — it's the
  running checklist for staleness and disputed-territory calls.
- Output is **TopoJSON** (shared arcs + quantization), ~5.5 MB / ~1.8 MB gzipped.
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
  so they don't clog Intermediate/Daily, but they're all still in Ironman.
- Largest-city hints are found by point-in-polygon against the full-resolution
  geometry; where no populated place falls inside a unit, the nearest city in the
  same country is shown and flagged "(near)".
- Units with mostly straight (surveyed / colonial) borders — much of the Sahara,
  the Canadian prairies, western US state lines — have little silhouette
  information even at full fidelity. Each unit carries a `distinct` (0..1)
  shape-distinctiveness score (boundary detail density + straight-edge fraction +
  concavity + islands); Intermediate and Daily scale a question's draw weight by
  it, so Colorado / Saskatchewan / the desert oblasts turn up ~15× less than an
  equally-prominent distinctive unit. Ironman and Novice ignore it. It can also
  feed scoring (`DISTINCT_SCORING` in config, off by default).

---

Boundaries and place names from [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/)
(public domain); Kenya, Nepal, DR Congo and Morocco first-level boundaries from
[geoBoundaries](https://www.geoboundaries.org/) (CC BY 3.0 IGO — Runfola et al.
2020, PLoS ONE 15(4): e0231866).

Built with assistance from Claude (Anthropic).

## License

[MIT](LICENSE)
