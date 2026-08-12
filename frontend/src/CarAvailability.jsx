import { useState, useMemo, useEffect } from "react";

// ============================================================================
// Car Availability — stepped search UI (redesigned):
//   1) Select Dates  → pick pickup + return date, Search Availability
//   2) Available Car Brands → brand cards with per-brand available counts
//   3) <Brand> – Available Cars → cards showing each car's CONTINUOUS
//      availability window from the pickup date (Available From / Until / how
//      many days), with Select Car + View Details (monthly calendar).
//
// Availability is computed from the REAL bookings loaded from the backend (the
// same data useFleetData exposes), using the same half-open overlap rule as
// useFleetData.rangesOverlap so this always agrees with checkBookingConflict.
// Brand is derived from `model` (Fleet has no brand field). Green accent is kept
// LOCAL to this page; the rest of the app stays navy/teal.
// ============================================================================

const G = {
  primary: "#14513a",       // deep forest green — buttons, step badges
  primaryHover: "#0f3f2d",
  primaryDark: "#0e3b2a",
  accent: "#1a7a4d",        // green accents / big numbers / links
  primarySoft: "#e7f2ec",   // light green tint — days box, selected card
  primarySofter: "#f1f7f3",
  ink: "#18271f",
  text: "#586b60",
  textMuted: "#8a988f",
  border: "#e4e9e4",
  borderStrong: "#d1dad2",
  surface: "#ffffff",
  page: "#f4f7f4",
  info: "#eef4ff",
  infoText: "#3559a6",
  infoBorder: "#d6e2f7",
  danger: "#b91c1c",
  dangerSoft: "#fbe7e7",
};

const AVAIL = { bg: "#e3f4e8", text: "#1b7a3f", dot: "#2fa15a" };

const BRAND_TINTS = ["#14513a", "#3B6E8C", "#8C5A3B", "#6B4B8C", "#8C3B5E", "#3B8C6E"];
const brandTint = (name) => BRAND_TINTS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % BRAND_TINTS.length];

const KNOWN_BRANDS = [
  "Maruti Suzuki", "Tata", "Mahindra", "Hyundai", "Honda", "Toyota",
  "Kia", "Renault", "Nissan", "Volkswagen", "Skoda", "Ford", "MG",
  "BMW", "Mercedes-Benz", "Audi", "Jeep", "Isuzu", "Chevrolet", "Datsun",
  "Mazda",
];
const BRAND_MATCHERS = [...KNOWN_BRANDS].sort((a, b) => b.length - a.length);

export function deriveBrand(model) {
  if (!model) return "Other";
  const lower = model.toLowerCase();
  const match = BRAND_MATCHERS.find(b => lower.includes(b.toLowerCase()));
  return match || model.trim().split(/\s+/)[0];
}

const brandInitial = (b) => b.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

// ── Date helpers (dates handled as plain ISO strings, same as the backend) ──
const pad2 = (n) => String(n).padStart(2, "0");
const toISO = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const todayISO = () => { const n = new Date(); return toISO(n.getFullYear(), n.getMonth(), n.getDate()); };
const addDaysISO = (iso, n) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return toISO(d.getFullYear(), d.getMonth(), d.getDate()); };
const nextDayISO = (iso) => addDaysISO(iso, 1);
const combineDateTime = (date, time) => (date ? `${date}T${time || "00:00"}` : "");
const fmtNice = (iso) => { if (!iso) return "—"; const d = new Date(`${iso}T00:00:00`); if (isNaN(d)) return "—"; return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); };

