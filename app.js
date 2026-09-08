// Engine for the Subnational Geography Map Quiz. Tunables live in config.js.
//
// Data model (data/admin1.topojson): one record per first-level admin unit —
//   { id, name, alt[], country, a3, iso2, cont, subr, type, tier, prom, distinct,
//     playable, lon, lat, area, city:{name,pop,in_unit}, geom:MultiPolygon coords }
// `playable` is false for units the build holds out (single-unit countries and
// contested attributions) — they render as map context but are never the answer.
//
// A "game" is ROUND_LENGTH questions drawn from a pool. The pool depends on
// mode: one country (novice), the whole world weighted by prominence + shape
// (hard), everything uniformly (ironman), or a date-seeded fair subset (daily).

import * as cfg from "./config.js";

const $ = (id) => document.getElementById(id);
const svgNS = "http://www.w3.org/2000/svg";
const DEV = /^(localhost|127\.|0\.0\.0\.0)/.test(location.hostname) || location.search.includes("dev");

// ─────────────────────────────────────────────────────────── data + indexes

let ALL = [];                 // every unit, including ones never used as an answer
let PLAYABLE = [];            // the subset a question may be drawn from
let BY_A3 = new Map();        // a3 -> unit[] (all of them — the reveal map wants
                              //   the unplayable neighbours drawn too)
let MANIFEST = null;
let LAND = null;              // dissolved world coastline for the globe inset

// ─────────────────────────────────────────────────────────── game state

const state = {
  mode: "hard",
  pool: [],
  poolLabel: "",
  questions: [],
  qi: 0,
  score: 0,
  streakMult: 1.0,
  results: [],          // { rec, solved, hints, wrong, points }
  cur: null,            // { rec, revealed:Set, wrong:[], t0, done }
  acList: [],           // autocomplete entries [{label, norm, rec}]
  acHi: -1,
  seeded: null,         // rng for daily
};

// ─────────────────────────────────────────────────────────── utilities

// deterministic RNG for the daily puzzle
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = () => (state.seeded ? state.seeded() : Math.random());

