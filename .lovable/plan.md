> **Blocker to note first:** this Lovable project is still the empty starter template. The app (`src/lib/store.ts`, `supabase/migrations/*`) exists only inside the uploaded zip. Nothing below can be applied until the codebase is imported into this project and Cloud is enabled. The plan itself is ready to execute the moment it is.

## 1. Current state

**Meters do not exist.** There is no `meters` table. What the UI calls a "meter" is fabricated at hydration time in `store.ts`:

```text
customers.meter_number ─┐
                        ├─► addMeter(hashId(`${customerNum}|${number}`)) ─► in-memory Meter[]
water_readings.meter_number ─┘
```

- The meter's identity is a **client-side string hash** of customer + meter number, regenerated on every page load and persisted only in `localStorage` (`mizan-idmap-v1`).
- `idMap.meter` maps that fake numeric id to the *meter number string*, not a database row — unlike customers/readings/bills, which map to real UUIDs.
- Readings link to a meter by **text**: `water_readings.meter_number TEXT NOT NULL`, with no FK. Reading history, previous-reading lookup and anomaly detection in `tg_reading_before_insert` all join on `(tenant_id, meter_number)` string equality.
- `customers.meter_number` is nullable, non-unique, and free text (no trim/normalisation, no format check). `customers_tenant_meter_idx` is a plain index, not unique.
- A reading whose `customer_id` is null falls into a synthetic meter under `customer 0`; `water_readings.customer_id` is `ON DELETE SET NULL`, so deleting a customer orphans readings into that bucket.

**Risks to live data**
- Two customers can hold the same meter number → their readings merge into one consumption series → wrong previous-reading and wrong bills.
- Whitespace/Arabic-digit variants of the same number silently split one meter into two series, resetting `previous` to 0 and producing a huge first consumption.
- Changing `customers.meter_number` (meter replacement, data correction) silently rewrites history: all past readings under the old string detach, and the new string starts from 0.
- Meter ids reset on `localStorage` clear; a stale id map can point a capture at the wrong meter.

## 2. Target architecture

```text
customers ──< meter_assignments >── meters ──< water_readings
                (history)            (identity)     (facts)
```

**`public.meters`** — the single source of truth for meter identity:
`id uuid pk`, `tenant_id`, `meter_number text not null`, `meter_number_normalized text` (generated: trimmed, Arabic→Latin digits, upper), `type text default 'water'`, `status text` (`active | replaced | removed`), `installed_at`, `removed_at`, `initial_reading numeric default 0`, `replaced_by_meter_id uuid`, `notes`, timestamps.
Constraint: `UNIQUE (tenant_id, meter_number_normalized)` — one physical meter, one row, per tenant.

**`public.meter_assignments`** — who holds the meter, over time:
`id`, `tenant_id`, `meter_id → meters(id)`, `customer_id → customers(id)`, `assigned_at`, `unassigned_at null`, `assigned_by`, `reason`.
Partial unique indexes enforce: one open assignment per meter, and one open assignment per customer per meter. Current holder = row with `unassigned_at IS NULL`.

**`water_readings`** gains `meter_id uuid NOT NULL REFERENCES meters(id) ON DELETE RESTRICT`. `meter_number` is kept only as a frozen historical text snapshot (renamed `meter_number_snapshot`, nullable, never read by logic). `customer_id` becomes the *billing target resolved at capture time* — set from the open assignment, `ON DELETE RESTRICT` instead of `SET NULL`.

**Ownership of business rules** — all in the database, none in the client:
- `previous`, `consumption`, `flag`, `status` derived in `tg_reading_before_insert`, keyed on `meter_id` instead of `meter_number`.
- Previous reading is scoped to the *current assignment window* so a meter transferred to a new customer does not inherit the prior tenant's counter as consumption for them (counter continuity preserved; billing boundary respected).
- `assign_meter(_meter_id, _customer_id, _reason)` / `unassign_meter` / `replace_meter(_old, _new_number, _final_reading)` as `SECURITY DEFINER` RPCs with role checks. Clients never write `meter_assignments` directly.
- Reading capture goes through `capture_reading(_meter_id, _current, ...)` which resolves the customer from the open assignment — the client stops sending `customer_id` and `meter_number`.

