# flgq-stats — community stats backend

A single Cloudflare Worker + a D1 (SQLite) table holding anonymous aggregate
counters, one row per first-level admin unit: how often it's shown, solved,
solved with no hints, given up on. No user identity, no per-game rows.

The site works fine without this — `STATS_API` empty in `config.js` disables all
stats (no reads, no writes, the 📊 button hides).

## Deploy

This is a **separate** Worker from the site (the site is deployed straight from the
repo). Testers never see this URL — the page calls it in the background.

```bash
cd worker
npx wrangler login                  # browser OAuth

npx wrangler d1 create flgq-stats
#   -> prints a database_id; paste it into wrangler.toml

npx wrangler d1 execute flgq-stats --remote --file=schema.sql
npx wrangler deploy
#   -> deploys as https://firstlevelgeoquiz-stats.<your-subdomain>.workers.dev
```

Then set that URL as `STATS_API` in `config.js`, commit, push — the site redeploys
and stats turn on.

## Endpoints

- `POST /report` — body `{ mode, results: [ { unit, solved, clean, wrong, hints, gaveUp } ] }`.
  Called once per finished round via a `keepalive` fetch with a `text/plain` body
  — a CORS "simple request", so there's no preflight and the wildcard ACAO is
  accepted. Validates ranges, dedupes units within a payload, batches the upserts.
  The page skips the call entirely for anyone sending Global Privacy Control or
  Do Not Track, or who has switched reporting off in the footer.
- `GET /stats` — the whole table as `{ generated, count, units: { id: {...} } }`.
  Edge-cached 2 minutes (`STATS_REFRESH_MIN` in `config.js` caches it ~10 minutes
  in the visitor's `localStorage` on top of that).

## Notes

- The quiz answer is reachable in client JS, so these numbers are **spoofable** —
  fine for "huh, interesting", not for anything load-bearing. If it matters later,
  add a Cloudflare Rate Limiting rule on `/report` or a KV per-IP throttle.
- Free tier limits (100k Worker req/day, 100k D1 writes/day, 5M reads/day) are far
  above what a test group will generate.
- Inspect the data any time: `wrangler d1 execute flgq-stats --remote --command "SELECT unit_id, shown, solved FROM unit_stats ORDER BY shown DESC LIMIT 20"`
