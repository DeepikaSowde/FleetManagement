-- ============================================================================
-- FleetOpz — PostgreSQL schema
-- Run: psql -U postgres -d fleetopz -f src/config/schema.sql
--
-- Design notes:
--  * Date-ish fields are stored as TEXT (e.g. "2026-07-15", or a full ISO
--    datetime for booking start/end). The React frontend treats these as
--    plain strings for all its status/date math, so storing them as TEXT
--    round-trips them back byte-for-byte and keeps that logic working.
--  * Money fields are NUMERIC.
--  * Bookings keep the "core" fields the app filters/derives on as real
--    columns, and stash the many extra wizard fields (pricing breakdown,
--    additional drivers, logistics, etc.) in a JSONB `details` column so new
--    frontend fields don't require a migration.
-- ============================================================================

-- ── USERS (for login / JWT auth) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  username    VARCHAR(80) UNIQUE NOT NULL,     -- login handle
  password    VARCHAR(255) NOT NULL,           -- bcrypt hash, never plain text
  role        VARCHAR(20)  NOT NULL DEFAULT 'admin',  -- admin | staff
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ── CARS (the fleet) — keyed by number plate ────────────────────────────────
CREATE TABLE IF NOT EXISTS cars (
  plate                      VARCHAR(40) PRIMARY KEY,
  make                       VARCHAR(80),
  model                      VARCHAR(80),
  year                       INTEGER,
  color                      VARCHAR(40),
  purchase                   NUMERIC(12,2) DEFAULT 0,
  insurance                  NUMERIC(12,2) DEFAULT 0,
  reg                        NUMERIC(12,2) DEFAULT 0,
  other_charges              NUMERIC(12,2) DEFAULT 0,
  purchase_date              TEXT,
  maint                      NUMERIC(6,2)  DEFAULT 0,   -- annual maintenance % of investment
  coe                        TEXT,                       -- registration renewal / COE expiry date
  status                     VARCHAR(30)   DEFAULT 'Available',
  min_rate                   NUMERIC(12,2),
  max_rate                   NUMERIC(12,2),
  target_rate                NUMERIC(12,2),
  running_days_target        NUMERIC(12,2),
  profit_pct_target          NUMERIC(12,2),
  maintenance_start_date     TEXT,
  maintenance_completed_at   TEXT,
  maintenance_auto_released  BOOLEAN DEFAULT false,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── BOOKINGS — keyed by app-generated id (e.g. "BK-001") ────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id                    VARCHAR(20) PRIMARY KEY,
  plate                 VARCHAR(40) REFERENCES cars(plate) ON DELETE CASCADE,
  customer              VARCHAR(160),
  ic                    VARCHAR(80),         -- IC / Emirates ID / passport no.
  contact               VARCHAR(80),
  start                 TEXT,                -- pickup datetime (ISO string)
  "end"                 TEXT,                -- return datetime (ISO string)
  rate                  NUMERIC(12,2) DEFAULT 0,
  status                VARCHAR(30) DEFAULT 'Active',
  cancelled             BOOLEAN DEFAULT false,
  force_completed       BOOLEAN DEFAULT false,
  maintenance_triggered BOOLEAN DEFAULT false,
  details               JSONB  DEFAULT '{}'::jsonb,   -- passport, license, address, pricing, additionalDrivers, ...
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bookings_plate ON bookings (plate);

-- ── EARNINGS — keyed by app-generated id (e.g. "ER-001") ────────────────────
CREATE TABLE IF NOT EXISTS earnings (
  id          VARCHAR(20) PRIMARY KEY,
  booking_id  VARCHAR(20) REFERENCES bookings(id) ON DELETE SET NULL,
  plate       VARCHAR(40),
  customer    VARCHAR(160),
  start       TEXT,
  "end"       TEXT,
  days        INTEGER DEFAULT 0,
  rate        NUMERIC(12,2) DEFAULT 0,
  total       NUMERIC(12,2) DEFAULT 0,
  locked      BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_earnings_plate ON earnings (plate);

-- ── EXPENSES — keyed by app-generated id (e.g. "EX-001") ────────────────────
CREATE TABLE IF NOT EXISTS expenses (
  id          VARCHAR(20) PRIMARY KEY,
  plate       VARCHAR(40),
  date        TEXT,
  category    VARCHAR(80),
  "desc"      TEXT,
  amount      NUMERIC(12,2) DEFAULT 0,
  receipt     BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expenses_plate ON expenses (plate);

-- ── RESTRICTED LICENSES — driving-license blocklist (admin managed) ──────────
-- Booking creation is blocked if the driver's license number is on this list
-- (e.g. active criminal case, court restriction). Keyed by app-generated id.
CREATE TABLE IF NOT EXISTS restricted_licenses (
  id             VARCHAR(40) PRIMARY KEY,
  license_number VARCHAR(120) NOT NULL,
  reason         VARCHAR(200),
  added_date     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── SEED: sample fleet ──────────────────────────────────────────────────────
-- The original frontend shipped with these 8 demo cars (bookings/earnings/
-- expenses started empty). Seeded here so a fresh install isn't blank. Status
-- is stored as "Available"; the app derives live status from bookings anyway.
-- ON CONFLICT DO NOTHING makes re-running this file safe.
INSERT INTO cars (plate, make, model, year, color, purchase, insurance, reg, other_charges, purchase_date, maint, coe, status) VALUES
  ('SBA 1234 X', 'Toyota',  'Corolla', 2022, 'Silver', 26000, 1200, 1300, 0, '2022-01-15', 7.5, '2026-07-15', 'Available'),
  ('SBC 5678 Y', 'Honda',   'Civic',   2021, 'White',  22000, 1100, 1100, 0, '2021-03-10', 7.5, '2028-03-20', 'Available'),
  ('SBD 9012 Z', 'Mazda',   '3',       2023, 'Blue',   29000, 1400, 1600, 0, '2023-02-05', 7.5, '2028-11-10', 'Available'),
  ('SBE 3456 A', 'Nissan',  'Sylphy',  2022, 'Black',  24500, 1200, 1100, 0, '2022-06-20', 7.5, '2027-06-30', 'Available'),
  ('SBF 7890 B', 'Toyota',  'Vios',    2020, 'Red',    19500, 1000, 1000, 0, '2020-09-01', 9.0, '2025-09-15', 'Available'),
  ('SBG 1122 C', 'Honda',   'Jazz',    2021, 'Grey',   20500, 1050,  950, 0, '2021-08-22', 7.5, '2026-08-22', 'Available'),
  ('SBH 3344 D', 'Hyundai', 'Elantra', 2023, 'White',  25000, 1150, 1200, 0, '2023-01-05', 7.5, '2029-01-05', 'Available'),
  ('SBI 5566 E', 'Kia',     'Cerato',  2022, 'Silver', 23000, 1100, 1050, 0, '2022-10-18', 7.5, '2027-10-18', 'Available')
ON CONFLICT (plate) DO NOTHING;
