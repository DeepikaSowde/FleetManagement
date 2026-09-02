import { useState, useMemo, useEffect } from "react";

// ============================================================================
// Car Availability — calendar-centric redesign.
//
// One screen, two things:
//   1) PICK A PERIOD on the calendar (click pickup day, then return day) and the
//      cars available for that whole period appear live in the right panel.
//   2) BROWSE THE FLEET (right panel, "Fleet" tab) and click any car — the
//      calendar recolours to show THAT car's day-by-day availability
//      (available / partial / booked) for the month.
//
// Availability is computed from the REAL bookings loaded from the backend, using
// the same half-open overlap rule as useFleetData.rangesOverlap, so this always
// agrees with checkBookingConflict. Green accent stays LOCAL to this page; the
// rest of the app stays navy/teal.
// ============================================================================

const G = {
  primary: "#14513a",       // deep forest green — buttons, selected days
  primaryHover: "#0f3f2d",
  primaryDark: "#0e3b2a",
  accent: "#1a7a4d",        // green accents / big numbers / links
  primarySoft: "#e7f2ec",   // light green tint — range band, selected card
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

// ── Date helpers (dates handled as plain ISO strings, same as the backend) ──
const pad2 = (n) => String(n).padStart(2, "0");
const toISO = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const todayISO = () => { const n = new Date(); return toISO(n.getFullYear(), n.getMonth(), n.getDate()); };
const addDaysISO = (iso, n) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return toISO(d.getFullYear(), d.getMonth(), d.getDate()); };
const nextDayISO = (iso) => addDaysISO(iso, 1);
const diffDaysISO = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);
const combineDateTime = (date, time) => (date ? `${date}T${time || "00:00"}` : "");
const fmtNice = (iso) => { if (!iso) return "—"; const d = new Date(`${iso}T00:00:00`); if (isNaN(d)) return "—"; return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); };
const fmtShort = (iso) => { if (!iso) return "—"; const d = new Date(`${iso}T00:00:00`); if (isNaN(d)) return "—"; return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); };

// The UI only asks for dates; these clock times build the booking range.
const PICKUP_TIME = "10:00";
const RETURN_TIME = "10:00";
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

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
// first fully-booked day; days === 0 means already booked on the pickup date.
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

// Is a car free for an ENTIRE [start,end) booking range?
function isFreeForRange(plate, range, { bookings, checkBookingConflict } = {}) {
  if (!range) return false;
  if (Array.isArray(bookings)) {
    const s = new Date(range.start).getTime(), e = new Date(range.end).getTime();
    return !bookings.some(b =>
      b.plate === plate && !b.cancelled && b.start && b.end &&
      rangesOverlap(s, e, new Date(b.start).getTime(), new Date(b.end).getTime())
    );
  }
  return checkBookingConflict ? !checkBookingConflict(plate, range.start, range.end) : true;
}

const AVAILABILITY_COLORS = {
  available: { bg: "#DCEFD1", text: "#2F6B2F", dot: "#4B9B3F" },
  partial: { bg: "#FBE7C6", text: "#8A5A00", dot: "#E4A83B" },
  booked: { bg: "#FBDCDC", text: "#B91C1C", dot: "#E15C5C" },
};

// ── Small side-view car thumbnail, tinted to the car's paint colour. ───────
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
      <path d="M12 58 Q10 44 24 41 L40 40 Q50 28 66 27 Q86 27 96 40 L112 44 Q122 46 122 58 L120 64 Q118 66 112 66 L20 66 Q14 66 12 60 Z"
        fill={paint} stroke="#00000022" strokeWidth="1.2" />
      <path d="M44 40 Q52 30 66 29 Q82 29 92 41 Z" fill="#ffffff" opacity="0.22" />
      <path d="M50 39 Q56 33 65 33 L65 39 Z" fill="#2b3a42" opacity="0.55" />
      <path d="M69 33 Q80 34 86 39 L69 39 Z" fill="#2b3a42" opacity="0.55" />
      <circle cx="38" cy="65" r="12" fill="#23282b" />
      <circle cx="38" cy="65" r="5.2" fill="#c7cdd0" />
      <circle cx="96" cy="65" r="12" fill="#23282b" />
      <circle cx="96" cy="65" r="5.2" fill="#c7cdd0" />
    </svg>
  );
}

// ── Shared bits ────────────────────────────────────────────────────────────
const sectionCard = { background: G.surface, border: `1px solid ${G.border}`, borderRadius: 16, padding: "20px 22px", boxShadow: "0 1px 2px rgba(16,32,24,0.04)" };

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

