// Engine for First-Level Geo Quiz. Tunables live in config.js.
//
// Data model (data/admin1.json): one record per first-level admin unit —
//   { id, name, alt[], country, a3, iso2, cont, subr, type, tier,
//     lon, lat, area, city:{name,pop,in_unit}, geom:MultiPolygon coords }
//
// A "game" is ROUND_LENGTH questions drawn from a pool. The pool depends on
// mode: one country (novice), the whole world weighted by tier (intermediate),
// everything uniformly (ironman), or a date-seeded fair subset (daily).

import * as cfg from "./config.js";

const $ = (id) => document.getElementById(id);
const svgNS = "http://www.w3.org/2000/svg";
const DEV = /^(localhost|127\.|0\.0\.0\.0)/.test(location.hostname) || location.search.includes("dev");

// ─────────────────────────────────────────────────────────── data + indexes

let ALL = [];                 // every unit
let BY_A3 = new Map();        // a3 -> unit[]
let MANIFEST = null;

// ─────────────────────────────────────────────────────────── game state

const state = {
  mode: "intermediate",
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
    state.pool = (BY_A3.get(a3) || []).slice();
    state.poolLabel = MANIFEST.countries.find((c) => c.a3 === a3)?.name || a3;
    return;
  }
  state.pool = ALL.slice();
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
  // intermediate + daily: sample without repeats, weighted by prominence
  const bag = m === "daily"
    ? state.pool.filter((r) => cfg.DAILY_TIERS.includes(r.tier))
    : state.pool.slice();
  const perCountry = new Map();
  const base = (r) => Math.pow(Math.max(0.02, r.prom - cfg.INTERMEDIATE_FLOOR), cfg.INTERMEDIATE_EXPONENT);
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

function ladder() { return cfg.HINT_LADDER[state.mode] || cfg.HINT_LADDER.intermediate; }

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
  let pen = c.wrong.length * cfg.WRONG_PENALTY;
  for (const rung of c.revealed) {
    pen += cfg.HINT_PENALTY[rung] || 0;
    if (c.voluntary && c.voluntary[rung]) pen += (cfg.HINT_PENALTY[rung] || 0) * 0.5;
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
  const raw = base * (frac + timeFraction(c)) * distMult;
  return Math.round(raw * state.streakMult);
}

