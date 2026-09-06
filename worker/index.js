// Community-stats backend for First-Level Geo Quiz.
//
//   POST /report  { mode, results: [ { unit, solved, clean, wrong, hints, gaveUp } ] }
//                 -> upserts aggregate counters, one row per unit. Fire-and-forget.
//   GET  /stats   -> { generated, count, units: { unit_id: {shown, solved, ...} } }
//                    edge-cached ~10 min so D1 isn't hit on every page load.
//
// Anonymous aggregates only. No identity, no per-game rows, no cookies.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const clampInt = (v, max) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0;
};

// rec.id is normally a Natural Earth adm1_code ("DEU-1520"); the build's fallback
// id is "<A3>-<name>". Allow both; reject anything with control chars or markup.
const UNIT_RE = /^[A-Za-z0-9 ._'()-]{2,80}$/;

export default {
  async fetch(req, env, ctx) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);

    // ---- GET /stats -------------------------------------------------------
    if (req.method === "GET" && url.pathname === "/stats") {
      const cache = caches.default;
      const cacheKey = new Request(new URL("/stats", url.origin).toString());
      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      const { results } = await env.DB.prepare(
        `SELECT unit_id, shown, solved, solved_clean, wrong_total, hints_total, gave_up
         FROM unit_stats WHERE shown > 0`,
      ).all();

      const units = {};
      for (const r of results) {
        units[r.unit_id] = {
          shown: r.shown,
          solved: r.solved,
          solved_clean: r.solved_clean,
          wrong_total: r.wrong_total,
          hints_total: r.hints_total,
          gave_up: r.gave_up,
        };
      }
      const res = json({ generated: Date.now(), count: results.length, units });
      res.headers.set("Cache-Control", "public, max-age=600");
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return res;
    }

    // ---- POST /report ---------------------------------------------------
    if (req.method === "POST" && url.pathname === "/report") {
      let payload;
      try {
        payload = await req.json();
      } catch {
        return json({ error: "bad json" }, 400);
      }
      const rows = Array.isArray(payload && payload.results)
        ? payload.results.slice(0, 40)
        : [];
      if (!rows.length) return json({ error: "no results" }, 400);

      const now = Date.now();
      const seen = new Set();
      const stmts = [];
      for (const r of rows) {
        const unit = r && r.unit;
        if (typeof unit !== "string" || !UNIT_RE.test(unit) || seen.has(unit)) continue;
        seen.add(unit);
        const solved = r.solved ? 1 : 0;
        const clean = solved && r.clean ? 1 : 0;
        const wrong = clampInt(r.wrong, 12);
        const hints = clampInt(r.hints, 5);
        const gaveUp = !solved && r.gaveUp ? 1 : 0;
        stmts.push(
          env.DB.prepare(
            `INSERT INTO unit_stats
               (unit_id, shown, solved, solved_clean, wrong_total, hints_total, gave_up, updated_at)
             VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(unit_id) DO UPDATE SET
               shown        = shown + 1,
               solved       = solved + ?2,
               solved_clean = solved_clean + ?3,
               wrong_total  = wrong_total + ?4,
               hints_total  = hints_total + ?5,
               gave_up      = gave_up + ?6,
               updated_at   = ?7`,
          ).bind(unit, solved, clean, wrong, hints, gaveUp, now),
        );
      }
      if (!stmts.length) return json({ error: "no valid rows" }, 400);
      await env.DB.batch(stmts);
      return json({ ok: true, written: stmts.length });
    }

    return json({ error: "not found" }, 404);
  },
};