// Default pickup/return clock times used to build the booking range (the UI
// only asks for dates, matching the mockup).
const PICKUP_TIME = "10:00";
const RETURN_TIME = "10:00";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const hhmmToMinutes = (hhmm) => { if (!hhmm) return 600; const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const minutesTo12h = (min) => {
  const h24 = Math.floor(min / 60), m = min % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  let h12 = h24 % 12; if (h12 === 0) h12 = 12;
  return `${pad2(h12)}:${pad2(m)} ${ampm}`;
};

// ── Availability primitives (shared convention with useFleetData) ──────────
const rangesOverlap = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && aEnd > bStart;

function dayAvailabilityStatus(plate, dateISO, { bookings, checkBookingConflict } = {}) {
  const dayStartISO = `${dateISO}T00:00`;
  const dayEndISO = `${nextDayISO(dateISO)}T00:00`;

  if (Array.isArray(bookings)) {
    const dayStart = new Date(dayStartISO).getTime();
    const dayEnd = new Date(dayEndISO).getTime();
    const overlapping = bookings.filter(b =>
      b.plate === plate && !b.cancelled && b.start && b.end &&
      rangesOverlap(dayStart, dayEnd, new Date(b.start).getTime(), new Date(b.end).getTime())
    );
    if (overlapping.length === 0) return "available";
    const fullyCovered = overlapping.some(b => new Date(b.start).getTime() <= dayStart && new Date(b.end).getTime() >= dayEnd);
    return fullyCovered ? "booked" : "partial";
  }

  if (!checkBookingConflict) return "available";
  const noonISO = `${dateISO}T12:00`;
  const fullConflict = checkBookingConflict(plate, dayStartISO, dayEndISO);
  if (!fullConflict) return "available";
  const morningConflict = checkBookingConflict(plate, dayStartISO, noonISO);
  const afternoonConflict = checkBookingConflict(plate, noonISO, dayEndISO);
  return (morningConflict && afternoonConflict) ? "booked" : "partial";
}

// Longest continuous run of available days starting at `fromISO`. Stops at the
// first fully-booked day; `until` is that first unavailable day (the checkout
// boundary). days === 0 means the car is already booked on the pickup date.
function continuousAvailability(plate, fromISO, ctx, maxDays = 90) {
  let days = 0;
  let cur = fromISO;
  while (days < maxDays) {
    if (dayAvailabilityStatus(plate, cur, ctx) === "booked") break;
    days++;
    cur = nextDayISO(cur);
  }
  return { days, from: fromISO, until: cur };
}

const AVAILABILITY_COLORS = {
  available: { bg: "#DCEFD1", text: "#2F6B2F", dot: "#4B9B3F" },
  partial: { bg: "#FBE7C6", text: "#8A5A00", dot: "#E4A83B" },
  booked: { bg: "#FBDCDC", text: "#B91C1C", dot: "#E15C5C" },
};

// ---------------------------------------------------------------------------
// Small side-view car thumbnail, tinted to the car's paint colour.
// ---------------------------------------------------------------------------
const COLOR_HEX = {
  Silver: "#C3C8CC", White: "#E9ECEA", Blue: "#4472C4", Black: "#353B40",
  Red: "#D64045", Grey: "#8A8F94", Gray: "#8A8F94", Green: "#4B6B3A",
  Yellow: "#E4B33B", Orange: "#DD7A34", Brown: "#8C6B4B",
};
function CarThumb({ color }) {
  const paint = COLOR_HEX[color] || "#6C7A70";
  return (
    <svg viewBox="0 0 132 84" style={{ width: "100%", height: "100%", display: "block" }} aria-hidden="true">
      <ellipse cx="66" cy="70" rx="52" ry="7" fill="#00000012" />
      {/* body */}
      <path d="M12 58 Q10 44 24 41 L40 40 Q50 28 66 27 Q86 27 96 40 L112 44 Q122 46 122 58 L120 64 Q118 66 112 66 L20 66 Q14 66 12 60 Z"
        fill={paint} stroke="#00000022" strokeWidth="1.2" />
      {/* cabin highlight */}
      <path d="M44 40 Q52 30 66 29 Q82 29 92 41 Z" fill="#ffffff" opacity="0.22" />
      {/* windows */}
      <path d="M50 39 Q56 33 65 33 L65 39 Z" fill="#2b3a42" opacity="0.55" />
      <path d="M69 33 Q80 34 86 39 L69 39 Z" fill="#2b3a42" opacity="0.55" />
      {/* wheels */}
      <circle cx="38" cy="65" r="12" fill="#23282b" />
      <circle cx="38" cy="65" r="5.2" fill="#c7cdd0" />
      <circle cx="96" cy="65" r="12" fill="#23282b" />
      <circle cx="96" cy="65" r="5.2" fill="#c7cdd0" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Monthly Availability modal (opened by "View Details") — a colour-coded month
// calendar, the selected search period, and a Continue to Book CTA.
// ---------------------------------------------------------------------------
function MonthlyAvailabilityModal({ open, car, range, bookings, checkBookingConflict, onClose, onContinue, onSelectDate }) {
  const [monthCursor, setMonthCursor] = useState(new Date());
  const [selectedISO, setSelectedISO] = useState(null);

  useEffect(() => {
    if (!open) return;
    const startDate = range?.start ? range.start.split("T")[0] : null;
    setMonthCursor(startDate ? new Date(`${startDate}T00:00:00`) : new Date());
    setSelectedISO(startDate);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !car) return null;

  const shiftMonth = (delta) => setMonthCursor(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  const year = monthCursor.getFullYear(), month = monthCursor.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = monthCursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const now = new Date();
  const canGoPrev = !(year === now.getFullYear() && month <= now.getMonth());

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const periodAvailable = range ? !checkBookingConflict?.(car.plate, range.start, range.end) : null;
  const fmtPeriod = (iso) => {
    if (!iso) return "—";
    const [datePart, timePart] = iso.split("T");
    const d = new Date(`${datePart}T00:00:00`);
    return `${d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" })}, ${minutesTo12h(hhmmToMinutes(timePart))}`;
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,25,17,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: G.surface, borderRadius: 16, padding: 22, width: 560, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: G.ink }}>Monthly Availability</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: G.textMuted, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 12.5, color: G.text, marginBottom: 16 }}>{car.model} · {car.plate}</div>

        <div style={{ display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
          {[["available", "Available"], ["partial", "Partially Available"], ["booked", "Booked / Unavailable"]].map(([key, label]) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: G.text, fontWeight: 600 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: AVAILABILITY_COLORS[key].dot, display: "inline-block" }} />
              {label}
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 18 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <button onClick={() => shiftMonth(-1)} disabled={!canGoPrev} style={{ background: "none", border: "none", cursor: canGoPrev ? "pointer" : "default", opacity: canGoPrev ? 1 : 0.3, fontSize: 18, color: G.ink, padding: 4 }}>‹</button>
              <div style={{ fontSize: 13, fontWeight: 700, color: G.ink }}>{monthLabel}</div>
              <button onClick={() => shiftMonth(1)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: G.ink, padding: 4 }}>›</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 4 }}>
              {WEEKDAYS.map(w => <div key={w} style={{ textAlign: "center", fontSize: 10.5, fontWeight: 600, color: G.textMuted, padding: "4px 0" }}>{w}</div>)}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
              {cells.map((d, i) => {
                if (d === null) return <div key={i} />;
                const iso = toISO(year, month, d);
                const status = dayAvailabilityStatus(car.plate, iso, { bookings, checkBookingConflict });
                const colors = AVAILABILITY_COLORS[status];
                const isPast = iso < todayISO();
                const isSelected = iso === selectedISO;
                const selectable = !isPast && status !== "booked";
                return (
                  <button key={i} type="button" title={status} disabled={!selectable}
                    onClick={() => { if (!selectable) return; setSelectedISO(iso); onSelectDate && onSelectDate(iso); }}
                    style={{
                      aspectRatio: "1", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12, fontWeight: isSelected ? 700 : 600, background: colors.bg, color: colors.text,
                      border: isSelected ? `2px solid ${colors.text}` : "none", cursor: selectable ? "pointer" : "default",
                      opacity: isPast ? 0.5 : 1, padding: 0,
                    }}>
                    {d}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: G.ink, marginBottom: 6 }}>Selected Period</div>
            {range ? (
              <div style={{ fontSize: 12, color: G.text, lineHeight: 1.7, marginBottom: 14 }}>
                {fmtPeriod(range.start)}<br />to<br />{fmtPeriod(range.end)}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: G.textMuted, marginBottom: 14 }}>Pick dates on the search form to check a specific period.</div>
            )}

            {range && (
              <>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: G.ink, marginBottom: 6 }}>Availability Status</div>
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 10, marginBottom: 14,
                  background: periodAvailable ? G.primarySoft : G.dangerSoft, color: periodAvailable ? G.primaryDark : G.danger,
                }}>
                  <span style={{ fontWeight: 800 }}>{periodAvailable ? "✓" : "✕"}</span>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 700 }}>{periodAvailable ? "Available" : "Unavailable"}</div>
                    <div style={{ fontSize: 10.5, opacity: 0.85 }}>{periodAvailable ? "This car is available for your selected period." : "This car is booked during part of your selected period."}</div>
                  </div>
                </div>
              </>
            )}

            <GreenButton full disabled={!range || !periodAvailable} onClick={() => onContinue(car.plate)}>Continue to Book</GreenButton>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------
