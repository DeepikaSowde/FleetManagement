import { useState, useMemo, useEffect } from "react";

// ============================================================================
// Car Availability — customer-facing search + availability page. Green/olive
// accent kept LOCAL to this page (palette G below); the rest of the app stays
// navy/teal. Two flows:
//   1) Location + Date/Time -> Available Brands -> Cars under a brand
//   2) Search by Car (type-ahead) -> matching cars, live availability if the
//      person already picked dates above
// Availability is computed from the REAL bookings loaded from the backend
// (same data useFleetData exposes), using the same half-open overlap rule as
// useFleetData.rangesOverlap so this always agrees with checkBookingConflict.
//
// Brand is derived from `model` (Fleet has no brand field yet). Location is a
// single fixed field (only one location in the data today).
// ============================================================================

const G = {
  primary: "#4B6B3A",
  primaryDark: "#3A5429",
  primarySoft: "#E8F0E1",
  primarySofter: "#F3F7EF",
  ink: "#212B1C",
  text: "#5B6456",
  textMuted: "#8C9587",
  border: "#E3E8DE",
  surface: "#FFFFFF",
  page: "#F5F7F2",
  danger: "#B91C1C",
  dangerSoft: "#FBE7E7",
};

const BRAND_TINTS = ["#4B6B3A", "#3B6E8C", "#8C5A3B", "#6B4B8C", "#8C3B5E", "#3B8C6E"];
const brandTint = (name) => BRAND_TINTS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % BRAND_TINTS.length];

const KNOWN_BRANDS = [
  "Maruti Suzuki", "Tata", "Mahindra", "Hyundai", "Honda", "Toyota",
  "Kia", "Renault", "Nissan", "Volkswagen", "Skoda", "Ford", "MG",
  "BMW", "Mercedes-Benz", "Audi", "Jeep", "Isuzu", "Chevrolet", "Datsun",
];
const BRAND_MATCHERS = [...KNOWN_BRANDS].sort((a, b) => b.length - a.length);

export function deriveBrand(model) {
  if (!model) return "Other";
  const lower = model.toLowerCase();
  const match = BRAND_MATCHERS.find(b => lower.includes(b.toLowerCase()));
  return match || model.trim().split(/\s+/)[0];
}

const combineDateTime = (date, time) => (date ? `${date}T${time || "00:00"}` : "");
const pad2 = (n) => String(n).padStart(2, "0");
const toISO = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const todayISO = () => { const n = new Date(); return toISO(n.getFullYear(), n.getMonth(), n.getDate()); };
const nextDayISO = (iso) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + 1); return toISO(d.getFullYear(), d.getMonth(), d.getDate()); };
const brandInitial = (b) => b.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

