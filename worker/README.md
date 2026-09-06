# flgq-stats — community stats backend

A single Cloudflare Worker + a D1 (SQLite) table holding anonymous aggregate
counters, one row per first-level admin unit: how often it's shown, solved,
solved with no hints, given up on. No user identity, no per-game rows.

The site works fine without this — `STATS_API` empty in `config.js` disables all
stats (no reads, no writes, the 📊 button hides).

## Deploy

```bash
npm install -g wrangler      # or use `npx wrangler ...` below

cd worker
wrangler login               # browser OAuth

wrangler d1 create flgq-stats
#   -> prints a database_id; paste it into wrangler.toml

wrangler d1 execute flgq-stats --remote --file=schema.sql
wrangler deploy
#   -> prints the Worker URL, e.g. https://flgq-stats.<you>.workers.dev
```

Then set it in the site config:

```js
// config.js
export const STATS_API = "https://flgq-stats.<you>.workers.dev";
```

Commit that and redeploy the site.

## Endpoints

- `POST /report` — body `{ mode, results: [ { unit, solved, clean, wrong, hints, gaveUp } ] }`.
  Called once per finished round via `navigator.sendBeacon`. Validates ranges,
  dedupes units within a payload, batches the upserts.
- `GET /stats` — the whole table as `{ generated, count, units: { id: {...} } }`.
  Edge-cached 10 minutes; the site also caches it in `localStorage`.

## Notes

- The quiz answer is reachable in client JS, so these numbers are **spoofable** —
  fine for "huh, interesting", not for anything load-bearing. If it matters later,
  add a Cloudflare Rate Limiting rule on `/report` or a KV per-IP throttle.
- Free tier limits (100k Worker req/day, 100k D1 writes/day, 5M reads/day) are far
  above what a test group will generate.
- Inspect the data any time: `wrangler d1 execute flgq-stats --remote --command "SELECT unit_id, shown, solved FROM unit_stats ORDER BY shown DESC LIMIT 20"`
