// ── DESIGN TOKENS ────────────────────────────────────────────────────────────
// Palette direction: "coastal atelier" — deep slate-teal and dusty sea-blue,
// warm clay and sand, sage, a warm off-white ground, and one true black used
// sparingly for high-emphasis moments. Sourced from a beach-toned gradient
// (stacked circles: espresso brown → clay → dusty teal → sea-foam → white)
// and a material flat-lay (slate-teal glass, charcoal, teal-green, greige,
// cream, eucalyptus, and matte black). Every key name below is unchanged from
// before — only the values moved — so nothing downstream needs to change.
// Palette direction: BRIGHT MODERN SaaS — a dark navy structural frame (sidebar,
// headings) over a light page with pure-white cards, a green primary brand, and
// clean cool-grey neutrals. Aligned with the Dashboard's bright palette so the
// whole app now reads as one system. Key names are unchanged, so every component
// that references C.* picks up the new look automatically.
export const C = {
  navy:        "#0F172A",   // deep slate — sidebar + structural dark, primary headings
  navyMid:     "#1E293B",   // secondary structural dark
  black:       "#0B1220",   // near-black — reserved for high-emphasis accents only (see usage note below)
  teal:        "#16A34A",   // PRIMARY BRAND — green (buttons, active nav, primary CTAs)
  tealLight:   "#34D399",   // lighter emerald accent
  tealFaint:   "#DCFCE7",   // pale green wash (chips, icon backgrounds)
  amber:       "#D97706",   // bright amber — warnings / maintenance
  amberFaint:  "#FEF3C7",   // pale amber wash
  red:         "#EF4444",   // bright red — errors / overdue
  redFaint:    "#FDECEC",   // pale red wash
  green:       "#16A34A",   // success / available (same green as the brand)
  greenFaint:  "#E7F7EE",   // pale green wash
  blue:        "#2563EB",   // on-rental / in-use status + info accents
  blueFaint:   "#EAF1FE",   // pale blue wash
  purple:      "#8B5CF6",   // customers / secondary categorical accent
  purpleFaint: "#F1ECFE",   // pale purple wash
  bg:          "#F4F6FB",   // light page background (cool off-white)
  surface:     "#FFFFFF",   // pure white card surface
  border:      "#EAEDF2",   // light cool border
  linen:       "#EEF1F6",   // very light divider / track
  textPri:     "#0F172A",   // dark slate — primary reading text / headings
  textSec:     "#334155",   // secondary slate text
  textMuted:   "#64748B",   // muted cool-grey text
};

// C.black is intentionally not wired into every component — it's the one
// deliberate risk in this palette (the "sunglasses" note), meant for a single
// signature use per screen: e.g. a plate badge, a primary CTA, or a divider
// that needs to read as ink rather than navy. Reach for it sparingly.

export const mono = { fontFamily: "'JetBrains Mono', 'Courier New', monospace" };

// ── HELPERS ──────────────────────────────────────────────────────────────────
export const fmt = (n) => `SGD ${n.toLocaleString()}`;
// Total Investment for one car = Purchase + Purchase Advance + Insurance +
// Registration + Other Charges. Every field is guarded so a null column from
// the DB can't turn the whole sum into NaN.
export const totalInv = (c) => (c.purchase || 0) + (c.purchaseAdvance || 0) + (c.insurance || 0) + (c.reg || 0) + (c.otherCharges || 0);
// Single source of truth for "today" across every date-driven calculation in
// the app (COE/compliance countdowns here, and the target-option horizon in
// generateTargetOptions below). Uses the real current date (date-only, at UTC
// midnight to match the app's ISO date strings) so every "days remaining" /
// expiry status is accurate. Previously this was frozen to a fixed demo date,
// which made all expiry countdowns read wrong once the real date moved past it.
const APP_NOW = new Date(new Date().toISOString().slice(0, 10));
// NOTE: `coe` (a car's registration/ownership-renewal expiry date) is a Singapore-era field
// name kept as-is for data compatibility with existing fleet records. Every user-facing
// label has been renamed to "Registration Expiry" — see Fleet.jsx / Alert.jsx.
export const daysUntil = (d) => Math.ceil((new Date(d) - APP_NOW) / 86400000);

