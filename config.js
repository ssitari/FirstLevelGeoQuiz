// ============================================================
//  config.js  —  all the tunable knobs for the quiz
//  The engine lives in app.js; you shouldn't need to touch it.
// ============================================================

export const APP_TITLE = "Subnational Geography Map Quiz";

// NOTE: repo link intentionally omitted during the private testing phase.
// Restore it (and re-enable GitHub Pages) when the project goes public.
export const CREDIT_HTML = `
  Boundaries &amp; place names: <a href="https://www.naturalearthdata.com/" rel="noopener" target="_blank">Natural Earth</a>
  1:10m Admin&nbsp;1 (public domain); Kenya, Nepal, DR&nbsp;Congo, Morocco &amp; Palestine subdivisions from
  <a href="https://www.geoboundaries.org/" rel="noopener" target="_blank">geoBoundaries</a> (CC&nbsp;BY&nbsp;3.0&nbsp;IGO).
  Prominence &amp; difficulty are estimated from unit area, largest-city population and capital status.
`;

export const DATA_FILE = "./data/admin1.topojson";
export const MANIFEST_FILE = "./data/manifest.json";
// Dissolved world coastline for the reveal's globe inset (~31 KB). If it fails
// to load the globe is simply hidden; nothing else depends on it.
export const LAND_FILE = "./data/land.topojson";

// ── Community stats (optional) ──────────────────────────────
// Base URL of the Cloudflare Worker in worker/. Empty string = fully disabled:
// no network calls, no "X% of players" line, the 📊 button is hidden.
export const STATS_API = "https://firstlevelgeoquiz-stats.metaalias.workers.dev";
// Reporting is skipped entirely for anyone sending Global Privacy Control or
// Do Not Track, and for anyone who has switched it off in the page footer.
export const STATS_MIN_SAMPLE = 15;
// Re-fetch the aggregate at most this often (cached in localStorage between).
export const STATS_REFRESH_MIN = 10;

// ── Round length ────────────────────────────────────────────
export const ROUND_LENGTH = 10;
export const DAILY_LENGTH = 5;

// Countries with fewer playable units than this are left out of the Novice
// picker. At 1 the round was a single question whose answer the autocomplete
// offered on the second keystroke.
export const MIN_NOVICE_UNITS = 4;

// ── Scoring ─────────────────────────────────────────────────
// A correct answer is worth BASE_POINTS[mode], reduced by penalties.
export const BASE_POINTS = {
  novice: 500,
  hard: 800,
  ironman: 1200,
  daily: 1000,
};

// What a hint costs when you *buy* it rather than earn it with a miss, as a
// fraction of base, subtracted cumulatively.
export const HINT_PENALTY = {
  continent: 0.30,
  country: 0.45,
  city: 0.20,
  // novice-mode ladder (continent/country are giveaways there)
  scale: 0.25,
  region: 0.35,
  letters: 0.20,
};

// A miss costs this much and reveals the next rung of the ladder — the rung it
// reveals is free. Charging for both (which is what the code used to do) meant
// 1 wrong = 0.62 of base and 2 wrong = 0.09: the round was decided by the second
// guess and the remaining four were worth nothing. One charge, larger, gives a
// legible ladder instead: 0.83 / 0.66 / 0.49 / 0.32 / 0.15.
export const WRONG_PENALTY = 0.17;   // fraction of base per wrong guess
export const MIN_FRACTION = 0.05;    // floor payout for a correct answer
export const MAX_WRONG = 6;          // wrong guesses before the answer is revealed
export const CLEAN_MAX_WRONG = 1;    // misses still allowed by a "clean" solve

// Decaying time bonus, applied as a multiplier on what you actually earned
// (base × penalties × (1 + bonus)) rather than added flat on top of base. Added
// flat, a fast solve with a wrong guess outscored a slow clean one — 816 vs 800
// on an 800-point question — which is backwards for a quiz about knowing things.
export const TIME_BONUS = { enabled: true, fullMs: 8000, zeroMs: 45000, max: 0.4 };

// Clean-solve streak multiplier (no hints, ≤1 wrong guess).
export const STREAK = { step: 0.1, cap: 2.0 };

// ── Hard / Daily sampling ───────────────────────────────────
// Each unit carries a "prom" (prominence) score from the build step. Higher =
// more likely a worldly person recognizes it. Hard mode draws each question
// with probability proportional to max(0, prom - HARD_FLOOR) ^ exponent,
// so the obscure long tail is effectively excluded without a hard cutoff.
export const HARD_FLOOR = 3.2;
export const HARD_EXPONENT = 2.0;
// Within one round, each extra question from a country already used is scaled
// down by this factor — keeps a round from turning into "name 8 US states".
export const COUNTRY_DECAY = 0.18;
// Daily draws only from these tiers (then weights by prom) — fair for everyone.
export const DAILY_TIERS = ["easy"];

// Each unit also carries a "distinct" (0..1) shape-distinctiveness score. A
// featureless desert oblast or a rectangular plains state scores near 0 — nobody
// can identify those from an outline — so Hard/Daily scale a question's
// draw weight by distinct ^ DISTINCT_WEIGHT_EXP (floored so it never hits zero).
export const DISTINCT_WEIGHT_EXP = 1.5;
export const DISTINCT_WEIGHT_MIN = 0.05;

// Distinctiveness → scoring. 0 = off (recommended: it's invisible to the player,
// so a points swing feels arbitrary, and it partly double-counts prominence).
// A value like 0.25 makes a featureless shape worth up to +25% and a very
// distinctive one up to −25%.
export const DISTINCT_SCORING = 0;

// ── Hint ladder per mode ────────────────────────────────────
// Each miss reveals the next rung; players can also buy the next rung early.
export const HINT_LADDER = {
  hard: ["continent", "country", "city"],
  ironman: ["continent", "country", "city"],
  daily: ["continent", "country", "city"],
  novice: ["scale", "region", "letters"],
};

// ── Look ─────────────────────────────────────────────────────
export const SILHOUETTE = {
  fill: "#2b3a4a",
  revealFill: "#c8542b",
  siblingFill: "#d9d5cd",
  siblingStroke: "#7d7669",
  padding: 26,
};

// The reveal's globe inset — an orthographic view centred on the answer, so the
// surrounding coastline says where on Earth you were.
export const GLOBE = {
  ocean: "#dde5ea",
  land: "#c9c4ba",
  landStroke: "#a9a399",
  graticule: "#ffffff",
  marker: "#c8542b",
};

// Minimum characters before an alternate name is accepted as a full answer
// (keeps 2-letter postal codes from matching everything).
export const MIN_ALT_LEN = 4;
