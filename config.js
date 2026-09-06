// ============================================================
//  config.js  —  all the tunable knobs for the quiz
//  The engine lives in app.js; you shouldn't need to touch it.
// ============================================================

export const APP_TITLE = "First-Level Geo Quiz";

export const CREDIT_HTML = `
  Boundaries & place names: <a href="https://www.naturalearthdata.com/" rel="noopener" target="_blank">Natural Earth</a>
  1:10m Admin&nbsp;1 (public domain). Prominence &amp; difficulty are estimated from unit
  area, largest-city population and capital status. Method notes &amp; source:
  <a href="https://github.com/ssitari/FirstLevelGeoQuiz" rel="noopener" target="_blank">ssitari/FirstLevelGeoQuiz</a>.
`;

export const DATA_FILE = "./data/admin1.topojson";
export const MANIFEST_FILE = "./data/manifest.json";

// ── Community stats (optional) ──────────────────────────────
// Base URL of the Cloudflare Worker in worker/. Empty string = fully disabled:
// no network calls, no "X% of players" line, the 📊 button is hidden.
export const STATS_API = "";
// Don't show a per-unit solve rate until this many people have seen it.
export const STATS_MIN_SAMPLE = 15;
// Re-fetch the aggregate at most this often (cached in localStorage between).
export const STATS_REFRESH_MIN = 10;

// ── Round length ────────────────────────────────────────────
export const ROUND_LENGTH = 10;
export const DAILY_LENGTH = 5;

// ── Scoring ─────────────────────────────────────────────────
// A correct answer is worth BASE_POINTS[mode], reduced by penalties.
export const BASE_POINTS = {
  novice: 500,
  intermediate: 800,
  ironman: 1200,
  daily: 1000,
};

// Hints cost a fraction of base, subtracted cumulatively. "huge deduction."
export const HINT_PENALTY = {
  continent: 0.30,
  country: 0.45,
  city: 0.20,
  // novice-mode ladder (continent/country are giveaways there)
  scale: 0.25,
  region: 0.35,
  letters: 0.20,
};

export const WRONG_PENALTY = 0.08;   // fraction of base per wrong guess
export const MIN_FRACTION = 0.05;    // floor payout for a correct answer
export const MAX_WRONG = 6;          // wrong guesses before the answer is revealed

// Optional decaying time bonus (fraction of base, added on top).
export const TIME_BONUS = { enabled: true, fullMs: 8000, zeroMs: 45000, max: 0.4 };

// Clean-solve streak multiplier (no hints, ≤1 wrong guess).
export const STREAK = { step: 0.1, cap: 2.0 };

// ── Intermediate / Daily sampling ───────────────────────────
// Each unit carries a "prom" (prominence) score from the build step. Higher =
// more likely a worldly person recognizes it. Intermediate draws each question
// with probability proportional to max(0, prom - INTERMEDIATE_FLOOR) ^ exponent,
// so the obscure long tail is effectively excluded without a hard cutoff.
export const INTERMEDIATE_FLOOR = 3.2;
export const INTERMEDIATE_EXPONENT = 2.0;
// Within one round, each extra question from a country already used is scaled
// down by this factor — keeps a round from turning into "name 8 US states".
export const COUNTRY_DECAY = 0.18;
// Daily draws only from these tiers (then weights by prom) — fair for everyone.
export const DAILY_TIERS = ["easy"];

// Each unit also carries a "distinct" (0..1) shape-distinctiveness score. A
// featureless desert oblast or a rectangular plains state scores near 0 — nobody
// can identify those from an outline — so Intermediate/Daily scale a question's
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
  intermediate: ["continent", "country", "city"],
  ironman: ["continent", "country", "city"],
  daily: ["continent", "country", "city"],
  novice: ["scale", "region", "letters"],
};

// ── Look ─────────────────────────────────────────────────────
export const SILHOUETTE = {
  fill: "#2b3a4a",
  revealFill: "#c8542b",
  siblingFill: "#d9d5cd",
  siblingStroke: "#b9b3a7",
  padding: 26,
};

// Minimum characters before an alternate name is accepted as a full answer
// (keeps 2-letter postal codes from matching everything).
export const MIN_ALT_LEN = 4;
