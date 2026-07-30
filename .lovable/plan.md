# Meter & Reading Architecture Migration Plan

## 1. Current state (verified against the live imported data)

- 100 customers, each with exactly one non-empty `meter_number`; 100 distinct meter numbers.
- 1,000 readings, all with a `customer_id`; 100 distinct `meter_number` values; **zero** cases of one meter number mapping to two customers.
- No meter table exists. Meters are invented in the browser (`src/lib/store.ts`) by hashing `customer_id + meter_number` into a numeric id that is not stable across sessions.
- Readings join to a "meter" by free-text string match on `meter_number`; previous-reading lookup in `tg_reading_before_insert` also matches on that string.
- Consequence: renaming or replacing a meter breaks history, and there are two competing meter models (DB text field vs. client-synthesized object).

Good news: the data is clean and 1:1, so the backfill is deterministic with no duplicate-merge or ambiguity handling needed.

## 2. Target architecture

```text
customers ──< meter_assignments >── meters ──< water_readings
              (history, time-boxed)         (meter_id FK)
```

- **meters** — the physical asset. Owns `serial` (the meter number, unique per tenant, normalized/trimmed/uppercased), type, size, install date, status (`active` / `removed` / `faulty`), initial index.
- **meter_assignments** — which meter served which customer over which time window (`started_at`, `ended_at`). At most one open assignment per meter, and at most one open assignment per customer.
- **water_readings** — gains `meter_id UUID NOT NULL` (after backfill). `customer_id` becomes a *derived, denormalized* column, resolved by trigger from the open assignment at reading date; it stays for billing joins but is never authored by the client.

**Source of truth after migration**
- Meter identity: `meters.serial`. Nothing else names a meter.
- Customer↔meter relation: `meter_assignments` only. `customers.meter_number` is dropped.
- Reading→meter: `water_readings.meter_id` only. `water_readings.meter_number` is dropped.
- Previous index / consumption: computed in the database from prior readings of the same `meter_id`, not on the client.

One meter model, in the database. The client stops synthesizing meters entirely.

## 3. Migration steps

**M1 — Foundation (additive, reversible)**
- Create `meters`, `meter_assignments` with GRANTs, RLS (tenant read; manager write) and `updated_at` triggers.
- Add nullable `water_readings.meter_id`.
- Add RPCs: `assign_meter`, `replace_meter`, `unassign_meter` (SECURITY DEFINER, manager-gated, `search_path=public`).

**M2 — Backfill (data only, idempotent)**
- Insert one `meters` row per distinct normalized `customers.meter_number`.
- Insert one `meters` row for any reading `meter_number` not present on a customer (currently zero, but the script covers it).
- Insert one open `meter_assignments` row per customer, `started_at` = earliest reading date for that meter (fallback `customers.created_at`).
- Set `water_readings.meter_id` by normalized serial match. Verify 1,000/1,000 linked.

**M3 — Enforcement (destructive, run only after M2 verification passes)**
- `water_readings.meter_id` → `NOT NULL` + FK `ON DELETE RESTRICT`.
- Rewrite `tg_reading_before_insert` to look up previous index by `meter_id` and to resolve `customer_id` from the open assignment.
- Drop `water_readings.meter_number` and `customers.meter_number`.
- Add unique index preventing two readings for the same meter on the same date.

**M4 — Cleanup**
- Remove the client hashing/synthesis path. No compatibility view is left behind.

## 4. Tables affected

| Table | Change |
|---|---|
| `meters` | new |
| `meter_assignments` | new |
| `water_readings` | `+meter_id` (NOT NULL, FK), `-meter_number` |
| `customers` | `-meter_number` |
| `water_bills`, `payments` | untouched — they key off `customer_id`/`reading_id`, both preserved |
| `tenancy_logs` | keeps its own `meter_number` text for now; superseded by assignments in a later pass |

## 5. Data transformation

- Normalize serial = `upper(btrim(meter_number))`.
- Match is exact on the normalized serial; verified unambiguous today.
- Assignment window start = earliest reading date per meter; end = NULL (open).
- Readings keep their ids, dates, indexes, consumption, status, flags and their `reading_id` links from bills — billing integrity is untouched.
- Every M2 statement is `ON CONFLICT DO NOTHING` / `WHERE meter_id IS NULL`, so re-running is safe.

## 6. Rollback considerations

- M1 and M2 are fully reversible: drop the two new tables and the `meter_id` column; the legacy text columns are still there and still authoritative.
- M3 is the point of no return because it drops the text columns. Before running it: take a snapshot of `customers(id, meter_number)` and `water_readings(id, meter_number)` into `public._meter_migration_backup_*` tables, kept until you confirm the app is healthy, then dropped in M4.
- If M3 fails mid-way it is a single transaction, so it rolls back whole.

## 7. Application changes

- `src/lib/store.ts`: delete `hashId`-based meter synthesis and `idMap.meter`; load real meters and assignments from the DB; readings carry `meter_id` UUIDs.
- `src/routes/readings.tsx`: meter picker selects a `meters` row (by serial) instead of typing a string; submits `meter_id`; stops sending `meter_number`, `previous`, `consumption`.
- `src/lib/sync.ts`: offline queue payload carries `meter_id`; keeps `client_uuid` idempotency.
- `src/routes/customers.tsx`: meter number on the customer form becomes "assign meter" (creates/attaches a meter via RPC) rather than a free-text field.
- `src/components/subscriber-search.tsx`, `bills.tsx`, `index.tsx`, `loss-analysis.tsx`, `ai-intent.ts`: read serial via the meter relation.

## 8. Testing plan

Before M3:
- Row counts unchanged: customers 100, readings 1,000, bills 1,992, payments 890.
- `SELECT count(*) FROM water_readings WHERE meter_id IS NULL` = 0.
- Every meter has exactly one open assignment; no customer has two.
- Per-meter reading history recomputed by `meter_id` matches the existing `previous`/`consumption` chain.

After M3:
- Submit a new reading through the UI → correct previous index, consumption, and auto-issued bill.
- Submit a lower-than-previous reading → flagged and held for approval.
- Run `replace_meter` on a customer → old assignment closed, new meter opens, old readings still attached to the old meter, next reading starts from the new meter's initial index.
- Offline queue: submit while offline, reconnect, confirm exactly one reading (idempotency holds).
- Typecheck + full page walk of readings, customers, bills, dashboard.

## 9. Risks

- **Meter replacement semantics**: consumption across a replacement must not be computed as `new_index − old_index`. Handled by scoping previous-index lookup to `(meter_id, assignment window)` and seeding from `meters.initial_index`.
- **Dropping `customers.meter_number`** breaks any query I miss; mitigated by typecheck plus a repo-wide grep before M3, and by the backup tables.
- **Offline clients** holding queued readings with the old payload shape at cutover — the queue is drained and the payload version is bumped so stale entries are rejected rather than silently misfiled.
- Existing SECURITY DEFINER RPCs already trip linter warnings; the new RPCs will be written with explicit role gates and pinned `search_path`.

Approve and I will run M1 + M2 first, show you the verification output, then run M3 and the app changes.