const StatusChip = ({ status }) => {
  const map = {
    available: { bg: AVAIL.bg, text: AVAIL.text, dot: AVAIL.dot, label: "Available" },
    booked: { bg: G.dangerSoft, text: G.danger, dot: AVAILABILITY_COLORS.booked.dot, label: "Booked" },
    partial: { bg: AVAILABILITY_COLORS.partial.bg, text: AVAILABILITY_COLORS.partial.text, dot: AVAILABILITY_COLORS.partial.dot, label: "Partial" },
  };
  const c = map[status] || { bg: G.primarySofter, text: G.textMuted, dot: G.borderStrong, label: "—" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: c.bg, color: c.text }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: c.dot }} /> {c.label}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Interactive month calendar. Click a day to set pickup, click a later day to
// set return. When `carCtx` is passed (a car is selected on the right), each
// day is coloured by that car's availability and the picked range is ringed.
// ---------------------------------------------------------------------------
function MonthCalendar({ monthCursor, onShiftMonth, rangeStart, rangeEnd, onDayClick, selectedCar, ctx }) {
  const year = monthCursor.getFullYear(), month = monthCursor.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = monthCursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const now = new Date();
  const canGoPrev = !(year === now.getFullYear() && month <= now.getMonth());
  const today = todayISO();

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <button onClick={() => canGoPrev && onShiftMonth(-1)} disabled={!canGoPrev}
          style={{ background: G.primarySofter, border: `1px solid ${G.border}`, borderRadius: 8, width: 32, height: 32, cursor: canGoPrev ? "pointer" : "default", opacity: canGoPrev ? 1 : 0.35, fontSize: 16, color: G.ink }}>‹</button>
        <div style={{ fontSize: 15, fontWeight: 800, color: G.ink }}>{monthLabel}</div>
        <button onClick={() => onShiftMonth(1)}
          style={{ background: G.primarySofter, border: `1px solid ${G.border}`, borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 16, color: G.ink }}>›</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 6 }}>
        {WEEKDAYS.map(w => <div key={w} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: G.textMuted, padding: "4px 0" }}>{w}</div>)}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const iso = toISO(year, month, d);
          const isPast = iso < today;
          const isToday = iso === today;
          const isStart = iso === rangeStart;
          const isEnd = iso === rangeEnd;
          const inBand = rangeStart && rangeEnd && iso > rangeStart && iso < rangeEnd;
          const isEndpoint = isStart || isEnd;

          // Base fill: car mode → availability colour; otherwise plain.
          let bg = "#fff", color = G.ink, ring = "transparent";
          const status = selectedCar ? dayAvailabilityStatus(selectedCar.plate, iso, ctx) : null;
          if (selectedCar) {
            bg = AVAILABILITY_COLORS[status].bg;
            color = AVAILABILITY_COLORS[status].text;
          }
          if (inBand && !selectedCar) { bg = G.primarySoft; color = G.primaryDark; }
          if (inBand && selectedCar) { ring = G.primary; }        // ring the picked band over car colours
          if (isEndpoint) { bg = G.primary; color = "#fff"; ring = G.primaryDark; }

          const selectable = !isPast;
          return (
            <button key={i} type="button" data-testid="ca-day" data-date={iso} title={selectedCar ? status : iso}
              disabled={!selectable} onClick={() => selectable && onDayClick(iso)}
              style={{
                position: "relative", aspectRatio: "1", borderRadius: 10,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: isEndpoint || isToday ? 800 : 600,
                background: bg, color,
                border: ring !== "transparent" ? `2px solid ${ring}` : `1px solid ${selectedCar ? "transparent" : G.border}`,
                cursor: selectable ? "pointer" : "default", opacity: isPast ? 0.4 : 1, padding: 0,
              }}>
              {d}
              {isToday && !isEndpoint && <span style={{ position: "absolute", bottom: 4, width: 4, height: 4, borderRadius: "50%", background: G.accent }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── A compact available-car card (period → available list) ─────────────────
function AvailableCarCard({ car, freeDays, freeUntil, onBook, onViewOnCalendar, active }) {
  const meta = [car.fuelType, car.transmission, car.year].filter(Boolean);
  return (
    <div data-testid="ca-car" data-plate={car.plate}
      style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, border: `1.5px solid ${active ? G.primary : G.border}`, borderRadius: 12, background: active ? G.primarySofter : "#fff", marginBottom: 10 }}>
      <div style={{ width: 68, height: 46, borderRadius: 8, background: G.primarySofter, border: `1px solid ${G.border}`, flexShrink: 0, padding: 4, boxSizing: "border-box" }}>
        <CarThumb color={car.color} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: G.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{car.model || car.plate}</div>
        <div style={{ fontSize: 11, color: G.textMuted, marginTop: 2 }}>{car.plate}{meta.length ? ` · ${meta.join(" · ")}` : ""}</div>
        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <StatusChip status="available" />
          <span style={{ fontSize: 11, color: G.text }}>free <b style={{ color: G.accent }}>{freeDays}</b> day{freeDays === 1 ? "" : "s"}{freeUntil ? ` · until ${fmtShort(freeUntil)}` : ""}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
        <GreenButton small dataTestid="ca-select-car" dataPlate={car.plate} onClick={() => onBook(car.plate)}>Book</GreenButton>
        <button data-testid="ca-view-details" onClick={() => onViewOnCalendar(car)}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11.5, fontWeight: 700, color: G.accent }}>
          On calendar ›
        </button>
      </div>
    </div>
  );
}