const minutesToHHMM = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
const hhmmToMinutes = (hhmm) => { if (!hhmm) return 720; const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const minutesTo12h = (min) => {
  const h24 = Math.floor(min / 60), m = min % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  let h12 = h24 % 12; if (h12 === 0) h12 = 12;
  return `${pad2(h12)}:${pad2(m)} ${ampm}`;
};

const formatDuration = (startISO, endISO) => {
  if (!startISO || !endISO) return "—";
  const ms = new Date(endISO) - new Date(startISO);
  if (isNaN(ms) || ms <= 0) return "—";
  const totalHrs = Math.round(ms / (1000 * 60 * 60));
  const days = Math.floor(totalHrs / 24), hrs = totalHrs % 24;
  return `${days ? `${days}d ` : ""}${hrs}h`;
};

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

// ---------------------------------------------------------------------------
// Month calendar grid used inside the pickup/return popups
// ---------------------------------------------------------------------------
function MonthCalendar({ monthCursor, onPrev, onNext, selectedDate, onSelect, minDateISO }) {
  const year = monthCursor.getFullYear(), month = monthCursor.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = monthCursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const now = new Date();
  const canGoPrev = !(year === now.getFullYear() && month <= now.getMonth());

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <button onClick={onPrev} disabled={!canGoPrev} style={{ background: "none", border: "none", cursor: canGoPrev ? "pointer" : "default", opacity: canGoPrev ? 1 : 0.3, fontSize: 18, color: G.ink, padding: 4 }}>‹</button>
        <div style={{ fontSize: 13, fontWeight: 700, color: G.ink }}>{monthLabel}</div>
        <button onClick={onNext} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: G.ink, padding: 4 }}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 4 }}>
        {WEEKDAYS.map(w => <div key={w} style={{ textAlign: "center", fontSize: 10.5, fontWeight: 600, color: G.textMuted, padding: "4px 0" }}>{w}</div>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const iso = toISO(year, month, d);
          const disabled = minDateISO ? iso < minDateISO : false;
          const isSelected = iso === selectedDate;
          return (
            <button key={i} disabled={disabled} onClick={() => onSelect(iso)}
              style={{
                aspectRatio: "1", border: "none", borderRadius: "50%", cursor: disabled ? "default" : "pointer",
                fontSize: 12.5, fontWeight: isSelected ? 700 : 500,
                background: isSelected ? G.primary : "transparent",
                color: disabled ? "#C7CCC3" : isSelected ? "#fff" : G.ink,
              }}>
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time slider (Start Time / End Time rows in the popup)
// ---------------------------------------------------------------------------
function TimeSlider({ label, minutes, onChange }) {
  const pct = (minutes / 1439) * 100;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: G.text }}>🕐 {label}</span>
        <div style={{ border: `1px solid ${G.border}`, borderRadius: 8, padding: "3px 10px", fontSize: 12, fontWeight: 700, color: G.ink }}>
          {minutesTo12h(minutes)}
        </div>
      </div>
      <input
        type="range" min={0} max={1439} step={15} value={minutes}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="ca-range"
        style={{ width: "100%", height: 4, borderRadius: 2, background: `linear-gradient(to right, ${G.primary} ${pct}%, ${G.border} ${pct}%)` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pickup/Return popup: calendar + time slider + Cancel/Done
// ---------------------------------------------------------------------------
function DateTimeModal({ title, sliderLabel, open, onClose, dateISO, timeHHMM, onDone, minDateISO }) {
  const [monthCursor, setMonthCursor] = useState(new Date());
  const [localDate, setLocalDate] = useState(dateISO);
  const [minutes, setMinutes] = useState(hhmmToMinutes(timeHHMM));

  useEffect(() => {
    if (!open) return;
    setLocalDate(dateISO);
    setMinutes(hhmmToMinutes(timeHHMM));
    setMonthCursor(dateISO ? new Date(`${dateISO}T00:00:00`) : new Date());
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const shiftMonth = (delta) => setMonthCursor(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,25,17,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: G.surface, borderRadius: 16, padding: 22, width: 340, maxWidth: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: G.ink }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: G.textMuted, lineHeight: 1 }}>×</button>
        </div>
        <MonthCalendar
          monthCursor={monthCursor}
          onPrev={() => shiftMonth(-1)}
          onNext={() => shiftMonth(1)}
          selectedDate={localDate}
          onSelect={setLocalDate}
          minDateISO={minDateISO}
        />
        <div style={{ marginTop: 16 }}>
          <TimeSlider label={sliderLabel} minutes={minutes} onChange={setMinutes} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "10px 0", borderRadius: 9, border: `1px solid ${G.border}`, background: "#fff", color: G.ink, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
          <button
            onClick={() => onDone(localDate, minutesToHHMM(minutes))}
            disabled={!localDate}
            style={{ flex: 1, padding: "10px 0", borderRadius: 9, border: "none", background: localDate ? G.primary : "#B7C4AC", color: "#fff", fontSize: 13, fontWeight: 700, cursor: localDate ? "pointer" : "default" }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Monthly availability status for a single day. With the real `bookings`
// array (each with plate/start/end/cancelled), this is exact: "booked" if a
// non-cancelled booking covers the whole day, "partial" if one overlaps only
// part (pickup/return turnover), otherwise "available". Uses the same
// half-open overlap convention as useFleetData.rangesOverlap. Falls back to
// probing checkBookingConflict for the morning/afternoon halves when no
// bookings array is passed.
// ---------------------------------------------------------------------------
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

const AVAILABILITY_COLORS = {
  available: { bg: "#DCEFD1", text: "#2F6B2F", dot: "#4B9B3F" },
  partial: { bg: "#FBE7C6", text: "#8A5A00", dot: "#E4A83B" },
  booked: { bg: "#FBDCDC", text: "#B91C1C", dot: "#E15C5C" },
};

// ---------------------------------------------------------------------------
// Monthly Availability modal: a full month calendar color-coded per day
// (Available / Partially Available / Booked), month navigation, the selected
// search period, an availability readout, and a Continue to Book CTA.
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

        {/* legend */}
        <div style={{ display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
          {[["available", "Available"], ["partial", "Partially Available"], ["booked", "Booked / Unavailable"]].map(([key, label]) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: G.text, fontWeight: 600 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: AVAILABILITY_COLORS[key].dot, display: "inline-block" }} />
              {label}
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 18 }}>
          {/* calendar */}
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
                  <button
                    key={i}
                    type="button"
                    title={status}
                    disabled={!selectable}
                    onClick={() => {
                      if (!selectable) return;
                      setSelectedISO(iso);
                      onSelectDate && onSelectDate(iso);
                    }}
                    style={{
                      aspectRatio: "1", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12, fontWeight: isSelected ? 700 : 600,
                      background: colors.bg, color: colors.text,
                      border: isSelected ? `2px solid ${colors.text}` : "none",
                      cursor: selectable ? "pointer" : "default",
                      opacity: isPast ? 0.5 : 1,
                      padding: 0,
                    }}>
                    {d}
                  </button>
                );
              })}
            </div>
          </div>

          {/* selected period + status */}
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
// Hero illustration — original SVG (dusk skyline + a black front-view car with
// a "FleetOpz" plate). Built from plain shapes/gradients.
// ---------------------------------------------------------------------------
function HeroIllustration() {
  return (
    <svg viewBox="0 0 620 430" style={{ width: "100%", height: "auto", maxWidth: 460 }}>
      <defs>
        <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#9FB4C9" />
          <stop offset="45%" stopColor="#D9C3AE" />
          <stop offset="100%" stopColor="#F1DEC4" />
        </linearGradient>
        <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFE7BE" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#FFE7BE" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4A4E52" />
          <stop offset="55%" stopColor="#26282B" />
          <stop offset="100%" stopColor="#111214" />
        </linearGradient>
        <linearGradient id="hoodGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5C6166" />
          <stop offset="100%" stopColor="#2B2E31" />
        </linearGradient>
        <linearGradient id="glassGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7C8B92" />
          <stop offset="100%" stopColor="#3A444A" />
        </linearGradient>
        <radialGradient id="chromeGrad" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#E7EAEA" />
          <stop offset="100%" stopColor="#7C8688" />
        </radialGradient>
        <linearGradient id="tireGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3A3F3F" />
          <stop offset="100%" stopColor="#161919" />
        </linearGradient>
        <linearGradient id="towerGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#CBB79C" />
          <stop offset="100%" stopColor="#AF9A7E" />
        </linearGradient>
      </defs>

      <rect x="0" y="0" width="620" height="300" rx="18" fill="url(#skyGrad)" />
      <circle cx="470" cy="70" r="70" fill="url(#sunGlow)" />

      <g opacity="0.9">
        <rect x="30" y="150" width="26" height="130" fill="url(#towerGrad)" />
        <rect x="60" y="120" width="20" height="160" fill="url(#towerGrad)" opacity="0.9" />
        <rect x="150" y="90" width="24" height="190" fill="url(#towerGrad)" />
        <polygon points="162,60 174,90 150,90" fill="url(#towerGrad)" />
        <rect x="190" y="140" width="16" height="140" fill="url(#towerGrad)" opacity="0.85" />
        <rect x="330" y="70" width="18" height="210" fill="url(#towerGrad)" />
        <polygon points="339,30 349,70 329,70" fill="url(#towerGrad)" />
        <rect x="360" y="110" width="22" height="170" fill="url(#towerGrad)" opacity="0.9" />
        <rect x="480" y="130" width="20" height="150" fill="url(#towerGrad)" opacity="0.85" />
        <rect x="510" y="95" width="24" height="185" fill="url(#towerGrad)" />
        <rect x="545" y="150" width="18" height="130" fill="url(#towerGrad)" opacity="0.8" />
        {[0, 1, 2, 3, 4, 5].map(i => (
          <rect key={i} x={335 + (i % 2) * 8} y={80 + i * 22} width="4" height="4" fill="#FFEFC8" opacity="0.7" />
        ))}
      </g>

      <rect x="0" y="255" width="620" height="45" fill="#E8D3B8" opacity="0.35" />

      <path d="M0 292 L620 292 L620 360 Q310 340 0 360 Z" fill="#C9BCA8" />
      <path d="M0 292 L620 292 L620 306 Q310 300 0 306 Z" fill="#B7A98F" opacity="0.6" />
      {[70, 190, 430, 550].map(x => (
        <rect key={x} x={x} y="330" width="34" height="5" fill="#fff" opacity="0.5" transform={`skewX(-8)`} />
      ))}

      <g transform="translate(46,120)">
        <rect x="-3" y="0" width="7" height="80" rx="3.5" fill="#7A5C3C" />
        <path d="M0 0 Q-32 -14 -48 8 Q-22 2 0 12 Z" fill="#5C8A4A" />
        <path d="M0 0 Q32 -16 50 4 Q24 0 0 12 Z" fill="#6B9C57" />
        <path d="M0 0 Q-8 -28 12 -38 Q6 -14 0 8 Z" fill="#6B9C57" />
        <path d="M0 0 Q6 -30 -14 -36 Q-6 -12 0 8 Z" fill="#5C8A4A" />
      </g>

      <ellipse cx="310" cy="330" rx="200" ry="16" fill="#00000022" />

      <g transform="translate(90,110)">
        <path d="M4 88 Q-14 84 -14 96 Q-14 106 4 104 Z" fill="url(#bodyGrad)" stroke="#000" strokeWidth="1" />
        <path d="M366 88 Q384 84 384 96 Q384 106 366 104 Z" fill="url(#bodyGrad)" stroke="#000" strokeWidth="1" />

        <path d="M60 8 Q100 -14 185 -16 Q270 -14 310 8 L296 30 L74 30 Z" fill="url(#hoodGrad)" stroke="#000" strokeWidth="1" />

        <path d="M78 32 Q100 14 185 12 Q270 14 292 32 L278 58 L92 58 Z" fill="url(#glassGrad)" />
        <line x1="185" y1="13" x2="185" y2="58" stroke="#111" strokeWidth="3" />
        <path d="M96 34 L150 34 L140 50 L90 50 Z" fill="#fff" opacity="0.15" />

        <path d="M14 220 Q4 140 40 96 Q58 62 92 58 L278 58 Q312 62 330 96 Q366 140 356 220 Z" fill="url(#bodyGrad)" stroke="#000" strokeWidth="1.5" />
        <path d="M60 78 Q185 60 310 78 L300 110 Q185 96 70 110 Z" fill="url(#hoodGrad)" opacity="0.85" />
        <path d="M50 118 Q185 104 320 118" fill="none" stroke="#000" strokeWidth="1.2" opacity="0.4" />
        <path d="M46 150 Q185 138 324 150" fill="none" stroke="#000" strokeWidth="1.2" opacity="0.35" />

        <g>
          <path d="M32 108 Q26 96 46 90 Q78 86 92 98 Q94 116 76 122 Q46 126 32 108 Z" fill="url(#chromeGrad)" stroke="#000" strokeWidth="1" />
          <path d="M40 104 Q54 98 74 100 Q80 108 70 114 Q50 118 40 104 Z" fill="#FFF6D8" />
          <path d="M338 108 Q344 96 324 90 Q292 86 278 98 Q276 116 294 122 Q324 126 338 108 Z" fill="url(#chromeGrad)" stroke="#000" strokeWidth="1" />
          <path d="M330 104 Q316 98 296 100 Q290 108 300 114 Q320 118 330 104 Z" fill="#FFF6D8" />
        </g>

        <rect x="140" y="104" width="90" height="42" rx="6" fill="#15171A" stroke="#000" strokeWidth="1.2" />
        {Array.from({ length: 4 }).map((_, r) => (
          Array.from({ length: 6 }).map((__, c) => (
            <circle key={`${r}-${c}`} cx={148 + c * 13} cy={112 + r * 9} r="2.6" fill="url(#chromeGrad)" />
          ))
        ))}
        <circle cx="185" cy="125" r="13" fill="#0E0F11" stroke="url(#chromeGrad)" strokeWidth="2.5" />
        <path d="M178 125 L183 130 L193 118" fill="none" stroke="#E7EAEA" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

        <path d="M20 178 Q185 160 350 178 L346 214 Q185 198 24 214 Z" fill="#000" opacity="0.35" />
        <circle cx="66" cy="192" r="9" fill="#0E0F11" stroke="#000" strokeWidth="1" /><circle cx="66" cy="192" r="4" fill="#FFE9A8" />
        <circle cx="304" cy="192" r="9" fill="#0E0F11" stroke="#000" strokeWidth="1" /><circle cx="304" cy="192" r="4" fill="#FFE9A8" />

        <rect x="140" y="200" width="90" height="26" rx="4" fill="#fff" stroke="#C7CCC3" strokeWidth="1" />
        <circle cx="156" cy="213" r="8" fill="#4B6B3A" />
        <path d="M152 213 Q156 207 161 210 M152 213 Q156 219 161 216" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
        <text x="196" y="217" textAnchor="middle" fontSize="12" fontWeight="800" fill="#3A5429" fontFamily="Arial, sans-serif">FLEETOPZ</text>

        <g>
          <ellipse cx="70" cy="230" rx="30" ry="10" fill="#00000033" />
          <circle cx="70" cy="220" r="30" fill="url(#tireGrad)" />
          <circle cx="70" cy="220" r="17" fill="url(#chromeGrad)" />
          <circle cx="70" cy="220" r="6" fill="#3A3F3F" />
          {[0, 60, 120, 180, 240, 300].map(a => (
            <line key={a} x1="70" y1="220" x2={70 + 15 * Math.cos((a * Math.PI) / 180)} y2={220 + 15 * Math.sin((a * Math.PI) / 180)} stroke="#7C8688" strokeWidth="2.4" />
          ))}
        </g>
        <g>
          <ellipse cx="300" cy="230" rx="30" ry="10" fill="#00000033" />
          <circle cx="300" cy="220" r="30" fill="url(#tireGrad)" />
          <circle cx="300" cy="220" r="17" fill="url(#chromeGrad)" />
          <circle cx="300" cy="220" r="6" fill="#3A3F3F" />
          {[0, 60, 120, 180, 240, 300].map(a => (
            <line key={a} x1="300" y1="220" x2={300 + 15 * Math.cos((a * Math.PI) / 180)} y2={220 + 15 * Math.sin((a * Math.PI) / 180)} stroke="#7C8688" strokeWidth="2.4" />
          ))}
        </g>

        <rect x="4" y="70" width="16" height="8" rx="2" fill="#EED9A0" />
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------
const sectionCard = { background: G.surface, border: `1px solid ${G.border}`, borderRadius: 16, padding: 22 };
const fieldBoxStyle = { border: `1px solid ${G.border}`, borderRadius: 10, padding: "9px 12px", background: "#fff", cursor: "pointer", minWidth: 0 };
const fieldLabelStyle = { fontSize: 10, fontWeight: 600, color: G.textMuted, marginBottom: 3, display: "flex", alignItems: "center", gap: 5 };
const fieldValueStyle = { fontSize: 12.5, fontWeight: 600, color: G.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

function GreenButton({ children, onClick, disabled, full, small }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        padding: small ? "8px 14px" : "13px 0", width: full ? "100%" : undefined,
        borderRadius: 10, border: "none", cursor: disabled ? "default" : "pointer",
        background: disabled ? "#B7C4AC" : G.primary, color: "#fff",
        fontSize: small ? 12 : 13.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
      }}>
      {children}
    </button>
  );
}

function CarRow({ car, available, onBook, onCheckAvailability }) {
  const brand = deriveBrand(car.model);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 14px", border: `1px solid ${G.border}`, borderRadius: 12, marginBottom: 8, background: "#fff", flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: brandTint(brand) + "22", color: brandTint(brand), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>🚗</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: G.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{car.model || "—"}</div>
          <div style={{ fontSize: 11.5, color: G.textMuted }}>{car.plate}{car.color ? ` · ${car.color}` : ""}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {available === true && <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 20, background: G.primarySoft, color: G.primaryDark }}>Available</span>}
        {available === false && <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 20, background: G.dangerSoft, color: G.danger }}>Booked</span>}
        {onCheckAvailability && (
          <button onClick={() => onCheckAvailability(car)}
            style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${G.primary}`, background: "#fff", color: G.primaryDark, fontSize: 11.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
            📅 Monthly Availability
          </button>
        )}
        <GreenButton small disabled={available === false} onClick={() => onBook(car.plate)}>Book Now</GreenButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CarAvailability
// ---------------------------------------------------------------------------
export default function CarAvailability({ fleet = [], bookings, checkBookingConflict, onBookCar }) {
  const [rentalMode, setRentalMode] = useState("daily"); // visual toggle only

  const [pickupDate, setPickupDate] = useState(todayISO());
  const [pickupTime, setPickupTime] = useState("12:00");
  const [returnDate, setReturnDate] = useState(todayISO());
  const [returnTime, setReturnTime] = useState("15:00");
  const [pickupModalOpen, setPickupModalOpen] = useState(false);
  const [returnModalOpen, setReturnModalOpen] = useState(false);

  const [searched, setSearched] = useState(false);
  const [range, setRange] = useState(null);
  const [selectedBrand, setSelectedBrand] = useState(null);

  const [carQuery, setCarQuery] = useState("");
  const [availabilityCar, setAvailabilityCar] = useState(null);
  const [availabilityModalOpen, setAvailabilityModalOpen] = useState(false);

  const isCarAvailable = (plate, start, end) => {
    if (!checkBookingConflict || !start || !end) return null;
    return !checkBookingConflict(plate, start, end);
  };

  const handleSearch = () => {
    if (!pickupDate || !returnDate) { alert("Please select both a pick-up and return date."); return; }
    const start = combineDateTime(pickupDate, pickupTime);
    const end = combineDateTime(returnDate, returnTime);
    if (new Date(end) <= new Date(start)) { alert("Return date & time must be after pick-up date & time."); return; }
    setRange({ start, end });
    setSelectedBrand(null);
    setSearched(true);
  };

  const availableBrands = useMemo(() => {
    if (!searched || !range) return [];
    const counts = {};
    fleet.forEach(car => {
      if (isCarAvailable(car.plate, range.start, range.end)) {
        const brand = deriveBrand(car.model);
        counts[brand] = (counts[brand] || 0) + 1;
      }
    });
    return Object.entries(counts).map(([brand, count]) => ({ brand, count })).sort((a, b) => b.count - a.count);
  }, [searched, range, fleet]); // eslint-disable-line react-hooks/exhaustive-deps

  const carsForSelectedBrand = useMemo(() => {
    if (!selectedBrand || !range) return [];
    return fleet.filter(car => deriveBrand(car.model) === selectedBrand && isCarAvailable(car.plate, range.start, range.end));
  }, [selectedBrand, range, fleet]); // eslint-disable-line react-hooks/exhaustive-deps

  const carSearchGroups = useMemo(() => {
    const q = carQuery.trim().toLowerCase();
    if (!q) return [];
    const matches = fleet.filter(car => (car.model || "").toLowerCase().includes(q));
    const groups = {};
    matches.forEach(car => {
      const key = car.model || "Unknown model";
      if (!groups[key]) groups[key] = { model: key, cars: [] };
      groups[key].cars.push(car);
    });
    return Object.values(groups).map(g => {
      const withStatus = range
        ? g.cars.map(c => ({ ...c, available: isCarAvailable(c.plate, range.start, range.end) }))
        : g.cars.map(c => ({ ...c, available: null }));
      return { ...g, cars: withStatus, availableCount: withStatus.filter(c => c.available).length, totalCount: withStatus.length };
    });
  }, [carQuery, fleet, range]); // eslint-disable-line react-hooks/exhaustive-deps

  const bookCar = (plate) => onBookCar && onBookCar(plate, range?.start || "", range?.end || "");

  const openAvailability = (car) => { setAvailabilityCar(car); setAvailabilityModalOpen(true); };

  return (
    <div style={{ background: G.page, borderRadius: 20, padding: 20, display: "flex", flexDirection: "column", gap: 22 }}>
      <style>{`
        .ca-range { -webkit-appearance: none; appearance: none; outline: none; cursor: pointer; }
        .ca-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 16px; height: 16px; border-radius: 50%; background: ${G.primary}; border: 3px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.3); }
        .ca-range::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; background: ${G.primary}; border: 3px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.3); cursor: pointer; }
      `}</style>

      {/* HERO */}
      <div style={{ ...sectionCard, background: `linear-gradient(135deg, #EAF6FF 0%, #FBF3DD 100%)`, padding: 26 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.15fr 0.85fr", gap: 24, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800, color: G.ink, marginBottom: 6, letterSpacing: -0.3 }}>Find the perfect car for your journey</div>
            <div style={{ fontSize: 13, color: G.text, marginBottom: 16 }}>Choose your dates, time and find the best fleet for you</div>

            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              {[{ id: "daily", label: "Daily Rentals" }, { id: "weekend", label: "Weekend" }].map(m => (
                <button key={m.id} onClick={() => setRentalMode(m.id)}
                  style={{
                    padding: "7px 16px", borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: "pointer",
                    border: rentalMode === m.id ? "none" : `1px solid ${G.border}`,
                    background: rentalMode === m.id ? G.primary : "#fff",
                    color: rentalMode === m.id ? "#fff" : G.text,
                  }}>
                  {m.label}
                </button>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr 1fr 0.8fr", gap: 10, marginBottom: 10 }}>
              <div style={fieldBoxStyle}>
                <div style={fieldLabelStyle}>📍 Location</div>
                <div style={fieldValueStyle}>Chennai, Tamil Nadu</div>
              </div>
              <div style={fieldBoxStyle} onClick={() => setPickupModalOpen(true)}>
                <div style={fieldLabelStyle}>📅 Pick-Up Date & Time</div>
                <div style={fieldValueStyle}>{pickupDate ? `${pickupDate} · ${minutesTo12h(hhmmToMinutes(pickupTime))}` : "Select date & time"}</div>
              </div>
              <div style={fieldBoxStyle} onClick={() => setReturnModalOpen(true)}>
                <div style={fieldLabelStyle}>📅 Return Date & Time</div>
                <div style={fieldValueStyle}>{returnDate ? `${returnDate} · ${minutesTo12h(hhmmToMinutes(returnTime))}` : "Select date & time"}</div>
              </div>
              <div style={fieldBoxStyle}>
                <div style={fieldLabelStyle}>⏱️ Duration</div>
                <div style={fieldValueStyle}>{formatDuration(combineDateTime(pickupDate, pickupTime), combineDateTime(returnDate, returnTime))}</div>
              </div>
            </div>

            <div style={{ ...fieldBoxStyle, cursor: "text", marginBottom: 14 }}>
              <div style={fieldLabelStyle}>🔍 Search by Car</div>
              <input
                value={carQuery}
                onChange={(e) => setCarQuery(e.target.value)}
                placeholder="e.g. maruti, toyota innova, fortuner"
                style={{ ...fieldValueStyle, width: "100%", border: "none", outline: "none", padding: 0, background: "transparent", fontFamily: "inherit" }}
              />
            </div>

            <GreenButton full onClick={handleSearch}>🔍 Search</GreenButton>
          </div>

          <div style={{ display: "flex", justifyContent: "center" }}>
            <HeroIllustration />
          </div>
        </div>
      </div>

      {/* TRUST ROW */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {[
          { icon: "🏷️", label: "Best Prices Guaranteed" },
          { icon: "🚗", label: "Wide Range of Vehicles" },
          { icon: "✅", label: "Easy Booking Process" },
          { icon: "☎️", label: "24/7 Customer Support" },
        ].map(t => (
          <div key={t.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: G.text, fontWeight: 600 }}>
            <span style={{ fontSize: 16 }}>{t.icon}</span>{t.label}
          </div>
        ))}
      </div>

      {/* SEARCH BY CAR — results */}
      {carQuery.trim() && (
        <div style={sectionCard}>
          <div style={{ fontSize: 15, fontWeight: 700, color: G.ink, marginBottom: 4 }}>Search by Car</div>
          <div style={{ fontSize: 12.5, color: G.text, marginBottom: 14 }}>
            Results for "{carQuery}".{range ? " Availability below uses the dates you picked above." : " Add dates above to see live availability here too."}
          </div>
          <div>
            {carSearchGroups.length === 0 ? (
              <div style={{ fontSize: 12.5, color: G.textMuted, padding: "10px 2px" }}>No cars match "{carQuery}".</div>
            ) : (
              carSearchGroups.map(g => (
                <div key={g.model} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: G.ink }}>{g.model}</div>
                    <div style={{ fontSize: 11, color: G.text }}>
                      {range ? `${g.availableCount} of ${g.totalCount} available` : `${g.totalCount} car${g.totalCount === 1 ? "" : "s"}`}
                    </div>
                  </div>
                  {g.cars.map(c => <CarRow key={c.plate} car={c} available={c.available} onBook={bookCar} onCheckAvailability={openAvailability} />)}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* AVAILABLE BRANDS */}
      {searched && !selectedBrand && (
        <div style={sectionCard}>
          <div style={{ fontSize: 15, fontWeight: 700, color: G.ink, marginBottom: 4 }}>Available Brands</div>
          <div style={{ fontSize: 12.5, color: G.text, marginBottom: 16 }}>
            Brands with available cars for {pickupDate} {minutesTo12h(hhmmToMinutes(pickupTime))} — {returnDate} {minutesTo12h(hhmmToMinutes(returnTime))}
          </div>
          {availableBrands.length === 0 ? (
            <div style={{ fontSize: 12.5, color: G.textMuted }}>No cars are available for this date range. Try different dates.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
              {availableBrands.map(({ brand, count }) => (
                <div key={brand} onClick={() => setSelectedBrand(brand)}
                  style={{ cursor: "pointer", border: `1px solid ${G.border}`, borderRadius: 12, padding: "18px 12px", textAlign: "center" }}>
                  <div style={{ width: 46, height: 46, borderRadius: "50%", background: brandTint(brand) + "1E", color: brandTint(brand), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, margin: "0 auto 10px" }}>
                    {brandInitial(brand)}
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: G.ink }}>{brand}</div>
                  <div style={{ fontSize: 11, color: G.primaryDark, fontWeight: 600 }}>{count} car{count === 1 ? "" : "s"} available</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CARS UNDER SELECTED BRAND */}
      {searched && selectedBrand && (
        <div style={sectionCard}>
          <button onClick={() => setSelectedBrand(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12.5, color: G.primaryDark, fontWeight: 700, padding: 0, marginBottom: 10 }}>← Back to brands</button>
          <div style={{ fontSize: 15, fontWeight: 700, color: G.ink, marginBottom: 4 }}>{selectedBrand} — Available Cars</div>
          <div style={{ fontSize: 12.5, color: G.text, marginBottom: 14 }}>{carsForSelectedBrand.length} car{carsForSelectedBrand.length === 1 ? "" : "s"} available for your selected period</div>
          {carsForSelectedBrand.map(car => <CarRow key={car.plate} car={car} available={true} onBook={bookCar} onCheckAvailability={openAvailability} />)}
        </div>
      )}

      <DateTimeModal
        title="Pick-Up Date & Time" sliderLabel="Start Time" open={pickupModalOpen} onClose={() => setPickupModalOpen(false)}
        dateISO={pickupDate} timeHHMM={pickupTime} minDateISO={todayISO()}
        onDone={(date, time) => { setPickupDate(date); setPickupTime(time); setPickupModalOpen(false); if (returnDate && returnDate < date) setReturnDate(date); }}
      />
      <DateTimeModal
        title="Return Date & Time" sliderLabel="End Time" open={returnModalOpen} onClose={() => setReturnModalOpen(false)}
        dateISO={returnDate} timeHHMM={returnTime} minDateISO={pickupDate || todayISO()}
        onDone={(date, time) => { setReturnDate(date); setReturnTime(time); setReturnModalOpen(false); }}
      />

      <MonthlyAvailabilityModal
        open={availabilityModalOpen}
        car={availabilityCar}
        range={range}
        bookings={bookings}
        checkBookingConflict={checkBookingConflict}
        onClose={() => setAvailabilityModalOpen(false)}
        onContinue={(plate) => { setAvailabilityModalOpen(false); bookCar(plate); }}
        onSelectDate={(iso) => {
          // Picking a day in the availability calendar makes it the new pick-up
          // date, pushing the return date to the next day if it's no longer
          // after pickup. We also update `range` so the modal's status readout
          // and "Continue to Book" reflect the newly chosen day (not the last
          // searched period).
          const newReturn = returnDate && returnDate > iso ? returnDate : nextDayISO(iso);
          setPickupDate(iso);
          setReturnDate(newReturn);
          setRange({ start: combineDateTime(iso, pickupTime), end: combineDateTime(newReturn, returnTime) });
        }}
      />
    </div>
  );
}