// ── FLEET ASSET VALUE (depreciation) ────────────────────────────────────────
// A car is worth its full Total Investment the day it's bought and ~nothing once
// its registration (the `coe` field) expires, so we straight-line its book value
// from the purchase date down to zero at the registration-expiry date. This is
// the asset counterpart to the auto "Vehicle Purchase" expense: buying a car
// doesn't destroy money, it converts cash into a depreciating asset.
//   value = totalInv × (timeLeftToExpiry / totalLife),  clamped to [0, cost]
// When the purchase/expiry dates are missing or nonsensical we hold the value at
// cost rather than guessing a life.
export const carAssetValue = (c) => {
  const cost = totalInv(c);
  if (cost <= 0) return 0;
  const start = c.purchaseDate ? new Date(c.purchaseDate) : null;
  const end = c.coe ? new Date(c.coe) : null;
  if (!start || !end || Number.isNaN(+start) || Number.isNaN(+end) || end <= start) return cost;
  const frac = Math.max(0, Math.min(1, (end - APP_NOW) / (end - start)));
  return Math.round(cost * frac);
};

// Total current book value of every car still owned in the fleet.
export const fleetAssetValue = (fleet = []) => fleet.reduce((s, c) => s + carAssetValue(c), 0);

// ── Selectable depreciation methods ─────────────────────────────────────────
// The Balance Sheet lets the user pick how a car's value is written down. All
// methods work off data the app already stores (cost, purchase date, COE date),
// so no extra inputs are needed beyond an annual % for the rate-based ones.
export const DEPRECIATION_METHODS = [
  { id: "coe",    label: "Straight-line → registration expiry", needsRate: false },
  { id: "wdv",    label: "Reducing balance (WDV)",              needsRate: true, defaultRate: 20 },
  { id: "slcost", label: "Straight-line, % of cost / year",     needsRate: true, defaultRate: 20 },
  { id: "manual", label: "Manual value (per car)",              needsRate: false },
];

// True when a car has a manually-entered value set (not null / blank).
export const hasManualValue = (c) =>
  c.manualValue !== null && c.manualValue !== undefined && c.manualValue !== "" && Number.isFinite(Number(c.manualValue));

// Whole years elapsed (fractional) since a car was bought — drives the annual
// rate methods. Missing/invalid purchase date → 0 (treated as brand new).
const yearsOwned = (c) => {
  const start = c.purchaseDate ? new Date(c.purchaseDate) : null;
  if (!start || Number.isNaN(+start)) return 0;
  return Math.max(0, (APP_NOW - start) / (365 * 86400000));
};

// One car's current value under the chosen method:
//   coe    → straight-line to registration expiry (see carAssetValue)
//   wdv    → reducing balance: cost × (1 − rate)^yearsOwned  (never reaches 0)
//   slcost → straight-line on cost: cost × (1 − rate × yearsOwned), floored at 0
export const carAssetValueBy = (c, method = "coe", ratePct = 20) => {
  const cost = totalInv(c);
  if (cost <= 0) return 0;
  if (method === "coe") return carAssetValue(c);
  // Manual: use the user-entered value when set, otherwise fall back to cost so
  // an un-valued car still contributes something to the total.
  if (method === "manual") return hasManualValue(c) ? Math.round(Number(c.manualValue)) : cost;
  const r = (Number(ratePct) || 0) / 100;
  const yrs = yearsOwned(c);
  if (method === "wdv") return Math.round(cost * Math.pow(Math.max(0, 1 - r), yrs));
  if (method === "slcost") return Math.round(cost * Math.max(0, 1 - r * yrs));
  return cost;
};

export const fleetAssetValueBy = (fleet = [], method = "coe", ratePct = 20) =>
  fleet.reduce((s, c) => s + carAssetValueBy(c, method, ratePct), 0);

// ── DAILY RATE BANDS (SGD/day) ──────────────────────────────────────────────
// Reference ranges so daily rates can be set sensibly per vehicle category
// instead of being an arbitrary number. Used as suggested min/max guardrails
// wherever a target or booking rate is entered.
// NOTE: these min/max figures were originally tuned for AED/Dubai pricing and
// haven't been re-checked against SGD/Singapore market rates — treat them as
// placeholders to revisit, not verified numbers.
export const RATE_BANDS = [
  { category: "Economy",     min: 90,  max: 150 },
  { category: "Compact/Sedan", min: 130, max: 220 },
  { category: "SUV",         min: 220, max: 450 },
  { category: "Luxury",      min: 450, max: 1200 },
  { category: "Exotic/Sports", min: 1200, max: 4000 },
];