const sectionCard = { background: G.surface, border: `1px solid ${G.border}`, borderRadius: 16, padding: "20px 22px", boxShadow: "0 1px 2px rgba(16,32,24,0.04)" };

function StepHead({ n, title, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
      <span style={{ width: 26, height: 26, borderRadius: "50%", background: G.primary, color: "#fff", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{n}</span>
      <div style={{ fontSize: 16, fontWeight: 700, color: G.ink, flex: 1 }}>{title}</div>
      {right}
    </div>
  );
}

function GreenButton({ children, onClick, disabled, full, small, id, dataTestid, dataPlate }) {
  return (
    <button onClick={onClick} disabled={disabled} id={id} data-testid={dataTestid} data-plate={dataPlate}
      style={{
        padding: small ? "8px 16px" : "11px 22px", width: full ? "100%" : undefined,
        borderRadius: 10, border: "none", cursor: disabled ? "default" : "pointer",
        background: disabled ? "#aab8ae" : G.primary, color: "#fff",
        fontSize: small ? 12.5 : 13.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = G.primaryHover; }}
      onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.background = G.primary; }}>
      {children}
    </button>
  );
}

const InfoPill = ({ children }) => (
  <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11.5, fontWeight: 600, color: G.infoText, background: G.info, border: `1px solid ${G.infoBorder}`, borderRadius: 20, padding: "6px 12px" }}>
    <span>ⓘ</span>{children}
  </div>
);