function norm(s) {
  return (s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(saint|sankt|santa|santo|ste)\b/g, "st")
    .replace(/^(the|el|le|la|los|las)\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function lev(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 1) return 2;
  const d = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = d[j];
      d[j] = Math.min(
        d[j] + 1, d[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return d[n];
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function fmt(n) { return n.toLocaleString("en-US"); }

const geoOf = (rec) => rec.geom;   // rec.geom is already a GeoJSON geometry

// d3-geo's spherical path renders the whole-sphere complement of a polygon whose
// rings are wound the "GeoJSON / RFC 7946" way. Detect it (area > a hemisphere)
// and flip every ring so the small side is the interior.
function fixWinding(g) {
  if (!g || d3.geoArea(g) <= 2 * Math.PI) return g;
  const revPoly = (poly) => poly.forEach((ring) => ring.reverse());
  if (g.type === "Polygon") revPoly(g.coordinates);
  else if (g.type === "MultiPolygon") g.coordinates.forEach(revPoly);
  return g;
}

function toRecord(f) {
  const p = f.properties || {};
  return {
    id: p.id || f.id,
    name: p.name,
    alt: p.alt ? String(p.alt).split("|").filter(Boolean) : [],
    country: p.country, a3: p.a3, iso2: p.iso2,
    cont: p.cont || "—", subr: p.subr || "—",
    type: p.type || "region",
    prom: +p.prom || 0,
    distinct: p.distinct == null ? 0.6 : +p.distinct,
    tier: p.tier || "hard",
    // false for a country with a single admin-1 unit (the "unit" is the country)
    // and for units the build holds out as contested — see EXCLUDE_UNITS in
    // scripts/build.py. They still render as neighbours, they're just never asked.
    playable: p.playable !== false,
    lon: +p.lon, lat: +p.lat, area: +p.area || 0,
    city: p.cityName ? { name: p.cityName, pop: +p.cityPop || 0, in_unit: !!p.cityIn } : null,
    geom: fixWinding(f.geometry),
  };
}

function angDist(lon1, lat1, lon2, lat2) {
  const r = Math.PI / 180;
  const c = Math.sin(lat1 * r) * Math.sin(lat2 * r)
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return Math.acos(Math.max(-1, Math.min(1, c))) / r;
}

// ─────────────────────────────────────────────────────────── name matching

// accepted answer strings for a unit
function answerKeys(rec) {
  const keys = [norm(rec.name), norm(rec.name.replace(/\(.*?\)/g, ""))];
  for (const a of rec.alt || []) {
    if (a.length >= cfg.MIN_ALT_LEN) keys.push(norm(a));
  }
  return keys.filter(Boolean);
}

function normGuess(text) {
  return norm(text)
    .replace(/\s+(province|state|region|prefecture|oblast|department|county|district|governorate|canton|voivodeship)$/, "")
    .trim();
}

// does this typed guess name the given unit? (checked against the target first,
// so a name shared by two units still counts when you typed the right one)
function guessHits(text, rec) {
  const q = normGuess(text);
  if (!q) return false;
  const keys = rec._keys || (rec._keys = answerKeys(rec));
  return keys.some((k) => k === q || (q.length >= 6 && k.length >= 6 && lev(q, k) <= 1));
}

// which unit in the pool does this typed guess resolve to? (or null)
function resolveGuess(text, pool) {
  const q = normGuess(text);
  if (!q) return null;
  let exact = null, fuzzy = null;
  for (const rec of pool) {
    const keys = rec._keys || (rec._keys = answerKeys(rec));
    for (const k of keys) {
      if (k === q) { exact = rec; break; }
      if (!fuzzy && q.length >= 6 && k.length >= 6 && lev(q, k) <= 1) fuzzy = rec;
    }
    if (exact) break;
  }
  return exact || fuzzy;
}

// ─────────────────────────────────────────────────────────── pool building

function areaRankWithin(rec) {
  const sibs = (BY_A3.get(rec.a3) || []).slice().sort((a, b) => b.area - a.area);
  return { rank: sibs.indexOf(rec) + 1, n: sibs.length };
}

function buildPool() {
  const m = state.mode;
  if (m === "novice") {
    const a3 = $("country-select").value;
    state.pool = (BY_A3.get(a3) || []).filter((r) => r.playable);
    state.poolLabel = MANIFEST.countries.find((c) => c.a3 === a3)?.name || a3;
    return;
  }
  state.pool = PLAYABLE.slice();
  state.poolLabel = "the world";
}

function drawQuestions() {
  const n = state.mode === "daily" ? cfg.DAILY_LENGTH : cfg.ROUND_LENGTH;
  const m = state.mode;

  if (m === "novice") {
    const p = shuffle(state.pool.slice());
    return p.slice(0, Math.min(n, p.length));
  }
  if (m === "ironman") {
    return shuffle(state.pool.slice()).slice(0, n);
  }
  // hard + daily: sample without repeats, weighted by prominence
  const bag = m === "daily"
    ? state.pool.filter((r) => cfg.DAILY_TIERS.includes(r.tier))
    : state.pool.slice();
  const perCountry = new Map();
  const base = (r) => Math.pow(Math.max(0.02, r.prom - cfg.HARD_FLOOR), cfg.HARD_EXPONENT);
  const distinctFactor = (r) =>
    Math.max(cfg.DISTINCT_WEIGHT_MIN, Math.pow(r.distinct, cfg.DISTINCT_WEIGHT_EXP));
  const weightOf = (r) =>
    base(r) * distinctFactor(r) * Math.pow(cfg.COUNTRY_DECAY, perCountry.get(r.a3) || 0);
  const picked = [];
  const used = new Set();
  let guard = 0;
  while (picked.length < n && picked.length < bag.length && guard++ < 5000) {
    let total = 0;
    for (const r of bag) if (!used.has(r.id)) total += weightOf(r);
    let x = rand() * total;
    for (const r of bag) {
      if (used.has(r.id)) continue;
      x -= weightOf(r);
      if (x <= 0) {
        picked.push(r); used.add(r.id);
        perCountry.set(r.a3, (perCountry.get(r.a3) || 0) + 1);
        break;
      }
    }
  }
  return picked;
}

// ─────────────────────────────────────────────────────────── rendering

function drawSilhouette(rec) {
  const svg = $("silhouette");
  svg.innerHTML = "";
  const [w, h] = svg.getAttribute("viewBox").split(" ").slice(2).map(Number);
  const p = cfg.SILHOUETTE.padding;
  const geo = geoOf(rec);
  const proj = d3.geoAzimuthalEqualArea()
    .rotate([-rec.lon, -rec.lat])
    .fitExtent([[p, p], [w - p, h - p]], geo);
  const path = d3.geoPath(proj);
  const el = document.createElementNS(svgNS, "path");
  el.setAttribute("d", path(geo));
  el.setAttribute("fill", cfg.SILHOUETTE.fill);
  svg.appendChild(el);
}

function drawLocator(rec) {
  const svg = $("locator");
  svg.innerHTML = "";
  const [w, h] = svg.getAttribute("viewBox").split(" ").slice(2).map(Number);
  const p = 16;

  // siblings near the target (avoids antimeridian blow-ups for USA/RUS/etc.)
  const sibs = (BY_A3.get(rec.a3) || []).filter(
    (s) => s === rec || angDist(rec.lon, rec.lat, s.lon, s.lat) < 32,
  );
  const fc = { type: "FeatureCollection", features: sibs.map((s) => ({ type: "Feature", geometry: geoOf(s) })) };
  const proj = d3.geoAzimuthalEqualArea()
    .rotate([-rec.lon, -rec.lat])
    .fitExtent([[p, p], [w - p, h - p]], fc);
  const path = d3.geoPath(proj);

  for (const s of sibs) {
    if (s === rec) continue;
    const el = document.createElementNS(svgNS, "path");
    el.setAttribute("d", path(geoOf(s)));
    el.setAttribute("fill", cfg.SILHOUETTE.siblingFill);
    el.setAttribute("stroke", cfg.SILHOUETTE.siblingStroke);
    el.setAttribute("stroke-width", "0.6");
    svg.appendChild(el);
  }
  const t = document.createElementNS(svgNS, "path");
  t.setAttribute("d", path(geoOf(rec)));
  t.setAttribute("fill", cfg.SILHOUETTE.revealFill);
  svg.appendChild(t);
}

// An orthographic globe centred on the answer. The locator above it shows the
// unit among its neighbours, which says nothing at all when a country has one
// unit (the Vatican's "locator" was the same silhouette again) and never says
// where on Earth you were. The surrounding coastline does.
function drawGlobe(rec) {
  const svg = $("globe");
  svg.innerHTML = "";
  if (!LAND) { svg.hidden = true; return; }   // land file missing — skip quietly
  svg.hidden = false;

  const [w, h] = svg.getAttribute("viewBox").split(" ").slice(2).map(Number);
  const proj = d3.geoOrthographic()
    .rotate([-rec.lon, -rec.lat])
    .fitExtent([[3, 3], [w - 3, h - 3]], { type: "Sphere" });
  const path = d3.geoPath(proj);

  const add = (d, fill, stroke, width) => {
    if (!d) return;
    const el = document.createElementNS(svgNS, "path");
    el.setAttribute("d", d);
    el.setAttribute("fill", fill || "none");
    if (stroke) {
      el.setAttribute("stroke", stroke);
      el.setAttribute("stroke-width", width);
      el.setAttribute("stroke-linejoin", "round");
    }
    svg.appendChild(el);
  };

  add(path({ type: "Sphere" }), cfg.GLOBE.ocean);
  add(path(d3.geoGraticule10()), null, cfg.GLOBE.graticule, "0.5");
  add(path(LAND), cfg.GLOBE.land, cfg.GLOBE.landStroke, "0.4");
  add(path(geoOf(rec)), cfg.GLOBE.marker);

  // most units are sub-pixel at this scale, so ring the spot as well
  const [cx, cy] = proj([rec.lon, rec.lat]);
  const ring = document.createElementNS(svgNS, "circle");
  ring.setAttribute("cx", cx);
  ring.setAttribute("cy", cy);
  ring.setAttribute("r", 9);
  ring.setAttribute("fill", "none");
  ring.setAttribute("stroke", cfg.GLOBE.marker);
  ring.setAttribute("stroke-width", "1.4");
  svg.appendChild(ring);

  add(path({ type: "Sphere" }), null, cfg.GLOBE.landStroke, "0.8");   // rim
}

// ─────────────────────────────────────────────────────────── hints

function hintText(rung, rec) {
  if (rung === "continent") return `Continent: <b>${rec.cont}</b>`;
  if (rung === "country") return `Country: <b>${rec.country}</b>`;
  if (rung === "city") {
    if (!rec.city) return `No notable city on record`;
    const lbl = rec.city.in_unit ? "Largest city" : "Nearest city";
    return `${lbl}: <b>${rec.city.name}</b>`;
  }
  if (rung === "scale") {
    const { rank, n } = areaRankWithin(rec);
    return `It's a <b>${rec.type}</b> · ~${fmt(rec.area)} km² (#${rank} of ${n})`;
  }
  if (rung === "region") {
    if (rec.city) return `Largest city: <b>${rec.city.name}</b>`;
    return `Subregion: <b>${rec.subr}</b>`;
  }
  if (rung === "letters") {
    const s = rec.name;
    return `<b>${s[0]}…${s[s.length - 1]}</b> · ${s.replace(/\s/g, "").length} letters`;
  }
  return "";
}

function ladder() { return cfg.HINT_LADDER[state.mode] || cfg.HINT_LADDER.hard; }

function revealPlayersLine(rec) {
  const st = unitStat(rec.id);
  if (!st) return "";
  const solve = Math.round(st.solve * 100);
  const clean = Math.round(st.clean * 100);
  return `<dt>Players</dt><dd>get this <b>${solve}%</b> of the time`
    + (clean ? ` · <b>${clean}%</b> with no hints` : "")
    + ` <span style="color:var(--muted)">(n=${fmt(st.n)})</span></dd>`;
}

function distinctLabel(d) {
  if (d < 0.28) return "featureless — mostly straight borders";
  if (d < 0.5) return "low — few identifying features";
  if (d < 0.72) return "average";
  if (d < 0.9) return "distinctive";
  return "unmistakable";
}

function revealNext(voluntary) {
  const c = state.cur;
  const rungs = ladder();
  const next = rungs.find((r) => !c.revealed.has(r));
  if (!next) return false;
  c.revealed.add(next);
  c.voluntary = c.voluntary || {};
  if (voluntary) c.voluntary[next] = true;
  renderHints();
  return true;
}

function renderHints() {
  const box = $("hints");
  box.innerHTML = "";
  for (const r of ladder()) {
    if (!state.cur.revealed.has(r)) continue;
    const chip = document.createElement("span");
    chip.className = "hint-chip";
    chip.innerHTML = hintText(r, state.cur.rec);
    box.appendChild(chip);
  }
  const rungs = ladder();
  const remaining = rungs.filter((r) => !state.cur.revealed.has(r)).length;
  $("hint-btn").disabled = remaining === 0 || state.cur.done;
  $("hint-btn").textContent = remaining ? "Hint" : "No hints left";
}

// ─────────────────────────────────────────────────────────── scoring

function penaltyFraction(c) {
  // A miss is charged once. The ladder rung it reveals is free — charging for
  // both is what put the round on the floor by the second guess.
  let pen = c.wrong.length * cfg.WRONG_PENALTY;
  for (const rung of c.revealed) {
    if (c.voluntary && c.voluntary[rung]) pen += cfg.HINT_PENALTY[rung] || 0;
  }
  return pen;
}

function timeFraction(c) {
  if (!cfg.TIME_BONUS.enabled) return 0;
  const dt = performance.now() - c.t0;
  const { fullMs, zeroMs, max } = cfg.TIME_BONUS;
  if (dt <= fullMs) return max;
  if (dt >= zeroMs) return 0;
  return max * (1 - (dt - fullMs) / (zeroMs - fullMs));
}

function scoreQuestion(c, solved) {
  if (!solved) return 0;
  const base = cfg.BASE_POINTS[state.mode];
  const frac = Math.max(cfg.MIN_FRACTION, 1 - penaltyFraction(c));
  // optional: pay a little more for a featureless outline, a little less for an
  // unmistakable one. Off by default (cfg.DISTINCT_SCORING === 0).
  const distMult = 1 + cfg.DISTINCT_SCORING * (0.5 - c.rec.distinct) * 2;
  const raw = base * frac * (1 + timeFraction(c)) * distMult;
  return Math.round(raw * state.streakMult);
}

// "You basically knew it": no hint you went and bought, and at most
// CLEAN_MAX_WRONG misses. Counting auto-revealed hints here (what the old test
// did) made the allowance dead code — every miss reveals a rung, so a solve with
// one miss could never satisfy `revealed.size === 0`.
function isClean(c, solved) {
  return !!solved
    && Object.keys(c.voluntary || {}).length === 0
    && c.wrong.length <= cfg.CLEAN_MAX_WRONG;
}

function updateStreak(c, solved) {
  const clean = isClean(c, solved);
  state.streakMult = clean
    ? Math.min(cfg.STREAK.cap, +(state.streakMult + cfg.STREAK.step).toFixed(2))
    : 1.0;
}

// ─────────────────────────────────────────────────────────── flow

function startGame() {
  state.mode = document.querySelector("#modes button.on").dataset.mode;
  state.seeded = null;
  if (state.mode === "daily") {
    const key = todayKey();
    const done = readJSON(`ps:daily:${key}`);
    if (done) return showDailyDone(key, done);
    state.seeded = mulberry32(hashStr(key));
  }
  buildPool();
  state.questions = drawQuestions();
  state.qi = 0;
  state.score = 0;
  state.streakMult = 1.0;
  state.results = [];
  buildAcList();

  $("setup").hidden = true;
  $("summary").hidden = true;
  $("game").hidden = false;
  nextQuestion();
}

function nextQuestion() {
  if (state.qi >= state.questions.length) return endGame();
  const rec = state.questions[state.qi];
  state.cur = { rec, revealed: new Set(), wrong: [], wrongIds: new Set(), voluntary: {}, t0: performance.now(), done: false };
  if (DEV) window.__ps = { state, rec, answer: rec.name };

  $("reveal").hidden = true;
  $("guess-form").hidden = false;
  $("wrongs").innerHTML = "";
  $("hints").innerHTML = "";
  $("msg").textContent = "";
  const g = $("guess");
  g.value = ""; g.disabled = false;
  $("giveup-btn").disabled = false;
  closeAc();
  drawSilhouette(rec);
  renderHints();
  updateHud();
  g.focus();
}

function submitGuess(text) {
  const c = state.cur;
  if (!text.trim() || c.done) return;
  if (guessHits(text, c.rec)) return finishQuestion(true);
  const hit = resolveGuess(text, state.pool);
  if (!hit) { $("msg").textContent = `No unit called “${text}” is in play.`; return; }
  if (hit.id === c.rec.id) return finishQuestion(true);
  if (c.wrongIds.has(hit.id)) { $("msg").textContent = `Already tried ${hit.name}.`; $("guess").value = ""; closeAc(); return; }

  // a real place, wrong one
  c.wrongIds.add(hit.id);
  c.wrong.push(hit.name);
  const chip = document.createElement("span");
  chip.className = "wrong-chip";
  chip.textContent = hit.name;
  $("wrongs").appendChild(chip);
  $("guess").value = "";
  closeAc();

  if (c.wrong.length >= cfg.MAX_WRONG) return finishQuestion(false);
  const more = revealNext(false);
  $("msg").textContent = more
    ? "Not it — hint added."
    : `Not it — ${cfg.MAX_WRONG - c.wrong.length} guess${cfg.MAX_WRONG - c.wrong.length === 1 ? "" : "es"} left.`;
}

function finishQuestion(solved) {
  const c = state.cur;
  c.done = true;
  const points = scoreQuestion(c, solved);
  updateStreak(c, solved);
  state.score += points;
  state.results.push({
    rec: c.rec, solved,
    clean: isClean(c, solved),
    hints: c.revealed.size,
    bought: Object.keys(c.voluntary || {}).length,
    wrong: c.wrong.length,
    points,
  });

  $("guess-form").hidden = true;
  $("guess").disabled = true;
  drawLocator(c.rec);
  drawGlobe(c.rec);

  const { rank, n } = areaRankWithin(c.rec);
  // show an English exonym only when it's genuinely a different, plain-ASCII name
  const nn = norm(c.rec.name);
  const engName = (c.rec.alt || []).find((a) =>
    /^[\x20-\x7E]+$/.test(a) && a.length > 3
    && !/^(state|province|region|department|departement|prefecture|governorate|canton|district|oblast|land|free|freistaat)\b/i.test(a)
    && !norm(a).includes(nn) && !nn.includes(norm(a)));
  const info = $("reveal-info");
  info.innerHTML = `
    <div class="rname ${solved ? "" : "miss"}">${c.rec.name}${engName && norm(engName) !== norm(c.rec.name) ? ` <span style="color:var(--muted);font-weight:400">(${engName})</span>` : ""}</div>
    <div class="rsub">${c.rec.type} of ${c.rec.country} · ${c.rec.cont}</div>
    <dl>
      <dt>Area</dt><dd>~${fmt(c.rec.area)} km² (#${rank} of ${n} in country)</dd>
      ${c.rec.city ? `<dt>${c.rec.city.in_unit ? "Largest city" : "Nearest city"}</dt><dd>${c.rec.city.name}${c.rec.city.pop ? ` · ${fmt(c.rec.city.pop)}` : ""}</dd>` : ""}
      <dt>Outline</dt><dd>${distinctLabel(c.rec.distinct)}</dd>
      ${revealPlayersLine(c.rec)}
      <dt>This round</dt><dd>${c.wrong.length} wrong · ${c.revealed.size} hint${c.revealed.size === 1 ? "" : "s"}</dd>
    </dl>
    <p style="margin:10px 0 0"><span class="pts ${points ? "" : "zero"}">${points ? "+" + fmt(points) : "no points"}</span>
      ${solved && state.streakMult > 1 ? ` · streak ×${state.streakMult.toFixed(1)}` : ""}</p>`;

  $("next-btn").textContent = state.qi + 1 >= state.questions.length ? "See results" : "Next";
  $("reveal").hidden = false;
  $("next-btn").focus();     // so Enter carries on; the input is disabled by now
  updateHud();
}

function endGame() {
  $("game").hidden = true;
  const sum = $("summary");
  sum.hidden = false;

  const solved = state.results.filter((r) => r.solved).length;
  const clean = state.results.filter((r) => r.clean).length;
  const bestKey = `ps:best:${state.mode}`;
  const prevBest = readJSON(bestKey) || 0;
  const isBest = state.score > prevBest;
  if (isBest) writeJSON(bestKey, state.score);

  const marks = state.results.map((r) => (!r.solved ? "🟥" : r.clean ? "🟩" : "🟨"));

  if (state.mode === "daily") {
    writeJSON(`ps:daily:${todayKey()}`, { score: state.score, marks, solved });
  }

  reportRound();

  sum.innerHTML = `
    <h2>${labelForMode(state.mode)} — done</h2>
    <div class="big">${fmt(state.score)}<span style="font-size:14px;color:var(--muted)"> pts</span></div>
    <div style="font-size:13px;color:var(--muted)">
      ${solved}/${state.results.length} correct · ${clean} clean${isBest ? " · <b style='color:var(--good)'>new best!</b>" : ` · best ${fmt(Math.max(prevBest, state.score))}`}
    </div>
    <ol>${state.results.map((r) => `
      <li><span class="mk">${!r.solved ? "🟥" : r.clean ? "🟩" : "🟨"}</span>
        <span class="nm">${r.rec.name}<small style="color:var(--muted)"> · ${r.rec.country}</small></span>
        <span class="pt">${r.points ? "+" + fmt(r.points) : "—"}</span></li>`).join("")}</ol>
    <div id="summary-actions">
      <button class="primary" id="again-btn">Play again</button>
      ${state.mode === "daily" ? `<button class="ghost" id="share-btn">Share result</button>` : ""}
      <button class="ghost" id="menu-btn">Change mode</button>
    </div>`;

  $("again-btn").onclick = startGame;
  $("menu-btn").onclick = showSetup;
  const share = $("share-btn");
  if (share) {
    share.onclick = () => {
      const txt = `${cfg.APP_TITLE} — Daily ${todayKey()}\n${marks.join("")}  ${fmt(state.score)} pts\n${location.host}${location.pathname}`;
      navigator.clipboard?.writeText(txt).then(
        () => { share.textContent = "Copied!"; },
        () => { share.textContent = "Copy failed"; },
      );
    };
  }
  updateHud();
}

// ─────────────────────────────────────────────────────────── autocomplete

function buildAcList() {
  const seen = new Set();
  state.acList = [];
  for (const rec of state.pool) {
    const labels = [rec.name, ...(rec.alt || []).filter((a) => a.length >= cfg.MIN_ALT_LEN)];
    for (const lb of labels) {
      const key = norm(lb) + "|" + rec.id;
      if (seen.has(key)) continue;
      seen.add(key);
      state.acList.push({ label: lb, norm: norm(lb), rec });
    }
  }
}

function renderAc(q) {
  const ac = $("ac");
  const nq = norm(q);
  if (nq.length < 2) return closeAc();
  const starts = [], has = [];
  for (const e of state.acList) {
    if (e.norm.startsWith(nq)) starts.push(e);
    else if (e.norm.includes(nq)) has.push(e);
    if (starts.length > 8) break;
  }
  const list = [...starts, ...has].slice(0, 8);
  state.acHi = -1;
  if (!list.length) return closeAc();
  ac.innerHTML = list.map((e, i) =>
    `<li role="option" id="ac-opt-${i}" aria-selected="false"
        data-i="${i}" data-name="${e.label.replace(/"/g, "&quot;")}">${e.label}
      <small>&nbsp;— ${e.rec.type} · ${e.rec.country}</small></li>`).join("");
  ac._list = list;
  $("guess").setAttribute("aria-expanded", "true");
  [...ac.children].forEach((li) => {
    li.onmousedown = (ev) => { ev.preventDefault(); pick(li.dataset.name); };
  });
}
function closeAc() {
  const ac = $("ac");
  ac.innerHTML = "";
  ac._list = null;
  state.acHi = -1;
  const g = $("guess");
  g.setAttribute("aria-expanded", "false");
  g.removeAttribute("aria-activedescendant");
}
function pick(name) { $("guess").value = name; closeAc(); submitGuess(name); }

// ─────────────────────────────────────────────────────────── setup screen

function showSetup() {
  $("game").hidden = true;
  $("summary").hidden = true;
  $("setup").hidden = false;
  const mode = document.querySelector("#modes button.on").dataset.mode;
  const ctrls = $("setup-controls");
  ctrls.innerHTML = "";

  const desc = {
    novice: "Pick a country. You'll be shown its states / provinces / regions one at a time to identify — hints stay local (unit type, size, largest city).",
    hard: "First-level units from anywhere in the world, weighted toward the ones that are both prominent and distinctively shaped. Misses reveal continent, then country, then a city.",
    ironman: "Uniformly random across every playable first-level unit on Earth — 3,600-plus of them, most of which you have never heard of. No weighting toward the famous or the distinctively shaped. Hints and streaks still apply. Bragging rights only.",
    daily: "Five fixed puzzles, the same for everyone, drawn from the more recognizable units. One attempt per day; share your grid.",
  }[mode];
  $("setup-title").textContent = labelForMode(mode);
  $("setup-desc").textContent = desc;

  if (mode === "novice") {
    const playableCount = (c) => (c.np == null ? c.n : c.np);
    const opts = MANIFEST.countries
      .filter((c) => playableCount(c) >= cfg.MIN_NOVICE_UNITS)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => `<option value="${c.a3}">${c.name} — ${playableCount(c)}</option>`).join("");
    ctrls.innerHTML = `<label for="country-select">Country (unit count)</label>
      <select id="country-select">${opts}</select>`;
    const sel = $("country-select");
    sel.value = readJSON("ps:lastCountry") || "USA";
    if (!sel.value) sel.value = "USA";   // saved pick may no longer be listed
    sel.onchange = () => writeJSON("ps:lastCountry", sel.value);
  }

  if (mode === "daily") {
    const done = readJSON(`ps:daily:${todayKey()}`);
    if (done) {
      $("start-btn").textContent = "See today's result";
    } else {
      $("start-btn").textContent = "Start";
    }
  } else {
    $("start-btn").textContent = "Start";
  }

  const best = readJSON(`ps:best:${mode}`);
  $("best-line").innerHTML = best ? `Your best: <b>${fmt(best)}</b> pts` : "";
}

function showDailyDone(key, done) {
  $("setup").hidden = true;
  $("game").hidden = true;
  const sum = $("summary");
  sum.hidden = false;
  sum.innerHTML = `
    <h2>Daily ${key}</h2>
    <div class="big">${fmt(done.score)}<span style="font-size:14px;color:var(--muted)"> pts</span></div>
    <div style="font-size:20px;letter-spacing:2px;margin:10px 0">${done.marks.join("")}</div>
    <div style="font-size:13px;color:var(--muted)">${done.solved}/${cfg.DAILY_LENGTH} correct · come back tomorrow</div>
    <div id="summary-actions">
      <button class="ghost" id="share-btn">Share result</button>
      <button class="ghost" id="menu-btn">Other modes</button>
    </div>`;
  $("menu-btn").onclick = () => { setMode("hard"); showSetup(); };
  $("share-btn").onclick = () => {
    const txt = `${cfg.APP_TITLE} — Daily ${key}\n${done.marks.join("")}  ${fmt(done.score)} pts\n${location.host}${location.pathname}`;
    navigator.clipboard?.writeText(txt).then(() => { $("share-btn").textContent = "Copied!"; });
  };
}

// ─────────────────────────────────────────────────────────── misc helpers

function labelForMode(m) {
  // Display labels only. The mode *keys* never change: localStorage bests
  // (ps:best:ironman) and the stats backend's mode field depend on them.
  return { novice: "Novice", hard: "Hard", ironman: "Masochist!", daily: "Daily" }[m];
}
function updateHud() {
  $("hud-score").textContent = fmt(state.score);
  $("hud-streak").textContent = "×" + state.streakMult.toFixed(1);
  $("hud-q").textContent = state.cur && !$("game").hidden
    ? `Q ${Math.min(state.qi + 1, state.questions.length)}/${state.questions.length}`
    : "—";
}
function setMode(m) {
  [...document.querySelectorAll("#modes button")].forEach((b) => {
    const on = b.dataset.mode === m;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
}
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }

// ─────────────────────────────────────────────────────────── wiring

function wire() {
  document.querySelectorAll("#modes button").forEach((b) => {
    b.onclick = () => { setMode(b.dataset.mode); showSetup(); };
  });
  $("start-btn").onclick = startGame;
  $("next-btn").onclick = () => { state.qi++; nextQuestion(); };
  $("hint-btn").onclick = () => { if (revealNext(true)) $("msg").textContent = "Hint bought."; };
  $("giveup-btn").onclick = () => finishQuestion(false);

  const g = $("guess");
  g.addEventListener("input", () => renderAc(g.value));
  g.addEventListener("blur", () => setTimeout(closeAc, 120));
  g.addEventListener("keydown", (e) => {
    const ac = $("ac"); const list = ac._list;
    if (e.key === "ArrowDown" && list) { e.preventDefault(); state.acHi = Math.min(list.length - 1, state.acHi + 1); hlAc(); }
    else if (e.key === "ArrowUp" && list) { e.preventDefault(); state.acHi = Math.max(0, state.acHi - 1); hlAc(); }
    else if (e.key === "Escape") closeAc();
  });
  $("guess-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const ac = $("ac");
    if (ac._list && state.acHi >= 0) pick(ac._list[state.acHi].label);
    else submitGuess(g.value);
  });

  wireDialog("help", "help-btn", "help-close");
  wireDialog("stats-modal", "stats-btn", "stats-close", openStats);

  // Escape closes whichever dialog is open
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    for (const id of ["help", "stats-modal"]) {
      if (!$(id).hidden) { closeDialog(id); e.preventDefault(); return; }
    }
  });
}

let dialogReturn = null;   // what had focus before a dialog opened

function openDialog(id) {
  dialogReturn = document.activeElement;
  $(id).hidden = false;
  const first = $(id).querySelector("button, [href], input, select, textarea");
  if (first) first.focus();
}

function closeDialog(id) {
  $(id).hidden = true;
  if (dialogReturn && dialogReturn.focus) dialogReturn.focus();
  dialogReturn = null;
}

function wireDialog(id, openBtn, closeBtn, before) {
  $(openBtn).onclick = () => { if (before) before(); openDialog(id); };
  $(closeBtn).onclick = () => closeDialog(id);
  $(id).onclick = (e) => { if (e.target.id === id) closeDialog(id); };
}
function hlAc() {
  const ac = $("ac");
  [...ac.children].forEach((li, i) => {
    const on = i === state.acHi;
    li.classList.toggle("hl", on);
    li.setAttribute("aria-selected", on ? "true" : "false");
  });
  const g = $("guess");
  if (state.acHi >= 0) g.setAttribute("aria-activedescendant", `ac-opt-${state.acHi}`);
  else g.removeAttribute("aria-activedescendant");
}

// ─────────────────────────────────────────────────────────── community stats

let STATS = null;   // { unit_id: { shown, solved, solved_clean, ... } }
const statsBase = () => (cfg.STATS_API || "").replace(/\/+$/, "");

async function loadStats() {
  if (DEV && location.search.includes("mockstats")) {
    mockStats();
    $("stats-btn").hidden = !hasStatsData();
    return;
  }
  if (!cfg.STATS_API) return;
  const cached = readJSON("ps:stats");
  if (cached && Date.now() - cached.t < cfg.STATS_REFRESH_MIN * 60000) {
    STATS = cached.units;
  } else {
    try {
      const r = await fetch(statsBase() + "/stats");
      if (r.ok) {
        const d = await r.json();
        STATS = d.units || {};
        writeJSON("ps:stats", { t: Date.now(), units: STATS });
      }
    } catch { /* offline / backend down — stats just don't show */ }
  }
  $("stats-btn").hidden = !hasStatsData();
}

function hasStatsData() {
  return STATS && Object.values(STATS).some((s) => s.shown >= cfg.STATS_MIN_SAMPLE);
}

function unitStat(id) {
  const s = STATS && STATS[id];
  if (!s || s.shown < cfg.STATS_MIN_SAMPLE) return null;
  return { n: s.shown, solve: s.solved / s.shown, clean: s.solved_clean / s.shown };
}

// Reporting is off for anyone whose browser asks for it to be (Global Privacy
// Control / Do Not Track) and for anyone who has switched it off in the footer.
function statsBlockedByBrowser() {
  return navigator.globalPrivacyControl === true
    || navigator.doNotTrack === "1"
    || window.doNotTrack === "1";
}

function statsAllowed() {
  if (!cfg.STATS_API || statsBlockedByBrowser()) return false;
  return readJSON("ps:statsOptOut") !== true;
}

function renderCredit() {
  const el = $("credit");
  el.innerHTML = cfg.CREDIT_HTML
    + ` &nbsp;·&nbsp; ${fmt(PLAYABLE.length)} units · ${MANIFEST.countries.length} countries`
    + ` · data ${MANIFEST.generated}`;
  if (!cfg.STATS_API) return;

  const box = document.createElement("div");
  box.className = "consent";
  if (statsBlockedByBrowser()) {
    box.innerHTML = "Community stats reporting is off — your browser sends Do&nbsp;Not&nbsp;Track "
      + "or Global&nbsp;Privacy&nbsp;Control, so nothing is sent when a round ends.";
    el.appendChild(box);
    return;
  }
  const on = statsAllowed();
  box.innerHTML = on
    ? "When a round ends this page sends anonymous per-unit outcomes — which unit, solved or not, "
      + "hints used — so the community stats can be built. No identity, no account, no record of "
      + "your game."
    : "Community stats reporting is off. Nothing is sent when a round ends.";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = on ? "Turn off" : "Turn on";
  btn.onclick = () => { writeJSON("ps:statsOptOut", on); renderCredit(); };
  box.appendChild(btn);
  el.appendChild(box);
}

function reportRound() {
  if (!statsAllowed() || !state.results.length) return;
  const body = JSON.stringify({
    mode: state.mode,
    results: state.results.map((r) => ({
      unit: r.rec.id,
      solved: r.solved,
      clean: r.solved && r.hints === 0 && r.wrong <= 1,
      wrong: r.wrong,
      hints: r.hints,
      gaveUp: !r.solved,
    })),
  });
  // keepalive fetch, credentials omitted and text/plain body: a CORS "simple
  // request", so no preflight and the Worker's wildcard ACAO is accepted.
  try {
    fetch(statsBase() + "/report", {
      method: "POST",
      body,
      keepalive: true,
      credentials: "omit",
      headers: { "Content-Type": "text/plain" },
    }).catch(() => {});
  } catch { /* ignore */ }
}

function mockStats() {  // DEV only — plausible numbers so the UI can be seen
  STATS = {};
  for (const r of ALL) {
    if (Math.random() < 0.4) continue;
    let base = 0.08 + 0.6 * r.distinct + (r.prom - 6) * 0.025 + (Math.random() - 0.5) * 0.15;
    base = Math.min(0.94, Math.max(0.02, base));
    const shown = 15 + Math.floor(Math.random() * 400);
    const solved = Math.round(shown * base);
    STATS[r.id] = {
      shown, solved,
      solved_clean: Math.round(solved * (0.4 + Math.random() * 0.3)),
      wrong_total: Math.round(shown * 1.4), hints_total: Math.round(shown * 1.1), gave_up: shown - solved,
    };
  }
}

function openStats() {
  const rows = [];
  let totalAnswers = 0;
  for (const r of ALL) {
    const s = STATS && STATS[r.id];
    if (!s) continue;
    totalAnswers += s.shown;
    if (s.shown >= cfg.STATS_MIN_SAMPLE) rows.push({ r, n: s.shown, rate: s.solved / s.shown });
  }
  rows.sort((a, b) => a.rate - b.rate);
  const list = (arr) => arr.map(({ r, n, rate }) =>
    `<li><span class="pct">${Math.round(rate * 100)}%</span>
       <span class="nm">${r.name}<small> · ${r.country}</small></span>
       <span class="nn">n=${fmt(n)}</span></li>`).join("");

  $("stats-body").innerHTML = rows.length < 3
    ? `<p style="color:var(--muted)">Not enough plays recorded yet — check back once a few rounds are in.</p>`
    : `<p style="color:var(--muted);margin-bottom:10px">${fmt(totalAnswers)} answers recorded ·
         showing units seen ${cfg.STATS_MIN_SAMPLE}+ times</p>
       <div class="stats-cols">
         <div><h4>Toughest</h4><ol class="stats-list">${list(rows.slice(0, 20))}</ol></div>
         <div><h4>Most nailed</h4><ol class="stats-list">${list(rows.slice(-20).reverse())}</ol></div>
       </div>`;
}

// ─────────────────────────────────────────────────────────── boot

Promise.all([
  d3.json(cfg.DATA_FILE),
  d3.json(cfg.MANIFEST_FILE),
  d3.json(cfg.LAND_FILE).catch(() => null),   // optional: only the globe needs it
]).then(([topo, manifest, landTopo]) => {
  const obj = topo.objects[Object.keys(topo.objects)[0]];
  ALL = topojson.feature(topo, obj).features.map(toRecord).filter((r) => r.name && r.geom);
  PLAYABLE = ALL.filter((r) => r.playable);
  MANIFEST = manifest;
  if (landTopo) {
    const lo = landTopo.objects[Object.keys(landTopo.objects)[0]];
    LAND = fixWinding(topojson.merge(landTopo, lo.geometries));
  }
  document.title = cfg.APP_TITLE;
  for (const r of ALL) {
    if (!BY_A3.has(r.a3)) BY_A3.set(r.a3, []);
    BY_A3.get(r.a3).push(r);
  }
  renderCredit();
  wire();
  setMode("hard");
  $("start-btn").disabled = false;
  $("stats-btn").hidden = true;   // shown by loadStats() once aggregates arrive
  showSetup();
  loadStats();
}).catch((err) => {
  $("setup-title").textContent = "Couldn't load the data";
  $("setup-desc").textContent = String(err) + " — is this being served over http:// (not opened as a file)?";
});
