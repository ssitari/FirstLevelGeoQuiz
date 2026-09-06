-- Aggregate, anonymous per-unit outcome counters. No user identity, no rows per
-- game — just running totals. One row per first-level admin unit.

CREATE TABLE IF NOT EXISTS unit_stats (
  unit_id      TEXT PRIMARY KEY,   -- rec.id (Natural Earth adm1_code, e.g. "DEU-1520")
  shown        INTEGER NOT NULL DEFAULT 0,
  solved       INTEGER NOT NULL DEFAULT 0,
  solved_clean INTEGER NOT NULL DEFAULT 0,   -- solved, no hints, <=1 wrong guess
  wrong_total  INTEGER NOT NULL DEFAULT 0,   -- sum of wrong guesses across all plays
  hints_total  INTEGER NOT NULL DEFAULT 0,
  gave_up      INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL DEFAULT 0    -- ms epoch of last write
);