// ---------------------------------------------------------------------------
// Brand card (Step 2)
// ---------------------------------------------------------------------------
function BrandCard({ brand, count, selected, onSelect }) {
  const tint = brandTint(brand);
  return (
    <button
      type="button"
      data-testid="ca-brand"
      data-brand={brand}
      onClick={onSelect}
      style={{
        position: "relative", cursor: "pointer", textAlign: "center",
        border: `1.5px solid ${selected ? G.primary : G.border}`,
        background: selected ? G.primarySofter : "#fff",
        borderRadius: 14, padding: "20px 12px 16px", minWidth: 0,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
        boxShadow: selected ? "0 2px 10px rgba(20,81,58,0.12)" : "none", transition: "all 0.15s",
      }}>
      {selected && (
        <span style={{ position: "absolute", top: 8, right: 8, width: 18, height: 18, borderRadius: "50%", background: G.primary, color: "#fff", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</span>
      )}
      <div style={{ width: 54, height: 54, borderRadius: 12, background: tint + "16", color: tint, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800, letterSpacing: 0.5 }}>
        {brandInitial(brand)}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: G.ink, lineHeight: 1.2 }}>{brand}</div>
      <div style={{ fontSize: 11.5, color: G.accent, fontWeight: 600 }}>{count} Car{count === 1 ? "" : "s"} Available</div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Available car card (Step 3)
// ---------------------------------------------------------------------------
function AvailableCarCard({ car, avail, onSelect, onViewDetails }) {
  const meta = [car.fuelType, car.transmission, car.year].filter(Boolean);
  return (
    <div data-testid="ca-car" data-plate={car.plate}
      style={{ display: "flex", alignItems: "center", gap: 18, padding: 16, border: `1px solid ${G.border}`, borderRadius: 14, background: "#fff", marginBottom: 12, flexWrap: "wrap" }}>
      {/* thumbnail */}
      <div style={{ width: 108, height: 74, borderRadius: 10, background: G.primarySofter, border: `1px solid ${G.border}`, flexShrink: 0, padding: 6, boxSizing: "border-box" }}>
        <CarThumb color={car.color} />
      </div>

      {/* name + meta */}
      <div style={{ minWidth: 150, flex: "1 1 180px" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: G.ink, marginBottom: 7 }}>{car.model || car.plate}</div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: AVAIL.bg, color: AVAIL.text }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: AVAIL.dot }} /> Available
        </span>
        <div style={{ fontSize: 11.5, color: G.textMuted, marginTop: 9, display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
          {meta.map((m, i) => (
            <span key={i} style={{ display: "inline-flex", gap: 7, alignItems: "center" }}>
              {i > 0 && <span style={{ color: G.borderStrong }}>·</span>}{m}
            </span>
          ))}
        </div>
      </div>

      {/* availability window */}
      <div style={{ fontSize: 11.5, color: G.text, flex: "1 1 150px", minWidth: 130 }}>
        <div style={{ color: G.textMuted, marginBottom: 2 }}>Available From</div>
        <div style={{ fontWeight: 700, color: G.ink, marginBottom: 8 }}>📅 {fmtNice(avail.from)}</div>
        <div style={{ color: G.textMuted, marginBottom: 2 }}>Available Until</div>
        <div style={{ fontWeight: 700, color: G.ink }}>📅 {fmtNice(avail.until)}</div>
      </div>

      {/* days continuous */}
      <div style={{ textAlign: "center", background: G.primarySoft, borderRadius: 12, padding: "12px 16px", minWidth: 96, flexShrink: 0 }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: G.primary, lineHeight: 1 }}>{avail.days}</div>
        <div style={{ fontSize: 10.5, fontWeight: 600, color: G.text, marginTop: 4, lineHeight: 1.3 }}>Days Available<br />(Continuous)</div>
      </div>

      {/* actions */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <GreenButton small dataTestid="ca-select-car" dataPlate={car.plate} onClick={() => onSelect(car.plate)}>Select Car</GreenButton>
        <button data-testid="ca-view-details" onClick={() => onViewDetails(car)}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, color: G.accent, display: "inline-flex", alignItems: "center", gap: 4 }}>
          View Details ›
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CarAvailability
// ---------------------------------------------------------------------------
export default function CarAvailability({ fleet = [], bookings, checkBookingConflict, onBookCar }) {
  const [pickupDate, setPickupDate] = useState(todayISO());
  const [returnDate, setReturnDate] = useState(addDaysISO(todayISO(), 3));
  const [error, setError] = useState("");

  const [searched, setSearched] = useState(false);
  const [range, setRange] = useState(null);
  const [searchedPickup, setSearchedPickup] = useState(null); // pickup date the results were computed from
  const [selectedBrand, setSelectedBrand] = useState(null);

  const [availabilityCar, setAvailabilityCar] = useState(null);
  const [availabilityModalOpen, setAvailabilityModalOpen] = useState(false);

  const ctx = { bookings, checkBookingConflict };

  const handleSearch = () => {
    if (!pickupDate || !returnDate) { setError("Please select both a pickup and return date."); return; }
    if (returnDate < pickupDate) { setError("Return date must be on or after the pickup date."); return; }
    setError("");
    setRange({ start: combineDateTime(pickupDate, PICKUP_TIME), end: combineDateTime(returnDate, RETURN_TIME) });
    setSearchedPickup(pickupDate);
    setSearched(true);
  };

  // Cars available (continuous run ≥ 1 day) from the searched pickup date, with
  // their continuous-availability window, grouped/counted by brand.
  const availableCars = useMemo(() => {
    if (!searched || !searchedPickup) return [];
    return fleet
      .map(car => ({ car, avail: continuousAvailability(car.plate, searchedPickup, ctx) }))
      .filter(x => x.avail.days >= 1)
      .map(x => ({ ...x, brand: deriveBrand(x.car.model) }));
  }, [searched, searchedPickup, fleet, bookings]); // eslint-disable-line react-hooks/exhaustive-deps

  const availableBrands = useMemo(() => {
    const counts = {};
    availableCars.forEach(({ brand }) => { counts[brand] = (counts[brand] || 0) + 1; });
    return Object.entries(counts).map(([brand, count]) => ({ brand, count })).sort((a, b) => b.count - a.count);
  }, [availableCars]);

  // Auto-select the top brand after a search (and keep selection valid).
  useEffect(() => {
    if (!searched) return;
    if (availableBrands.length === 0) { setSelectedBrand(null); return; }
    if (!selectedBrand || !availableBrands.some(b => b.brand === selectedBrand)) {
      setSelectedBrand(availableBrands[0].brand);
    }
  }, [searched, availableBrands]); // eslint-disable-line react-hooks/exhaustive-deps

  const carsForSelectedBrand = useMemo(
    () => availableCars.filter(x => x.brand === selectedBrand).sort((a, b) => b.avail.days - a.avail.days),
    [availableCars, selectedBrand]
  );

  const bookCar = (plate) => onBookCar && onBookCar(plate, range?.start || "", range?.end || "");
  const openAvailability = (car) => { setAvailabilityCar(car); setAvailabilityModalOpen(true); };

  const dateField = (label, id, value, setValue, min) => (
    <div style={{ flex: "1 1 180px", minWidth: 160 }}>
      <label htmlFor={id} style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: G.text, marginBottom: 6 }}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${G.border}`, borderRadius: 10, padding: "0 12px", background: "#fff" }}>
        <span style={{ color: G.textMuted, fontSize: 14 }}>📅</span>
        <input id={id} type="date" value={value} min={min}
          onChange={(e) => setValue(e.target.value)}
          style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 13.5, fontWeight: 600, color: G.ink, padding: "11px 0", fontFamily: "inherit" }} />
      </div>
    </div>
  );

  return (
    <div style={{ background: G.page, borderRadius: 20, padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
      {/* STEP 1 — SELECT DATES */}
      <div style={sectionCard}>
        <StepHead n={1} title="Select Dates" />
        <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
          {dateField("Pickup Date", "ca-pickup-date", pickupDate, (v) => { setPickupDate(v); if (returnDate < v) setReturnDate(v); }, todayISO())}
          {dateField("Return Date", "ca-return-date", returnDate, setReturnDate, pickupDate || todayISO())}
          <div style={{ flex: "0 0 auto" }}>
            <GreenButton id="ca-search-availability" onClick={handleSearch}>🔍 Search Availability</GreenButton>
          </div>
        </div>
        {error && <div style={{ marginTop: 12, fontSize: 12.5, color: G.danger, background: G.dangerSoft, borderRadius: 8, padding: "8px 12px" }}>{error}</div>}
      </div>

      {/* STEP 2 — AVAILABLE CAR BRANDS */}
      {searched && (
        <div style={sectionCard}>
          <StepHead n={2} title="Available Car Brands" />
          {availableBrands.length === 0 ? (
            <div style={{ fontSize: 13, color: G.textMuted }}>No cars are available from {fmtNice(searchedPickup)}. Try a different pickup date.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
              {availableBrands.map(({ brand, count }) => (
                <BrandCard key={brand} brand={brand} count={count} selected={brand === selectedBrand} onSelect={() => setSelectedBrand(brand)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* STEP 3 — CARS UNDER SELECTED BRAND */}
      {searched && selectedBrand && carsForSelectedBrand.length > 0 && (
        <div style={sectionCard}>
          <StepHead
            n={3}
            title={`${selectedBrand} – Available Cars`}
            right={<InfoPill>Availability shown from {fmtNice(searchedPickup)} onwards</InfoPill>}
          />
          {carsForSelectedBrand.map(({ car, avail }) => (
            <AvailableCarCard key={car.plate} car={car} avail={avail} onSelect={bookCar} onViewDetails={openAvailability} />
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: G.infoText, background: G.info, border: `1px solid ${G.infoBorder}`, borderRadius: 10, padding: "10px 14px", marginTop: 4 }}>
            <span>ⓘ</span> Cars are shown based on continuous availability for the selected date range.
          </div>
        </div>
      )}

      <MonthlyAvailabilityModal
        open={availabilityModalOpen}
        car={availabilityCar}
        range={range}
        bookings={bookings}
        checkBookingConflict={checkBookingConflict}
        onClose={() => setAvailabilityModalOpen(false)}
        onContinue={(plate) => { setAvailabilityModalOpen(false); bookCar(plate); }}
        onSelectDate={(iso) => {
          const newReturn = returnDate && returnDate > iso ? returnDate : nextDayISO(iso);
          setPickupDate(iso);
          setReturnDate(newReturn);
          setRange({ start: combineDateTime(iso, PICKUP_TIME), end: combineDateTime(newReturn, RETURN_TIME) });
        }}
      />
    </div>
  );
}