function updateStreak(c, solved) {
  const clean = solved && c.revealed.size === 0 && c.wrong.length <= 1;
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
    hints: c.revealed.size,
    wrong: c.wrong.length,
    points,
  });

  $("guess-form").hidden = true;
  $("guess").disabled = true;
  drawLocator(c.rec);

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
      <dt>This round</dt><dd>${c.wrong.length} wrong · ${c.revealed.size} hint${c.revealed.size === 1 ? "" : "s"}</dd>
    </dl>
    <p style="margin:10px 0 0"><span class="pts ${points ? "" : "zero"}">${points ? "+" + fmt(points) : "no points"}</span>
      ${solved && state.streakMult > 1 ? ` · streak ×${state.streakMult.toFixed(1)}` : ""}</p>`;

  $("next-btn").textContent = state.qi + 1 >= state.questions.length ? "See results" : "Next";
  $("reveal").hidden = false;
  updateHud();
}

function endGame() {
  $("game").hidden = true;
  const sum = $("summary");
  sum.hidden = false;

  const solved = state.results.filter((r) => r.solved).length;
  const clean = state.results.filter((r) => r.solved && r.hints === 0 && r.wrong <= 1).length;
  const bestKey = `ps:best:${state.mode}`;
  const prevBest = readJSON(bestKey) || 0;
  const isBest = state.score > prevBest;
  if (isBest) writeJSON(bestKey, state.score);

  const marks = state.results.map((r) => (!r.solved ? "🟥" : r.hints ? "🟨" : "🟩"));

  if (state.mode === "daily") {
    writeJSON(`ps:daily:${todayKey()}`, { score: state.score, marks, solved });
  }

  sum.innerHTML = `
    <h2>${labelForMode(state.mode)} — done</h2>
    <div class="big">${fmt(state.score)}<span style="font-size:14px;color:var(--muted)"> pts</span></div>
    <div style="font-size:13px;color:var(--muted)">
      ${solved}/${state.results.length} correct · ${clean} clean${isBest ? " · <b style='color:var(--good)'>new best!</b>" : ` · best ${fmt(Math.max(prevBest, state.score))}`}
    </div>
    <ol>${state.results.map((r) => `
      <li><span class="mk">${!r.solved ? "🟥" : r.hints ? "🟨" : "🟩"}</span>
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
      const txt = `First-Level Geo Quiz — Daily ${todayKey()}\n${marks.join("")}  ${fmt(state.score)} pts\nssitari.github.io/FirstLevelGeoQuiz`;
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
    `<li data-i="${i}" data-name="${e.label.replace(/"/g, "&quot;")}">${e.label}
      <small>&nbsp;— ${e.rec.type} · ${e.rec.country}</small></li>`).join("");
  ac._list = list;
  [...ac.children].forEach((li) => {
    li.onmousedown = (ev) => { ev.preventDefault(); pick(li.dataset.name); };
  });
}
function closeAc() { const ac = $("ac"); ac.innerHTML = ""; ac._list = null; state.acHi = -1; }
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
    intermediate: "First-level units from anywhere in the world, weighted toward the ones you've plausibly heard of. Misses reveal continent, then country, then a city.",
    ironman: "Uniformly random across every first-level unit on Earth — 4,000-plus of them, most of which you have never heard of. Hints and streaks still apply. Bragging rights only.",
    daily: "Five fixed puzzles, the same for everyone, drawn from the more recognizable units. One attempt per day; share your grid.",
  }[mode];
  $("setup-title").textContent = labelForMode(mode);
  $("setup-desc").textContent = desc;

  if (mode === "novice") {
    const opts = MANIFEST.countries
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => `<option value="${c.a3}">${c.name} — ${c.n}</option>`).join("");
    ctrls.innerHTML = `<label for="country-select">Country (unit count)</label>
      <select id="country-select">${opts}</select>`;
    const sel = $("country-select");
    sel.value = readJSON("ps:lastCountry") || "USA";
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
  $("menu-btn").onclick = () => { setMode("intermediate"); showSetup(); };
  $("share-btn").onclick = () => {
    const txt = `First-Level Geo Quiz — Daily ${key}\n${done.marks.join("")}  ${fmt(done.score)} pts\nssitari.github.io/FirstLevelGeoQuiz`;
    navigator.clipboard?.writeText(txt).then(() => { $("share-btn").textContent = "Copied!"; });
  };
}

// ─────────────────────────────────────────────────────────── misc helpers

function labelForMode(m) {
  return { novice: "Novice", intermediate: "Intermediate", ironman: "Ironman", daily: "Daily" }[m];
}
function updateHud() {
  $("hud-score").textContent = fmt(state.score);
  $("hud-streak").textContent = "×" + state.streakMult.toFixed(1);
  $("hud-q").textContent = state.cur && !$("game").hidden
    ? `Q ${Math.min(state.qi + 1, state.questions.length)}/${state.questions.length}`
    : "—";
}
function setMode(m) {
  [...document.querySelectorAll("#modes button")].forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
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

  $("help-btn").onclick = () => { $("help").hidden = false; };
  $("help-close").onclick = () => { $("help").hidden = true; };
  $("help").onclick = (e) => { if (e.target.id === "help") $("help").hidden = true; };
}
function hlAc() {
  const ac = $("ac");
  [...ac.children].forEach((li, i) => li.classList.toggle("hl", i === state.acHi));
}

// ─────────────────────────────────────────────────────────── boot

Promise.all([
  d3.json(cfg.DATA_FILE),
  d3.json(cfg.MANIFEST_FILE),
]).then(([topo, manifest]) => {
  const obj = topo.objects[Object.keys(topo.objects)[0]];
  ALL = topojson.feature(topo, obj).features.map(toRecord).filter((r) => r.name && r.geom);
  MANIFEST = manifest;
  document.title = cfg.APP_TITLE;
  for (const r of ALL) {
    if (!BY_A3.has(r.a3)) BY_A3.set(r.a3, []);
    BY_A3.get(r.a3).push(r);
  }
  document.getElementById("credit").innerHTML = cfg.CREDIT_HTML
    + ` &nbsp;·&nbsp; ${fmt(ALL.length)} units · ${MANIFEST.countries.length} countries · data ${manifest.generated}`;
  wire();
  setMode("intermediate");
  $("start-btn").disabled = false;
  showSetup();
}).catch((err) => {
  $("setup-title").textContent = "Couldn't load the data";
  $("setup-desc").textContent = String(err) + " — is this being served over http:// (not opened as a file)?";
});