// Suggests a market category (and its SGD/day band) from a car's target
// or asking rate, so the UI can flag "this looks low/high for its class".
export const suggestRateBand = (dailyRate) => {
  const rate = Number(dailyRate) || 0;
  return RATE_BANDS.find(b => rate >= b.min && rate <= b.max)
    || (rate > 0 ? RATE_BANDS[RATE_BANDS.length - 1] : RATE_BANDS[0]);
};

// ── TARGET RATE SUGGESTIONS (3-tier) ────────────────────────────────────────
// Given the car's Total Investment and when its COE runs out, generate 3 target
// options — Conservative / Balanced / Aggressive — each built around a target
// CAGR compounded over the years left to COE expiry. Total Investment is the
// ONLY calculation base — no maintenance cost is added:
//   1. Years        = (COE expiry date − purchase date) / 365
//   2. FV(tier)     = TotalInvestment × (1 + CAGR(tier)) ^ Years
//   3. MonthlyIncome(tier) = FV(tier) / (Years × 12)
//   4. DailyRate(tier)     = MonthlyIncome(tier) / RunningDays(tier)
//   5. Profit%(tier)       = (FV(tier) / TotalInvestment − 1) × 100
// Balanced is anchored at 11% CAGR — the actual investment goal — with
// Conservative/Aggressive as symmetric ±3pt offsets. Days/month assumed per
// tier fall as the tier gets more aggressive (25 → 22 → 18), so rate, and FV
// both rise Conservative → Balanced → Aggressive by construction — no
// clamping or reordering pass needed.
const CAGR_ANCHOR = 0.11;
const CAGR_OFFSET = 0.03;

const TIERS = [
  { label: "Conservative", cagr: CAGR_ANCHOR - CAGR_OFFSET, daysPerMonth: 25 },
  { label: "Balanced", cagr: CAGR_ANCHOR, daysPerMonth: 22 },
  { label: "Aggressive", cagr: CAGR_ANCHOR + CAGR_OFFSET, daysPerMonth: 18 },
];

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// investment: the car's Total Investment (purchase + insurance + registration +
//             other charges). This is the sole calculation base — no maintenance
//             cost is added.
// purchaseDate / coe: date strings. purchaseDate falls back to the app's fixed
//             "today" (APP_NOW) if missing, so older records without one still
//             generate options — and so the horizon doesn't silently change
//             depending on when the app happens to be run in real life.
// minRate / maxRate: no longer drive the math directly — rate is now purely a
//             function of the CAGR/FV formula above. Kept in the signature in
//             case you want to flag "this lands outside your stated band".
export const generateTargetOptions = ({ investment, purchaseDate, coe, minRate, maxRate }) => {
  // Total Investment is the only base — maintenance cost is intentionally excluded.
  const totalInvestment = investment;

  const start = purchaseDate ? new Date(purchaseDate) : APP_NOW;
  const end = new Date(coe);
  const rawDays = (end - start) / MS_PER_DAY;
  // Guard against a missing/past COE date collapsing the horizon to zero or negative.
  const daysToExpiry = Number.isFinite(rawDays) && rawDays > 30 ? rawDays : 30;
  const yearsToExpiry = daysToExpiry / 365;
  const monthsToExpiry = yearsToExpiry * 12;

  return TIERS.map(({ label, cagr, daysPerMonth }) => {
    const fv = totalInvestment * Math.pow(1 + cagr, yearsToExpiry);
    const monthlyIncome = fv / monthsToExpiry;
    const rate = monthlyIncome / daysPerMonth;
    const profitPct = (fv / totalInvestment - 1) * 100;

    return {
      label,
      rate: Math.round(rate),
      runningDays: daysPerMonth,
      monthlyIncome: Math.round(monthlyIncome),
      profitPct: Math.round(profitPct * 10) / 10,
      cagr: Math.round(cagr * 1000) / 10, // e.g. 0.11 -> 11 (%)
    };
  });
};