## 3. Migration strategy

Non-destructive, in four ordered migrations; nothing is dropped until backfill is verified.

**M1 — create** `meters`, `meter_assignments`, normalisation function, grants, RLS (read: tenant; write: manager via `has_tenant_role`), and RPCs. Add `water_readings.meter_id` as **nullable**.

**M2 — backfill**
1. Insert one `meters` row per distinct normalized number found in `customers.meter_number` ∪ `water_readings.meter_number`, per tenant.
2. Open one `meter_assignments` row per customer that has a `meter_number`, `assigned_at = customers.created_at`.
3. Set `water_readings.meter_id` by normalized-number match.
4. Readings whose number matches no customer get a meter with no open assignment (status `active`, unassigned) — history preserved, nothing lost.

**Duplicates and conflicts** are surfaced, not auto-resolved:
- Same normalized number held by 2+ customers → meter created once, assignment given to the customer with the **earliest** `created_at`; the others are written to a `meter_migration_conflicts` audit table for manual review, and their readings stay attached to the shared meter.
- Whitespace/digit variants collapse into one meter — this *merges* previously split series and is the intended correction; the pre-merge variants are logged in the audit table.
- Null/empty meter numbers on customers → no meter, no assignment; flagged for data entry.

**M3 — enforce** (the destructive step, only after the conflict report is reviewed): `meter_id SET NOT NULL`, rewrite `tg_reading_before_insert` / `issue_bill_for_reading` to key on `meter_id`, rename `meter_number` → `meter_number_snapshot`, drop `customers.meter_number` (replaced by a `customer_current_meter` view for compatibility during the code cut-over), tighten `customer_id` FK.

**M4 — cleanup**: drop the compatibility view once the client no longer reads it.

Historical readings stay correct because `previous`/`consumption` values already stored are never recomputed — only future derivation changes key. The only intentional change to history is the variant merge, which is reported before M3 runs.

## 4. Implementation plan

**Code changes** (all in the imported app):
- `store.ts`: delete `addMeter`/`meterKey` synthesis entirely; hydrate `meters` from `select * from meters` and readings' `meter_id`. `idMap.meter` maps numeric id → **meter UUID**, same as every other entity.
- `addReadingWithBill` calls `capture_reading` RPC with `meter_id` only; stop sending `customer_id`, `meter_number`, `previous`, `consumption`.
- Customer create/edit stops writing `customers.meter_number`; meter assignment becomes an explicit action calling `assign_meter`.
- New Meters management surface: list, register meter, assign/unassign, replace, assignment history per meter.
- Offline sync, billing, payments, dashboard, AI, auth left untouched except for the mechanical `meter_number → meter_id` field rename where they read readings.

**Testing plan**
1. SQL fixtures for backfill: clean case, duplicate number across two customers, whitespace/Arabic-digit variants, reading with null customer, customer with null meter number — assert row counts and conflict-table contents.
2. Trigger tests: first reading on a new meter (`previous = initial_reading`), rollover/decrease → `flag = error`, >3× average → `suspicious`, reading after reassignment → previous scoped to the current window.
3. Constraint tests: duplicate meter number rejected, second open assignment for the same meter rejected, delete of a customer with readings rejected.
4. End-to-end in the preview: register meter → assign → capture reading → approve → bill issued with the correct consumption; then replace the meter and confirm history stays attached to the old meter.
5. Re-run the existing billing/payment flows unchanged to confirm no regression.

**Awaiting approval before M3** — the destructive step (dropping `customers.meter_number`, `NOT NULL` on `meter_id`) will not run until you review the conflict report from M2.