// ── A fleet row (browse all cars; click → show its calendar) ───────────────
function FleetRow({ car, periodStatus, active, onSelect }) {
  const meta = [deriveBrand(car.model), car.fuelType, car.transmission].filter(Boolean);
  return (
    <button type="button" data-testid="ca-fleet-car" data-plate={car.plate} onClick={() => onSelect(car)}
      style={{
        width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 12, padding: 10,
        border: `1.5px solid ${active ? G.primary : G.border}`, borderRadius: 12, background: active ? G.primarySofter : "#fff",
        marginBottom: 8, cursor: "pointer",
      }}>
      <div style={{ width: 56, height: 38, borderRadius: 8, background: G.primarySofter, border: `1px solid ${G.border}`, flexShrink: 0, padding: 3, boxSizing: "border-box" }}>
        <CarThumb color={car.color} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: G.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{car.model || car.plate}</div>
        <div style={{ fontSize: 11, color: G.textMuted, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{car.plate} · {meta.join(" · ")}</div>
      </div>
      {periodStatus && <div style={{ flexShrink: 0 }}><StatusChip status={periodStatus} /></div>}
      <span style={{ flexShrink: 0, color: active ? G.primary : G.borderStrong, fontSize: 16, fontWeight: 800 }}>›</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// CarAvailability
// ---------------------------------------------------------------------------
export default function CarAvailability({ fleet = [], bookings, checkBookingConflict, onBookCar }) {
  const ctx = { bookings, checkBookingConflict };

  const [monthCursor, setMonthCursor] = useState(new Date());
  const [rangeStart, setRangeStart] = useState(todayISO());
  const [rangeEnd, setRangeEnd] = useState(addDaysISO(todayISO(), 3));
  const [selectedCar, setSelectedCar] = useState(null); // car whose availability the calendar shows
  const [rightTab, setRightTab] = useState("available"); // "available" | "fleet"
  const [search, setSearch] = useState("");

  const range = useMemo(
    () => (rangeStart && rangeEnd ? { start: combineDateTime(rangeStart, PICKUP_TIME), end: combineDateTime(rangeEnd, RETURN_TIME) } : null),
    [rangeStart, rangeEnd]
  );

  // Click a day: 1st click = pickup, 2nd (later) click = return, else restart.
  const onDayClick = (iso) => {
    if (!rangeStart || rangeEnd) { setRangeStart(iso); setRangeEnd(null); }
    else if (iso > rangeStart) { setRangeEnd(iso); }
    else { setRangeStart(iso); setRangeEnd(null); }
  };

  const shiftMonth = (delta) => setMonthCursor(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));

  // Cars available for the WHOLE selected period, with their continuous run.
  const availableCars = useMemo(() => {
    if (!range) return [];
    return fleet
      .filter(car => isFreeForRange(car.plate, range, ctx))
      .map(car => {
        const run = continuousAvailability(car.plate, rangeStart, ctx);
        return { car, freeDays: run.days, freeUntil: run.until };
      })
      .sort((a, b) => b.freeDays - a.freeDays);
  }, [range, rangeStart, fleet, bookings]); // eslint-disable-line react-hooks/exhaustive-deps

  const bookCar = (plate) => onBookCar && onBookCar(plate, range?.start || "", range?.end || "");
  const showOnCalendar = (car) => {
    setSelectedCar(car);
    const s = new Date(`${rangeStart}T00:00:00`);
    setMonthCursor(new Date(s.getFullYear(), s.getMonth(), 1));
  };

  const nights = rangeStart && rangeEnd ? diffDaysISO(rangeStart, rangeEnd) : 0;
  const selectedCarPeriod = selectedCar && range
    ? (isFreeForRange(selectedCar.plate, range, ctx) ? "available" : "booked")
    : null;

  // Live search across car name/model, plate, and brand — applied to both the
  // Available results and the Fleet list. Empty query matches everything.
  const q = search.trim().toLowerCase();
  const matchesSearch = (car) => {
    if (!q) return true;
    return [car.model || "", car.plate || "", deriveBrand(car.model)]
      .some(v => String(v).toLowerCase().includes(q));
  };
  const shownAvailable = availableCars.filter(({ car }) => matchesSearch(car));
  const shownFleet = fleet.filter(matchesSearch);

  return (
    <div style={{ background: G.page, borderRadius: 20, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      {/* HEADER */}
      <div>
        <div style={{ fontSize: 20, fontWeight: 800, color: G.ink }}>Car Availability</div>
        <div style={{ fontSize: 13, color: G.text, marginTop: 4 }}>
          Pick a pickup &amp; return day on the calendar to see available cars — or open the <b>Fleet</b> tab and tap a car to view its availability.
        </div>
      </div>

      {/* SEARCH — filters the Available results and the Fleet list live */}
      <div style={{ position: "relative" }}>
        <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: G.textMuted, fontSize: 14, pointerEvents: "none" }}>🔍</span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by car name, model, or plate…"
          style={{ width: "100%", padding: "12px 14px 12px 40px", borderRadius: 12, border: `1px solid ${G.border}`, background: G.surface, fontSize: 13, color: G.ink, outline: "none", boxSizing: "border-box", boxShadow: "0 1px 2px rgba(16,32,24,0.04)" }}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 1.05fr) minmax(320px, 1fr)", gap: 16, alignItems: "start" }}>
        {/* LEFT — CALENDAR */}
        <div style={sectionCard}>
          {/* Selected-period summary / car banner */}
          {selectedCar ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14, padding: "10px 12px", borderRadius: 10, background: G.primarySofter, border: `1px solid ${G.border}`, flexWrap: "wrap" }}>
              <div style={{ fontSize: 12.5, color: G.ink }}>
                📅 Showing availability for <b>{selectedCar.model || selectedCar.plate}</b> · {selectedCar.plate}
              </div>
              <button onClick={() => setSelectedCar(null)}
                style={{ background: "#fff", border: `1px solid ${G.borderStrong}`, borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 700, color: G.primary, cursor: "pointer" }}>
                Back to period view
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 120px", background: G.primarySofter, borderRadius: 10, padding: "8px 12px" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: G.textMuted, textTransform: "uppercase", letterSpacing: 0.4 }}>Pickup</div>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: G.ink }}>{fmtNice(rangeStart)}</div>
              </div>
              <div style={{ flex: "1 1 120px", background: G.primarySofter, borderRadius: 10, padding: "8px 12px" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: G.textMuted, textTransform: "uppercase", letterSpacing: 0.4 }}>Return</div>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: rangeEnd ? G.ink : G.textMuted }}>{rangeEnd ? fmtNice(rangeEnd) : "Pick a day"}</div>
              </div>
              {nights > 0 && (
                <div style={{ textAlign: "center", background: G.primary, color: "#fff", borderRadius: 10, padding: "8px 14px", flexShrink: 0 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1 }}>{nights}</div>
                  <div style={{ fontSize: 9.5, fontWeight: 600, marginTop: 2 }}>night{nights === 1 ? "" : "s"}</div>
                </div>
              )}
            </div>
          )}

          <MonthCalendar
            monthCursor={monthCursor}
            onShiftMonth={shiftMonth}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            onDayClick={onDayClick}
            selectedCar={selectedCar}
            ctx={ctx}
          />

          {/* Legend */}
          <div style={{ display: "flex", gap: 16, marginTop: 14, flexWrap: "wrap" }}>
            {selectedCar
              ? [["available", "Available"], ["partial", "Partial"], ["booked", "Booked"]].map(([k, label]) => (
                <span key={k} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: G.text, fontWeight: 600 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: AVAILABILITY_COLORS[k].bg, border: `1px solid ${AVAILABILITY_COLORS[k].dot}` }} /> {label}
                </span>
              ))
              : (
                <>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: G.text, fontWeight: 600 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: G.primary }} /> Pickup / Return
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: G.text, fontWeight: 600 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: G.primarySoft }} /> Selected period
                  </span>
                </>
              )}
          </div>

          {selectedCarPeriod && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8, marginTop: 14, padding: "10px 12px", borderRadius: 10,
              background: selectedCarPeriod === "available" ? G.primarySoft : G.dangerSoft,
              color: selectedCarPeriod === "available" ? G.primaryDark : G.danger,
            }}>
              <span style={{ fontWeight: 800 }}>{selectedCarPeriod === "available" ? "✓" : "✕"}</span>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>
                {selectedCarPeriod === "available"
                  ? `Available for ${fmtShort(rangeStart)} – ${fmtShort(rangeEnd)}`
                  : `Booked during ${fmtShort(rangeStart)} – ${fmtShort(rangeEnd)}`}
              </div>
              {selectedCarPeriod === "available" && (
                <div style={{ marginLeft: "auto" }}>
                  <GreenButton small onClick={() => bookCar(selectedCar.plate)}>Book this car</GreenButton>
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT — RESULTS / FLEET */}
        <div style={sectionCard}>
          {/* Tabs */}
          <div style={{ display: "flex", gap: 6, marginBottom: 16, background: G.primarySofter, borderRadius: 10, padding: 4 }}>
            <button data-testid="ca-tab-available" onClick={() => setRightTab("available")}
              style={{ flex: 1, padding: "9px 12px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 700,
                background: rightTab === "available" ? G.surface : "transparent", color: rightTab === "available" ? G.primary : G.text,
                boxShadow: rightTab === "available" ? "0 1px 3px rgba(0,0,0,0.08)" : "none" }}>
              Available {range ? `(${shownAvailable.length})` : ""}
            </button>
            <button data-testid="ca-tab-fleet" onClick={() => setRightTab("fleet")}
              style={{ flex: 1, padding: "9px 12px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 700,
                background: rightTab === "fleet" ? G.surface : "transparent", color: rightTab === "fleet" ? G.primary : G.text,
                boxShadow: rightTab === "fleet" ? "0 1px 3px rgba(0,0,0,0.08)" : "none" }}>
              Fleet ({shownFleet.length})
            </button>
          </div>

          {rightTab === "available" ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: G.ink, marginBottom: 12 }}>
                {range ? `${shownAvailable.length} car${shownAvailable.length === 1 ? "" : "s"} available` : "Select a period"}
                {range && <span style={{ fontWeight: 500, color: G.textMuted }}> · {fmtShort(rangeStart)} – {fmtShort(rangeEnd)}</span>}
              </div>
              {!range ? (
                <div style={{ fontSize: 12.5, color: G.textMuted, padding: "24px 0", textAlign: "center" }}>
                  Click a pickup day, then a return day on the calendar.
                </div>
              ) : shownAvailable.length === 0 ? (
                <div style={{ fontSize: 12.5, color: G.textMuted, padding: "24px 0", textAlign: "center" }}>
                  {availableCars.length > 0 && q
                    ? "No available cars match your search."
                    : "No cars are free for the whole period. Try a shorter or different range."}
                </div>
              ) : (
                <div style={{ maxHeight: 560, overflowY: "auto", paddingRight: 4 }}>
                  {shownAvailable.map(({ car, freeDays, freeUntil }) => (
                    <AvailableCarCard key={car.plate} car={car} freeDays={freeDays} freeUntil={freeUntil}
                      active={selectedCar?.plate === car.plate}
                      onBook={bookCar} onViewOnCalendar={showOnCalendar} />
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: G.ink, marginBottom: 4 }}>All fleet cars</div>
              <div style={{ fontSize: 11.5, color: G.textMuted, marginBottom: 12 }}>
                Tap a car to see its availability on the calendar{range ? " (chip = status for the selected period)" : ""}.
              </div>
              <div style={{ maxHeight: 600, overflowY: "auto", paddingRight: 4 }}>
                {fleet.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: G.textMuted, padding: "24px 0", textAlign: "center" }}>No cars in the fleet yet.</div>
                ) : shownFleet.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: G.textMuted, padding: "24px 0", textAlign: "center" }}>No cars match your search.</div>
                ) : (
                  shownFleet.map(car => (
                    <FleetRow key={car.plate} car={car}
                      periodStatus={range ? (isFreeForRange(car.plate, range, ctx) ? "available" : "booked") : null}
                      active={selectedCar?.plate === car.plate}
                      onSelect={showOnCalendar} />
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
